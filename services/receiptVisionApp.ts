import Constants from 'expo-constants';
// expo/fetch (unlike the global RN fetch) exposes a streaming response body, so
// we can surface progress during the ~45s parse instead of blocking on a spinner.
import { fetch } from 'expo/fetch';
// The new expo-file-system v19 API uses a File class, but doesn't expose a
// direct base64 read; the legacy API is still shipped and is the right tool
// for a one-shot "read this URI as base64" call.
import * as FileSystem from 'expo-file-system/legacy';
import type { ParsedReceipt } from '../types/grocery';
import {
  buildReceiptRequestBody,
  parseReceiptToolUse,
  ReceiptParseError,
  type ParseReceiptOptions,
  type ReceiptImageMediaType,
} from './receiptVision';

// React Native bridge for the receipt parser. We call the Anthropic REST API
// directly with fetch rather than @anthropic-ai/sdk, because the SDK imports
// node:fs (via its credential cache) and can't be bundled into RN. The prompt,
// tool schema, and validation are shared from services/receiptVision.ts; the
// Node test script uses the SDK transport in services/receiptVision.node.ts.
//
//   - resolves the API key from expo-constants extras
//   - reads the image bytes from a local URI via expo-file-system
//   - streams the response so onTextDelta can drive progress UI

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function inferMediaTypeFromUri(uri: string): ReceiptImageMediaType {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function getApiKey(): string {
  const key = Constants.expoConfig?.extra?.anthropicApiKey;
  if (typeof key !== 'string' || !key) {
    throw new ReceiptParseError(
      'ANTHROPIC_API_KEY is not configured. Add it to .env (see .env.example) and restart the dev server.',
    );
  }
  return key;
}

/**
 * Reads an Anthropic SSE stream and accumulates the forced tool_use input.
 *
 * With tool_choice forcing our tool, the model emits no text — the entire tool
 * input arrives as a sequence of `input_json_delta` partial-JSON chunks on the
 * first (and only) content block. We concatenate those chunks into the complete
 * JSON string and forward each one to onTextDelta for progress feedback.
 */
async function readToolInputFromSse(
  body: ReadableStream<Uint8Array>,
  onTextDelta?: (delta: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let toolJson = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIndex: number;
      while ((nlIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nlIndex).trimEnd();
        buffer = buffer.slice(nlIndex + 1);
        // SSE frames are `event:`/`data:` line pairs; only the data carries JSON.
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;

        let evt: { type?: string; delta?: { type?: string; partial_json?: string }; error?: { message?: string } };
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }

        if (evt.type === 'error') {
          throw new ReceiptParseError(`Vision API streaming error: ${evt.error?.message ?? 'unknown'}`);
        }
        if (evt.type === 'content_block_delta' && evt.delta?.type === 'input_json_delta') {
          const partial = evt.delta.partial_json ?? '';
          toolJson += partial;
          if (partial && onTextDelta) onTextDelta(partial);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return toolJson;
}

/**
 * Parse a receipt image at a local URI into a structured ParsedReceipt.
 *
 * In P1 the URI comes from either the bundled dev fixture or expo-camera's
 * takePictureAsync. In P2 it'll also be drawn from the offline queue.
 *
 * Note: this does NOT resize the image. Camera captures default to high
 * resolution and will exceed Anthropic's 10MB base64 limit — resizing via
 * expo-image-manipulator gets added in sub-phase 1.3 alongside the capture flow.
 */
export async function parseReceiptFromUri(
  uri: string,
  options: ParseReceiptOptions = {},
): Promise<ParsedReceipt> {
  const apiKey = getApiKey();
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const mediaType = inferMediaTypeFromUri(uri);
  const body = { ...buildReceiptRequestBody(base64, mediaType), stream: true };

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ReceiptParseError('Vision API request failed to send', e);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ReceiptParseError(`Vision API returned ${res.status}: ${detail.slice(0, 300)}`);
  }
  if (!res.body) {
    throw new ReceiptParseError('Vision API response had no body to stream');
  }

  const toolJson = await readToolInputFromSse(res.body, options.onTextDelta);

  let toolInput: unknown;
  try {
    toolInput = JSON.parse(toolJson);
  } catch (e) {
    throw new ReceiptParseError(
      `Vision response tool input was not valid JSON: ${toolJson.slice(0, 300)}`,
      e,
    );
  }

  return parseReceiptToolUse([{ type: 'tool_use', input: toolInput }]);
}
