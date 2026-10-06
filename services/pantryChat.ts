import type { GroceryItem, ItemCategory, RecallableItem, StorageLocation } from '../types/grocery';
import type { ChatAddItem, ChatUpdateItem } from './pantryActions';
import { SHELF_LIFE_GUIDANCE } from './receiptVision';

// Pure, RN-free module for the conversational pantry assistant — prompt, tool
// schemas, request-body building, and input validation. Mirrors the
// receiptVision.ts / receiptVisionApp.ts split: this file has zero RN/Expo
// imports and is unit-testable on its own; services/pantryChatApp.ts is the
// RN transport, services/pantryChatExecutor.ts is the store-aware agent loop.
//
// Unlike the one-shot forced-tool receipt parse, this is a multi-turn, mixed
// text+tool conversation: tool_choice is 'auto' (a turn may be pure prose),
// and a fresh CURRENT_PANTRY snapshot is sent every turn so the model stays
// grounded on state it (or the user) may have just changed.

export const PANTRY_CHAT_MODEL = 'claude-sonnet-4-6';

export class PantryChatError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PantryChatError';
  }
}

// Shared by both transports (a canceled fetch/stream) and the executor (a
// signal already aborted between loop iterations) so the UI has one check to
// render a cancellation as a neutral note instead of an error bubble.
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

// --- Content block / message types (shared with the transport + executor) ---

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type AssistantContentBlock = TextBlock | ToolUseBlock;
export type UserContentBlock = TextBlock | ToolResultBlock;

export type PantryChatMessage =
  | { role: 'user'; content: UserContentBlock[] }
  | { role: 'assistant'; content: AssistantContentBlock[] };

export interface PantryChatRequestBody {
  model: string;
  max_tokens: number;
  // Lower than the API default (1.0) — this assistant drives real pantry
  // mutations, so predictable tool-use/grounding matters more than
  // conversational variety.
  temperature: number;
  system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  tools: object[];
  tool_choice: { type: 'auto' };
  messages: PantryChatMessage[];
}

// --- Pantry snapshot (sent fresh every turn, never cached) ---

export interface PantrySnapshotItem {
  id: string;
  name: string;
  category: ItemCategory;
  storageLocation: StorageLocation;
  remainingQuantity: number;
  unitOfMeasure: string;
  daysUntilExpiration: number;
  isFreezable: boolean;
}

export interface PantrySnapshotRecalledItem {
  itemId: string;
  name: string;
  disposedDaysAgo: number;
}

export interface PantrySnapshot {
  nowIso: string;
  items: PantrySnapshotItem[];
  recentlyUsed: PantrySnapshotRecalledItem[];
}

const daysUntil = (date: Date, now: Date): number =>
  Math.ceil((date.getTime() - now.getTime()) / 86400000);

export function buildPantrySnapshot(
  items: GroceryItem[],
  recallable: RecallableItem[],
  now: Date = new Date(),
): PantrySnapshot {
  return {
    nowIso: now.toISOString().slice(0, 10),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      storageLocation: i.storageLocation,
      remainingQuantity: i.remainingQuantity,
      unitOfMeasure: i.unitOfMeasure,
      daysUntilExpiration: daysUntil(i.effectiveExpirationDate, now),
      isFreezable: i.isFreezable,
    })),
    recentlyUsed: recallable.map((r) => ({
      itemId: r.item.id,
      name: r.item.name,
      disposedDaysAgo: Math.floor((now.getTime() - r.disposedAt.getTime()) / 86400000),
    })),
  };
}

// --- System prompt ---
// Split into a static (cacheable) instructions block and a per-turn snapshot
// block, same as receiptVision.ts's cache_control usage.

