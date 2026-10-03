import type { GroceryItem } from '../types/grocery';
import { usePantryStore, isRecallable } from '../stores/pantryStore';
import { buildItemFromChatInput, buildUpdatePatchFromChatInput } from './pantryActions';
import {
  PantryChatError,
  isAbortError,
  buildPantrySnapshot,
  resolveItemId,
  validateAddItemsInput,
  validateConsumeItemInput,
  validateItemIdInput,
  validateMoveItemInput,
  validateUpdateItemInput,
  AUTO_APPLY_TOOL_NAMES,
  CONFIRM_REQUIRED_TOOL_NAMES,
  type PantryChatMessage,
  type TextBlock,
  type ToolResultBlock,
  type ToolUseBlock,
} from './pantryChat';

export { isAbortError };
import { sendChatTurn } from './pantryChatBackend';

// The store-aware agent loop: owns talking to pantryChatApp, executing
// auto-apply tools directly against usePantryStore, deferring confirm-gated
// tools to the UI, and looping until the model produces a response with no
// tool calls (or a safety cap is hit). Not a component — components call
// runPantryChatTurn and render whatever its callbacks report.

const MAX_LOOP_ITERATIONS = 6;

export interface PendingConfirmation {
  toolUseId: string;
  toolName: 'dispose_item_wasted' | 'remove_item';
  itemId: string;
  itemName: string;
}

export interface PantryChatTurnCallbacks {
  // Per-token as assistant prose streams in (drives a live-updating bubble).
  onTextDelta?: (delta: string) => void;
  // Fired once per loop iteration that produced assistant text, after
  // streaming for that iteration has finished.
  onAssistantMessage?: (text: string) => void;
  // Fired when a confirm-gated tool call (dispose_item_wasted, remove_item)
  // needs the user to tap Confirm/Cancel.
  onPendingConfirmation?: (pending: PendingConfirmation) => void;
  // Lets the caller cancel the whole turn (user-tapped Stop, or a client-side
  // timeout) — checked between loop iterations too, so an abort doesn't wait
  // for a tool round-trip to finish before taking effect.
  signal?: AbortSignal;
}

function successResult(toolUseId: string, summary: string): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: toolUseId, content: summary };
}

function errorResult(toolUseId: string, message: string): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: toolUseId, content: message, is_error: true };
}

function executeAutoTool(block: ToolUseBlock, items: GroceryItem[]): ToolResultBlock {
  const store = usePantryStore.getState();

  switch (block.name) {
    case 'add_items': {
      const validated = validateAddItemsInput(block.input);
      if (!validated) return errorResult(block.id, 'Invalid add_items input.');
      const now = new Date();
      for (const item of validated.items) {
        store.addItem(buildItemFromChatInput(item, now));
      }
      return successResult(block.id, `Added ${validated.items.length} item(s) to the pantry.`);
    }
    case 'update_item': {
      const validated = validateUpdateItemInput(block.input);
      if (!validated) return errorResult(block.id, 'Invalid update_item input.');
      const item = resolveItemId(validated.itemId, items);
      if (!item) return errorResult(block.id, `No item with id ${validated.itemId} in the current pantry.`);
      const patch = buildUpdatePatchFromChatInput(validated, item);
      if (Object.keys(patch).length === 0) return errorResult(block.id, 'No recognized fields to update.');
      store.updateItem(item.id, patch);
      return successResult(block.id, `Updated ${item.name}.`);
    }
    case 'consume_item': {
      const validated = validateConsumeItemInput(block.input);
      if (!validated) return errorResult(block.id, 'Invalid consume_item input.');
      const item = resolveItemId(validated.itemId, items);
      if (!item) return errorResult(block.id, `No item with id ${validated.itemId} in the current pantry.`);
      if (validated.amount >= item.remainingQuantity) {
        store.disposeItem(item.id, 'used');
        return successResult(block.id, `${item.name} is now fully used up.`);
      }
      store.consumeItem(item.id, validated.amount);
      const remaining = item.remainingQuantity - validated.amount;
      return successResult(
        block.id,
        `Used ${validated.amount} ${item.unitOfMeasure} of ${item.name}; ${remaining} ${item.unitOfMeasure} remaining.`,
      );
    }
    case 'mark_item_used_up': {
      const validated = validateItemIdInput(block.input);
      if (!validated) return errorResult(block.id, 'Invalid mark_item_used_up input.');
      const item = resolveItemId(validated.itemId, items);
      if (!item) return errorResult(block.id, `No item with id ${validated.itemId} in the current pantry.`);
      store.disposeItem(item.id, 'used');
      return successResult(block.id, `${item.name} marked fully used up.`);
    }
    case 'move_item': {
      const validated = validateMoveItemInput(block.input);
      if (!validated) return errorResult(block.id, 'Invalid move_item input.');
      const item = resolveItemId(validated.itemId, items);
      if (!item) return errorResult(block.id, `No item with id ${validated.itemId} in the current pantry.`);
      store.moveItem(item.id, validated.to);
      return successResult(block.id, `${item.name} moved to the ${validated.to}.`);
    }
    case 'recall_item': {
      const validated = validateItemIdInput(block.input);
      if (!validated) return errorResult(block.id, 'Invalid recall_item input.');
      const entry = store.recallableItems.find(
        (r) => r.item.id === validated.itemId && isRecallable(r.disposedAt),
      );
      if (!entry) {
        return errorResult(block.id, `No recallable item with id ${validated.itemId} within the undo window.`);
      }
      store.recallItem(validated.itemId);
      return successResult(block.id, `${entry.item.name} restored to the pantry.`);
    }
    default:
      return errorResult(block.id, `Unknown tool: ${block.name}`);
  }
}

