import { applyStreamEvent, finalizeBlocks, type BlockAccumulator } from '../services/pantryChatBlocks';
import { PantryChatError } from '../services/pantryChat';

describe('applyStreamEvent + finalizeBlocks', () => {
  it('accumulates a single streamed text block', () => {
    const blocks = new Map<number, BlockAccumulator>();
    const deltas: string[] = [];
    applyStreamEvent(blocks, { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
    applyStreamEvent(
      blocks,
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi ' } },
      { onTextDelta: (d) => deltas.push(d) },
    );
    applyStreamEvent(
      blocks,
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'there' } },
      { onTextDelta: (d) => deltas.push(d) },
    );
    expect(deltas).toEqual(['Hi ', 'there']);
    expect(finalizeBlocks(blocks)).toEqual([{ type: 'text', text: 'Hi there' }]);
  });

  it('accumulates a tool_use block from id/name at start and json deltas', () => {
    const blocks = new Map<number, BlockAccumulator>();
    applyStreamEvent(blocks, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tu_1', name: 'consume_item' },
    });
    applyStreamEvent(blocks, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"itemId":"a",' },
    });
    applyStreamEvent(blocks, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '"amount":1}' },
    });
    expect(finalizeBlocks(blocks)).toEqual([
      { type: 'tool_use', id: 'tu_1', name: 'consume_item', input: { itemId: 'a', amount: 1 } },
    ]);
  });

  it('orders mixed text + tool_use blocks by index regardless of event arrival order', () => {
    const blocks = new Map<number, BlockAccumulator>();
    applyStreamEvent(blocks, {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'tu_1', name: 'move_item' },
    });
    applyStreamEvent(blocks, { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
    applyStreamEvent(blocks, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Sure' },
    });
    applyStreamEvent(blocks, {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"itemId":"x","to":"freezer"}' },
    });
    expect(finalizeBlocks(blocks)).toEqual([
      { type: 'text', text: 'Sure' },
      { type: 'tool_use', id: 'tu_1', name: 'move_item', input: { itemId: 'x', to: 'freezer' } },
    ]);
  });

  it('returns the stop_reason carried by a message_delta event', () => {
    const blocks = new Map<number, BlockAccumulator>();
    const stopReason = applyStreamEvent(blocks, { type: 'message_delta', delta: { stop_reason: 'end_turn' } });
    expect(stopReason).toBe('end_turn');
  });

  it('throws a PantryChatError on a stream error event', () => {
    const blocks = new Map<number, BlockAccumulator>();
    expect(() => applyStreamEvent(blocks, { type: 'error', error: { message: 'overloaded' } })).toThrow(
      PantryChatError,
    );
  });

  it('throws a PantryChatError when a tool_use block accumulated invalid JSON', () => {
    const blocks = new Map<number, BlockAccumulator>();
    applyStreamEvent(blocks, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tu_1', name: 'add_items' },
    });
    applyStreamEvent(blocks, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{not valid' },
    });
    expect(() => finalizeBlocks(blocks)).toThrow(PantryChatError);
  });

  it('ignores a delta for an index with no started block', () => {
    const blocks = new Map<number, BlockAccumulator>();
    expect(() =>
      applyStreamEvent(blocks, {
        type: 'content_block_delta',
        index: 5,
        delta: { type: 'text_delta', text: 'x' },
      }),
    ).not.toThrow();
    expect(finalizeBlocks(blocks)).toEqual([]);
  });
});