export const PANTRY_CHAT_SYSTEM_PROMPT = `You are a conversational assistant for a home food-pantry tracking app. The user manages their pantry entirely through natural language with you instead of manual forms. Each turn you're given a CURRENT_PANTRY snapshot (a JSON block appended after this prompt) reflecting the live state of their pantry, including changes from your own tool calls earlier in this same conversation.

Your job: interpret what the user wants, then either respond in plain text (answering a question, asking for clarification) or call one or more of the provided tools to change pantry state. Never guess silently — if you're not confident, ask.

GROUNDING (critical): Never claim in your reply that you added, updated, removed, moved, or otherwise changed something unless you actually called the matching tool in THIS response and are reporting its real result. If you did not call a tool, do not describe an action as having happened — describe what you're asking or proposing instead. Do not speculate about the outcome of a past confirm/cancel chip beyond what CURRENT_PANTRY actually shows right now.
- When you state a quantity in your reply (e.g. "you have N left"), copy it from the tool_result's actual numbers — never reuse a number from the user's own message as if it were the result. consume_item's tool_result is JSON with an explicit "remainingQuantity" field — when telling the user how much is left, that field's value is the only number to use. It is NOT the same number as "amountUsed" (how much they said they used) or as whatever quantity they stated in their own message — those are consistently different numbers, and confusing them is the single most common mistake to avoid here.

RESTATING vs. ADDING: if the user states a quantity for an item that already exists in CURRENT_PANTRY at or near that same quantity (e.g. "I have 3 kiwis" when 3 kiwis are already listed), don't assume they want to add more — this is often just them telling you what's already there. Ask whether they mean "add more" or are just confirming current stock, rather than calling add_items on a guess.

ITEM REFERENCE RULES (critical):
- Every mutating tool takes an itemId. You may ONLY use an id that appears verbatim in the CURRENT_PANTRY snapshot for THIS turn — never invent one, and never reuse an id from an earlier turn without checking it's still present.
- If the user's phrase (e.g. "the milk", "the chicken") matches more than one item in CURRENT_PANTRY, or matches none, do NOT call a tool. Respond in plain text instead: list the plausible candidates by name, remaining quantity, storage location, and days until expiration, and ask which one they mean.
- Convert vague quantities ("half", "a third", "all of it") into a numeric amount using the item's remainingQuantity and unitOfMeasure from the snapshot. If the resulting amount would consume the entire remainingQuantity, call mark_item_used_up instead of consume_item.

CONFIRMATION TIERS (the app enforces this — you just call the right tool):
- add_items, update_item, consume_item, mark_item_used_up, move_item, and recall_item apply immediately when called.
- dispose_item_wasted and remove_item are NOT applied immediately — the app shows the user a confirm/cancel control and hands you back a "pending" result. You can mention in your reply that you're waiting on their confirmation. On a LATER turn, check CURRENT_PANTRY: if the item is gone, they confirmed; if it's still present, they canceled or haven't responded — don't assume either way, and don't repeat the call unless asked again.

CORRECTING A MISTAKE:
- If the user wants to fix something about an item that's already in the pantry (wrong expiration estimate, wrong category, misspelled name, wrong storage location), call update_item on that item's id. NEVER call add_items to "fix" an existing item — that creates a duplicate instead of correcting it.

ADDING ITEMS (add_items):
- The item's name is the ONLY thing you actually need. Do not interrogate the user for category, quantity, unit, cost, or storage location before calling the tool — guess a sensible value for anything they didn't say and mention your assumption in your reply (e.g. "Added 1 jar of peanut butter to the pantry shelf — let me know if that's wrong"). They can correct any of it afterward with a simple follow-up, which calls update_item.
- If no quantity was stated, use 1. If no unit was stated, use "each".
- category must be one of: produce, protein, dairy, grains, condiments, beverages, frozen, snacks, other — pick your best guess from the item name; use "other" only if nothing fits.
- Estimate estimatedShelfLifeDays yourself using this rubric unless the user gives you a firmer date — don't ask them for a shelf-life estimate, that's your job: ${SHELF_LIFE_GUIDANCE}
- Only set explicitExpirationDate (YYYY-MM-DD) when the user states or implies a specific date (e.g. "expires next Tuesday", "best by the 14th"); otherwise leave it null and rely on estimatedShelfLifeDays. Use CURRENT_PANTRY's nowIso as "today" for resolving relative dates.
- Only set storageLocation when the user states it explicitly; otherwise leave it null and the app will pick a sensible default by category.
- Only set unitCost/totalCost when the user actually mentions a price — never ask for cost, it's rarely worth the friction.

ANSWERING QUESTIONS:
- Answer questions about the pantry (what's expiring soon, how much of something is left, what's in the freezer, etc.) directly from CURRENT_PANTRY — there is no separate lookup tool. Don't call a tool just to answer a question.

Keep replies short and conversational — this is a chat, not a report.`;

// --- Tool schemas ---

const CATEGORY_ENUM = [
  'produce', 'protein', 'dairy', 'grains',
  'condiments', 'beverages', 'frozen', 'snacks', 'other',
];

