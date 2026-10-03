import { fetch } from 'expo/fetch';
import { PantryChatError, isAbortError, type AssistantContentBlock, type PantryChatRequestBody } from './pantryChat';
import { readSseEvents } from './sseStream';
import { getAnthropicApiKey } from './anthropicApiKey';
import { applyStreamEvent, finalizeBlocks, type BlockAccumulator } from './pantryChatBlocks';

// RN transport for the conversational pantry assistant. Same expo/fetch +
// hand-rolled-SSE approach as receiptVisionApp.ts, but harder: that transport
// only ever accumulated one forced tool_use block, while a chat turn can
// stream mixed text + multiple parallel tool_use blocks, tracked by index.

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface PantryChatTurnResult {
  blocks: AssistantContentBlock[];
  stopReason: string | null;
}

export interface SendPantryChatTurnOptions {
  // Fired per token as assistant prose streams in, for live-updating the chat
  // bubble. Not called for tool_use JSON deltas — those aren't user-visible.
  onTextDelta?: (delta: string) => void;
  // Lets the caller cancel an in-flight request/stream (user-tapped Stop, or
  // a client-side timeout). A genuinely hung or runaway generation has no
  // other way to be interrupted — seen in practice with an unbounded local
  // model response.
  signal?: AbortSignal;
}

export async function sendPantryChatTurn(
  body: PantryChatRequestBody,
  options: SendPantryChatTurnOptions = {},
): Promise<PantryChatTurnResult> {
  let apiKey: string;
  try {
    apiKey = getAnthropicApiKey();
  } catch (e) {
    throw new PantryChatError((e as Error).message, e);
  }

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: options.signal,
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new PantryChatError('Pantry chat request failed to send', e);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new PantryChatError(`Pantry chat API returned ${res.status}: ${detail.slice(0, 300)}`);
  }
  if (!res.body) {
    throw new PantryChatError('Pantry chat response had no body to stream');
  }

  const blocksByIndex = new Map<number, BlockAccumulator>();
  let stopReason: string | undefined;

  await readSseEvents(res.body, (raw) => {
    const sr = applyStreamEvent(blocksByIndex, raw, { onTextDelta: options.onTextDelta });
    if (sr) stopReason = sr;
  });

  if (stopReason === 'max_tokens') {
    throw new PantryChatError('Pantry chat response was truncated (hit max_tokens) mid-turn.');
  }

  return { blocks: finalizeBlocks(blocksByIndex), stopReason: stopReason ?? null };
}
