// Pure reducer for turning a sequence of parsed Anthropic streaming events
// into the final AssistantContentBlock[] for a chat turn. Split out from
// pantryChatApp.ts (the expo/fetch-based transport, which can't run in Jest)
// so this block-accumulation logic is unit-testable with a plain array of
// canned events — no network, no RN.
import { PantryChatError, type AssistantContentBlock } from './pantryChat';

export type BlockAccumulator =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; json: string };

export interface StreamEventHandlerOptions {
  // Fired per token as assistant prose streams in, for live-updating a bubble.
  onTextDelta?: (delta: string) => void;
}

// Applies one parsed SSE event to the in-progress block map (mutated in
// place). Returns the stop_reason when the event carries one (message_delta),
// else undefined.
export function applyStreamEvent(
  blocksByIndex: Map<number, BlockAccumulator>,
  raw: unknown,
  options: StreamEventHandlerOptions = {},
): string | undefined {
  const evt = raw as {
    type?: string;
    index?: number;
    content_block?: { type?: string; id?: string; name?: string };
    delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
    error?: { message?: string };
  };

  if (evt.type === 'error') {
    throw new PantryChatError(`Pantry chat streaming error: ${evt.error?.message ?? 'unknown'}`);
  }

  if (evt.type === 'content_block_start' && typeof evt.index === 'number' && evt.content_block) {
    // id/name for a tool_use block only ever arrive here, never in a delta.
    if (evt.content_block.type === 'tool_use') {
      blocksByIndex.set(evt.index, {
        type: 'tool_use',
        id: evt.content_block.id ?? '',
        name: evt.content_block.name ?? '',
        json: '',
      });
    } else if (evt.content_block.type === 'text') {
      blocksByIndex.set(evt.index, { type: 'text', text: '' });
    }
    return undefined;
  }

  if (evt.type === 'content_block_delta' && typeof evt.index === 'number' && evt.delta) {
    const acc = blocksByIndex.get(evt.index);
    if (!acc) return undefined;
    if (evt.delta.type === 'text_delta' && acc.type === 'text') {
      const chunk = evt.delta.text ?? '';
      acc.text += chunk;
      if (chunk && options.onTextDelta) options.onTextDelta(chunk);
    } else if (evt.delta.type === 'input_json_delta' && acc.type === 'tool_use') {
      acc.json += evt.delta.partial_json ?? '';
    }
    return undefined;
  }

  if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
    return evt.delta.stop_reason;
  }

  return undefined;
}

// Turns the finished block map into the ordered content-block array the
// Anthropic API expects replayed back verbatim in the next request.
export function finalizeBlocks(blocksByIndex: Map<number, BlockAccumulator>): AssistantContentBlock[] {
  const blocks: AssistantContentBlock[] = [];
  for (const index of [...blocksByIndex.keys()].sort((a, b) => a - b)) {
    const acc = blocksByIndex.get(index)!;
    if (acc.type === 'text') {
      blocks.push({ type: 'text', text: acc.text });
      continue;
    }
    let input: unknown = {};
    if (acc.json) {
      try {
        input = JSON.parse(acc.json);
      } catch (e) {
        throw new PantryChatError(`Pantry chat tool input was not valid JSON: ${acc.json.slice(0, 300)}`, e);
      }
    }
    blocks.push({ type: 'tool_use', id: acc.id, name: acc.name, input });
  }
  return blocks;
}