function deferConfirmTool(
  block: ToolUseBlock,
  items: GroceryItem[],
  callbacks: PantryChatTurnCallbacks,
): ToolResultBlock {
  const validated = validateItemIdInput(block.input);
  if (!validated) return errorResult(block.id, `Invalid ${block.name} input.`);
  const item = resolveItemId(validated.itemId, items);
  if (!item) return errorResult(block.id, `No item with id ${validated.itemId} in the current pantry.`);

  callbacks.onPendingConfirmation?.({
    toolUseId: block.id,
    toolName: block.name as 'dispose_item_wasted' | 'remove_item',
    itemId: item.id,
    itemName: item.name,
  });

  // Satisfies the API's "every tool_use needs a tool_result" requirement
  // without applying the mutation — the real action happens later, directly
  // against the store, when the user taps Confirm/Cancel on the chip.
  return {
    type: 'tool_result',
    tool_use_id: block.id,
    content: JSON.stringify({
      status: 'awaiting_user_confirmation',
      note:
        'The user must tap Confirm/Cancel in the app UI. Do not assume completion. On your next turn, ' +
        'check whether this item still appears in CURRENT_PANTRY: if it is gone, the user confirmed; ' +
        'if it is still present, they canceled or have not responded yet.',
    }),
  };
}

function executeOrDeferToolUse(
  block: ToolUseBlock,
  items: GroceryItem[],
  callbacks: PantryChatTurnCallbacks,
): ToolResultBlock {
  if (CONFIRM_REQUIRED_TOOL_NAMES.has(block.name)) return deferConfirmTool(block, items, callbacks);
  if (AUTO_APPLY_TOOL_NAMES.has(block.name)) return executeAutoTool(block, items);
  return errorResult(block.id, `Unknown tool: ${block.name}`);
}

// Runs one user turn to completion: sends the message, executes/defers any
// tool calls, and keeps looping (feeding tool_results back) until the model
// replies with no more tool_use blocks. Returns the updated transcript for
// the caller to hold in state and pass back on the next turn.
export async function runPantryChatTurn(
  userText: string,
  transcript: PantryChatMessage[],
  callbacks: PantryChatTurnCallbacks = {},
): Promise<PantryChatMessage[]> {
  let messages: PantryChatMessage[] = [
    ...transcript,
    { role: 'user', content: [{ type: 'text', text: userText }] },
  ];

  for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration++) {
    if (callbacks.signal?.aborted) {
      const err = new Error('Pantry chat turn was canceled.');
      err.name = 'AbortError';
      throw err;
    }
    const state = usePantryStore.getState();
    const snapshot = buildPantrySnapshot(
      state.items,
      state.recallableItems.filter((r) => isRecallable(r.disposedAt)),
    );
    const result = await sendChatTurn(messages, snapshot, {
      onTextDelta: callbacks.onTextDelta,
      signal: callbacks.signal,
    });

    messages = [...messages, { role: 'assistant', content: result.blocks }];

    const text = result.blocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (text) callbacks.onAssistantMessage?.(text);

    const toolUseBlocks = result.blocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      return messages;
    }

    const toolResults: ToolResultBlock[] = [];
    for (const block of toolUseBlocks) {
      const items = usePantryStore.getState().items;
      toolResults.push(executeOrDeferToolUse(block, items, callbacks));
    }
    messages = [...messages, { role: 'user', content: toolResults }];
  }

  throw new PantryChatError('Pantry chat hit the maximum number of tool-use iterations without finishing.');
}

// Called by the UI when the user taps Confirm on a pending chip. No model
// round-trip — the mutation happens directly against the store; the model
// finds out on its next turn via the refreshed CURRENT_PANTRY snapshot.
export function applyConfirmedAction(pending: PendingConfirmation): void {
  const store = usePantryStore.getState();
  if (pending.toolName === 'dispose_item_wasted') {
    store.disposeItem(pending.itemId, 'wasted');
  } else {
    store.removeItem(pending.itemId);
  }
}

// Called when the user taps Cancel. No store mutation — named symmetrically
// with applyConfirmedAction for the UI's Confirm/Cancel pair.
export function discardPendingAction(_pending: PendingConfirmation): void {
  void _pending;
}