const LOCATION_ENUM = ['fridge', 'freezer', 'pantry'];

const ITEM_ID_PROPERTY = {
  itemId: {
    type: 'string',
    description: 'Must exactly match an id from the CURRENT_PANTRY snapshot given this turn.',
  },
};

const ADD_ITEMS_TOOL = {
  name: 'add_items',
  description: 'Add one or more new items to the pantry, e.g. after a grocery run.',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            category: { type: 'string', enum: CATEGORY_ENUM },
            quantity: { type: 'number' },
            unitOfMeasure: { type: 'string' },
            storageLocation: { type: ['string', 'null'], enum: [...LOCATION_ENUM, null] },
            estimatedShelfLifeDays: { type: 'integer' },
            explicitExpirationDate: { type: ['string', 'null'] },
            unitCost: { type: ['number', 'null'] },
            totalCost: { type: ['number', 'null'] },
          },
          // Only `name` is truly required — everything else gets a sensible
          // default in code when omitted (see validateAddItemsInput), so a
          // weaker model isn't tempted to interrogate the user for details
          // it can reasonably guess (and correct later via update_item).
          required: ['name'],
        },
      },
    },
    required: ['items'],
  },
};

const UPDATE_ITEM_TOOL = {
  name: 'update_item',
  description: 'Edit fields on an EXISTING pantry item (name, category, storage location, or expiration). Use this to fix a mistake or correct an estimate — never call add_items to "fix" an item, since that creates a duplicate instead of editing it. Pass null for any field you are not changing.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ...ITEM_ID_PROPERTY,
      name: { type: ['string', 'null'] },
      category: { type: ['string', 'null'], enum: [...CATEGORY_ENUM, null] },
      storageLocation: { type: ['string', 'null'], enum: [...LOCATION_ENUM, null] },
      estimatedShelfLifeDaysFromPurchase: {
        type: ['integer', 'null'],
        description: 'Re-estimate the expiration as this many days after the item\'s original purchase date (not from today). Use when correcting a shelf-life guess.',
      },
      explicitExpirationDate: {
        type: ['string', 'null'],
        description: 'YYYY-MM-DD. Overrides estimatedShelfLifeDaysFromPurchase when both are given.',
      },
    },
    required: [
      'itemId', 'name', 'category', 'storageLocation',
      'estimatedShelfLifeDaysFromPurchase', 'explicitExpirationDate',
    ],
  },
};

const CONSUME_ITEM_TOOL = {
  name: 'consume_item',
  description: 'Record partial use of an item, decrementing its remaining quantity. Do not use this for full consumption — call mark_item_used_up instead.',
  input_schema: {
    type: 'object' as const,
    properties: { ...ITEM_ID_PROPERTY, amount: { type: 'number', description: 'Amount used, in the item\'s unitOfMeasure.' } },
    required: ['itemId', 'amount'],
  },
};

const MARK_ITEM_USED_UP_TOOL = {
  name: 'mark_item_used_up',
  description: 'Record that an item has been fully used up (its entire remaining quantity is gone).',
  input_schema: {
    type: 'object' as const,
    properties: ITEM_ID_PROPERTY,
    required: ['itemId'],
  },
};

const MOVE_ITEM_TOOL = {
  name: 'move_item',
  description: 'Move an item between storage locations (e.g. into the freezer to save it).',
  input_schema: {
    type: 'object' as const,
    properties: { ...ITEM_ID_PROPERTY, to: { type: 'string', enum: LOCATION_ENUM } },
    required: ['itemId', 'to'],
  },
};

const RECALL_ITEM_TOOL = {
  name: 'recall_item',
  description: 'Undo a recent mark_item_used_up — restores the item to the pantry. Only works within a short window after it was used up.',
  input_schema: {
    type: 'object' as const,
    properties: ITEM_ID_PROPERTY,
    required: ['itemId'],
  },
};

const DISPOSE_ITEM_WASTED_TOOL = {
  name: 'dispose_item_wasted',
  description: 'Record that an item was thrown out / spoiled / wasted. Irreversible — the app will ask the user to confirm before this actually applies.',
  input_schema: {
    type: 'object' as const,
    properties: ITEM_ID_PROPERTY,
    required: ['itemId'],
  },
};

