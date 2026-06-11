import Anthropic from '@anthropic-ai/sdk';
import type { ParsedReceipt } from '../types/grocery';
import {
  buildReceiptRequestBody,
  parseReceiptToolUse,
  ReceiptParseError,
  type ParseReceiptOptions,
  type ReceiptImageMediaType,
} from './receiptVision';

// SDK-backed transport for the standalone test script (Node only — the
// @anthropic-ai/sdk package pulls in node:fs and can't be bundled into React
// Native, which is why the app uses a fetch transport in receiptVisionApp.ts).
// The prompt, tool schema, and validation all live in receiptVision.ts and are
// shared between the two transports.

/**
 * Sends a base64-encoded image to Claude and returns a validated ParsedReceipt.
 * Throws ReceiptParseError on any failure (network, bad JSON, schema mismatch).
 */
export async function parseReceiptResponse(
  apiKey: string,
  imageBase64: string,
  mediaType: ReceiptImageMediaType = 'image/jpeg',
  options: ParseReceiptOptions = {},
): Promise<ParsedReceipt> {
  const client = new Anthropic({ apiKey });

  let content;
  try {
    const stream = client.messages.stream(
      buildReceiptRequestBody(imageBase64, mediaType) as Anthropic.MessageStreamParams,
    );

    if (options.onTextDelta) {
      // With forced tool use, text deltas don't fire; the JSON arrives as
      // input_json deltas instead. Surface them through the same callback so
      // callers get visible progress.
      stream.on('inputJson', (partialJson: string) => options.onTextDelta!(partialJson));
    }

    const finalMessage = await stream.finalMessage();
    content = finalMessage.content;
  } catch (e) {
    if (e instanceof ReceiptParseError) throw e;
    throw new ReceiptParseError('Vision API call failed', e);
  }

  return parseReceiptToolUse(content);
}