const REMOVE_ITEM_TOOL = {
  name: 'remove_item',
  description: 'Delete an item entirely with no waste/use record — for correcting a mistaken entry (e.g. added twice, wrong item). Irreversible — the app will ask the user to confirm before this actually applies.',
  input_schema: {
    type: 'object' as const,
    properties: ITEM_ID_PROPERTY,
    required: ['itemId'],
  },
};

export const PANTRY_TOOLS = [
  ADD_ITEMS_TOOL,
  UPDATE_ITEM_TOOL,
  CONSUME_ITEM_TOOL,
  MARK_ITEM_USED_UP_TOOL,
  MOVE_ITEM_TOOL,
  RECALL_ITEM_TOOL,
  DISPOSE_ITEM_WASTED_TOOL,
  REMOVE_ITEM_TOOL,
];

export const AUTO_APPLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'add_items', 'update_item', 'consume_item', 'mark_item_used_up', 'move_item', 'recall_item',
]);

export const CONFIRM_REQUIRED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'dispose_item_wasted', 'remove_item',
]);

// --- Request body ---

export function buildPantryChatRequestBody(
  messages: PantryChatMessage[],
  snapshot: PantrySnapshot,
): PantryChatRequestBody {
  return {
    model: PANTRY_CHAT_MODEL,
    max_tokens: 4096,
    temperature: 0.3,
    system: [
      { type: 'text', text: PANTRY_CHAT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `CURRENT_PANTRY:\n${JSON.stringify(snapshot)}` },
    ],
    tools: PANTRY_TOOLS,
    tool_choice: { type: 'auto' },
    messages,
  };
}

// --- Input validators ---
// Same defensive-parsing style as receiptVision.validators.ts: coerce
// conservatively (trim strings, round integers) but reject anything
// structurally wrong rather than paper over it.

const VALID_CATEGORIES: ReadonlySet<ItemCategory> = new Set(CATEGORY_ENUM as ItemCategory[]);
const VALID_LOCATIONS: ReadonlySet<StorageLocation> = new Set(LOCATION_ENUM as StorageLocation[]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

// Applied when add_items omits a non-essential field — name is the only
// thing a caller (model or otherwise) actually has to provide; see the
// ADDING ITEMS prompt section for why the model is told not to ask for these.
const DEFAULT_ADD_ITEM_CATEGORY: ItemCategory = 'other';
const DEFAULT_ADD_ITEM_QUANTITY = 1;
const DEFAULT_ADD_ITEM_UNIT = 'each';
const DEFAULT_ADD_ITEM_SHELF_LIFE_DAYS = 14;

// Omitted/null fields fall back to the defaults above; a field that *is*
// provided but malformed (wrong type, invalid enum, non-positive number)
// still fails the whole item — absence is tolerated, garbage is not.
function validateChatAddItem(x: unknown): ChatAddItem | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;

  if (!isNonEmptyString(r.name)) return null;

  let category: ItemCategory = DEFAULT_ADD_ITEM_CATEGORY;
  if (r.category !== null && r.category !== undefined) {
    if (typeof r.category !== 'string' || !VALID_CATEGORIES.has(r.category as ItemCategory)) return null;
    category = r.category as ItemCategory;
  }

  let quantity = DEFAULT_ADD_ITEM_QUANTITY;
  if (r.quantity !== null && r.quantity !== undefined) {
    if (!isFiniteNumber(r.quantity) || r.quantity <= 0) return null;
    quantity = r.quantity;
  }

  let unitOfMeasure = DEFAULT_ADD_ITEM_UNIT;
  if (r.unitOfMeasure !== null && r.unitOfMeasure !== undefined) {
    if (!isNonEmptyString(r.unitOfMeasure)) return null;
    unitOfMeasure = r.unitOfMeasure.trim();
  }

  let storageLocation: StorageLocation | undefined;
  if (r.storageLocation !== null && r.storageLocation !== undefined) {
    if (typeof r.storageLocation !== 'string' || !VALID_LOCATIONS.has(r.storageLocation as StorageLocation)) {
      return null;
    }
    storageLocation = r.storageLocation as StorageLocation;
  }

  let estimatedShelfLifeDays = DEFAULT_ADD_ITEM_SHELF_LIFE_DAYS;
  if (r.estimatedShelfLifeDays !== null && r.estimatedShelfLifeDays !== undefined) {
    if (!isFiniteNumber(r.estimatedShelfLifeDays) || r.estimatedShelfLifeDays <= 0) return null;
    estimatedShelfLifeDays = Math.round(r.estimatedShelfLifeDays);
  }

  let explicitExpirationDate: string | null = null;
  if (r.explicitExpirationDate !== null && r.explicitExpirationDate !== undefined) {
    if (typeof r.explicitExpirationDate !== 'string' || !DATE_RE.test(r.explicitExpirationDate)) return null;
    explicitExpirationDate = r.explicitExpirationDate;
  }

  if (r.unitCost !== null && r.unitCost !== undefined && !isFiniteNumber(r.unitCost)) return null;
  if (r.totalCost !== null && r.totalCost !== undefined && !isFiniteNumber(r.totalCost)) return null;

  return {
    name: r.name.trim(),
    category,
    quantity,
    unitOfMeasure,
    storageLocation,
    estimatedShelfLifeDays,
    explicitExpirationDate,
    unitCost: (r.unitCost as number | null | undefined) ?? null,
    totalCost: (r.totalCost as number | null | undefined) ?? null,
  };
}

export function validateAddItemsInput(x: unknown): { items: ChatAddItem[] } | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  if (!Array.isArray(r.items) || r.items.length === 0) return null;

  const items: ChatAddItem[] = [];
  for (const raw of r.items) {
    const item = validateChatAddItem(raw);
    if (!item) return null;
    items.push(item);
  }
  return { items };
}

export type UpdateItemInput = ChatUpdateItem & { itemId: string };

export function validateUpdateItemInput(x: unknown): UpdateItemInput | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  if (!isNonEmptyString(r.itemId)) return null;

  const result: UpdateItemInput = { itemId: r.itemId.trim() };

  if (r.name !== null && r.name !== undefined) {
    if (!isNonEmptyString(r.name)) return null;
    result.name = r.name.trim();
  }
  if (r.category !== null && r.category !== undefined) {
    if (typeof r.category !== 'string' || !VALID_CATEGORIES.has(r.category as ItemCategory)) return null;
    result.category = r.category as ItemCategory;
  }
  if (r.storageLocation !== null && r.storageLocation !== undefined) {
    if (typeof r.storageLocation !== 'string' || !VALID_LOCATIONS.has(r.storageLocation as StorageLocation)) {
      return null;
    }
    result.storageLocation = r.storageLocation as StorageLocation;
  }
  if (r.estimatedShelfLifeDaysFromPurchase !== null && r.estimatedShelfLifeDaysFromPurchase !== undefined) {
    if (!isFiniteNumber(r.estimatedShelfLifeDaysFromPurchase) || r.estimatedShelfLifeDaysFromPurchase <= 0) {
      return null;
    }
    result.estimatedShelfLifeDaysFromPurchase = Math.round(r.estimatedShelfLifeDaysFromPurchase);
  }
  if (r.explicitExpirationDate !== null && r.explicitExpirationDate !== undefined) {
    if (typeof r.explicitExpirationDate !== 'string' || !DATE_RE.test(r.explicitExpirationDate)) return null;
    result.explicitExpirationDate = r.explicitExpirationDate;
  }

  return result;
}

export interface ItemIdInput {
  itemId: string;
}

export function validateItemIdInput(x: unknown): ItemIdInput | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  if (!isNonEmptyString(r.itemId)) return null;
  return { itemId: r.itemId.trim() };
}

export interface ConsumeItemInput {
  itemId: string;
  amount: number;
}

export function validateConsumeItemInput(x: unknown): ConsumeItemInput | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  if (!isNonEmptyString(r.itemId)) return null;
  if (!isFiniteNumber(r.amount) || r.amount <= 0) return null;
  return { itemId: r.itemId.trim(), amount: r.amount };
}

export interface MoveItemInput {
  itemId: string;
  to: StorageLocation;
}

export function validateMoveItemInput(x: unknown): MoveItemInput | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  if (!isNonEmptyString(r.itemId)) return null;
  if (typeof r.to !== 'string' || !VALID_LOCATIONS.has(r.to as StorageLocation)) return null;
  return { itemId: r.itemId.trim(), to: r.to as StorageLocation };
}

// --- Item resolution ---
// The one place a model-supplied id is checked against the live snapshot.
// Deliberately takes the real GroceryItem[] (not the snapshot) since callers
// need the full item to execute a store action, not just its summary fields.

export function resolveItemId(itemId: string, items: GroceryItem[]): GroceryItem | undefined {
  return items.find((i) => i.id === itemId);
}
