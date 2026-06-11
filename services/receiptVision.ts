import type { ParsedReceipt } from '../types/grocery';
import { validateParsedReceipt } from './receiptVision.validators';

// Start with Sonnet 4.6 for the best accuracy/cost balance on receipt parsing;
// downgrade to Haiku 4.5 once we have a sense of how often it suffices.
export const RECEIPT_VISION_MODEL = 'claude-sonnet-4-6';

export type ReceiptImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export class ReceiptParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ReceiptParseError';
  }
}

// Tool used to force structured output. Claude 4.x doesn't support assistant
// prefill, so we use tool_choice to guarantee the model returns the structured
// payload (no prose escape, no JSON fences, no "let me explain" detours).
const RECEIPT_TOOL_NAME = 'submit_parsed_receipt';

const RECEIPT_TOOL = {
  name: RECEIPT_TOOL_NAME,
  description: 'Submit the structured grocery items parsed from the receipt image. Call this exactly once with the full parsed result.',
  input_schema: {
    type: 'object' as const,
    properties: {
      store: {
        type: ['string', 'null'],
        description: 'Store name from the receipt header, or null if not visible.',
      },
      purchaseDate: {
        type: ['string', 'null'],
        description: 'Purchase date in YYYY-MM-DD format, or null if not visible.',
      },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            category: {
              type: 'string',
              enum: ['produce', 'protein', 'dairy', 'grains', 'condiments', 'beverages', 'frozen', 'snacks', 'other'],
            },
            quantity: { type: 'number' },
            unitOfMeasure: { type: 'string' },
            unitCost: { type: ['number', 'null'] },
            totalCost: { type: ['number', 'null'] },
            shelfLifeDays: { type: 'integer' },
            confidence: { type: 'string', enum: ['high', 'low'] },
          },
          required: ['name', 'category', 'quantity', 'unitOfMeasure', 'unitCost', 'totalCost', 'shelfLifeDays', 'confidence'],
        },
      },
    },
    required: ['store', 'purchaseDate', 'items'],
  },
};

export const RECEIPT_SYSTEM_PROMPT = `You are a grocery receipt parser. Extract food items from the receipt image and call the submit_parsed_receipt tool with the structured payload. The tool's schema defines the exact shape; the rules below define how to populate it.

Rules:
1. EXCLUDE non-food items entirely — do NOT return them under ANY category, including "other". Many receipts (supermarkets especially) mix food and non-food on a single bill; apply this strictly regardless of where the line appears. Examples to exclude: cleaning products, laundry detergent, dish soap, paper goods (paper towels, toilet paper, napkins, tissues), toiletries (toothpaste, soap, shampoo, deodorant, razors), pet food/supplies, batteries, candles, kitchenware, garden supplies, tobacco, gift cards, lottery tickets, magazines, light bulbs, foil/wraps, trash bags. The "other" category is reserved for EDIBLE items that don't cleanly fit produce/protein/dairy/grains/condiments/beverages/frozen/snacks (e.g. honey, broth, ready-made meal kits, ice).

   CRITICAL — DO NOT FABRICATE:
   - If a line's abbreviation could plausibly map to either a food OR a non-food product (e.g. "CAS APPL LM" could be Cashmere Apple Liquid laundry detergent, Cascade dish soap, OR a hypothetical apple drink) — SKIP the line. Do not pick the food interpretation.
   - Price sanity: if the price doesn't fit the inferred food item (e.g. >$15 for a single small drink, ~$20 for a "juice"), the inference is probably wrong — skip.
   - You may NOT use generic placeholders ("unknown beverage", "unknown packaged item", etc.) — they are not acceptable. Either you can confidently identify both brand AND product type from the receipt text, or you skip the line entirely.
   - It is far better to miss 5 real items than to fabricate 1. The user will scan more receipts; they cannot easily un-fabricate an item that's wrong.

   DISQUALIFYING KEYWORDS — if ANY of these words appear in the line text (including abbreviated forms), SKIP the line unconditionally, regardless of whatever else is in the name. This list overrides any food-y wording around it: SOAP, DETERGENT, BLEACH, CLEANER, WASH, WIPES, TOWEL, TISSUE, NAPKIN, RAZOR, BLADE, TOOTHPASTE, SHAMPOO, CONDITIONER, LOTION, DEODORANT, BATTERY, BATTERIES, BULB, FOIL, TRASH, GARBAGE, BAG, KITTY, PUPPY, LITTER, PET FOOD, DOG, CAT, CHARCOAL, CANDLE.
2. Skip taxes, subtotals, totals, fees, tips.
3. Skip discount-only lines (a discount amount without a paired item).
4. Weight-priced (e.g. "BANANA 1.42 lb @ 0.59/lb"): unitOfMeasure="lbs", quantity=1.42, unitCost=0.59, totalCost=1.42×0.59 rounded to cents.
5. MULTI-QUANTITY: many receipts (Whole Foods especially) show a sub-line beneath the item like "Qty 2 @ $5.99 ea  $11.98" or "2 @ 1.99  3.98". When present, set quantity to that N (not 1), unitOfMeasure to "each" (or "lbs"/"oz" if weight-based), unitCost to the per-unit price, and totalCost to the line total. Do NOT default to quantity=1 when a Qty indicator is visible.
6. RECONCILE: after extracting each item, verify that quantity × unitCost ≈ totalCost (within $0.02 for rounding). If they don't reconcile, you've almost certainly misread the quantity or one of the prices — re-examine the line and fix. Common mistake: missing a "Qty N" sub-line and reporting quantity=1 with mismatched totalCost. Get this right; the user audits totals.
7. Expand abbreviations: "ORG BAN" -> "Organic Bananas", "GR BF 80/20" -> "Ground Beef 80/20".
8. Shelf life estimates (typical, days after purchase). Each entry is a range — pick a single integer in the range. Prefer the LOWER bound when storage or condition is ambiguous; reserve the upper bound for clearly sealed, unopened, or ideally-stored items.
   - Fresh fish/seafood: 2-3
   - Leafy greens / berries: 5-7
   - Other fresh produce: 5-10
   - Fresh milk, deli meat: 7-10
   - Eggs, hard cheese, yogurt: 21-30
   - Frozen foods: 180-365
   - Dry pantry (rice, pasta, flour): 365-730
   - Canned goods: 730-1095
9. If a line had a discount/BOGO that you netted into totalCost, mark confidence "low".`;

export interface ParseReceiptOptions {
  // Optional progress hook fired as text tokens arrive from the stream. Useful
  // for surfacing "we're working on it" feedback during long parses (a 40-item
  // receipt currently takes ~45s end-to-end). The text-by-text incremental
  // item-extraction for the in-app review list lives in a separate helper.
  onTextDelta?: (delta: string) => void;
}

// The /v1/messages request body, minus transport concerns (no `stream` flag —
// each caller adds it: the Node script via the SDK's .stream(), the app via a
// raw fetch with `stream: true`). Kept loosely typed so this module stays free
// of any SDK import; transports cast to their own param type at the boundary.
export interface ReceiptRequestBody {
  model: string;
  max_tokens: number;
  system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  tools: object[];
  tool_choice: { type: 'tool'; name: string };
  messages: Array<{
    role: 'user';
    content: Array<{
      type: 'image';
      source: { type: 'base64'; media_type: ReceiptImageMediaType; data: string };
    }>;
  }>;
}

// A content block as it appears in a /v1/messages response. We only care about
// the tool_use block's `input`; everything else is ignored.
interface ResponseContentBlock {
  type: string;
  input?: unknown;
}

/**
 * Builds the request body for a single receipt-image parse. Pure — no I/O, no
 * SDK, no expo-* imports — so it's shared verbatim by the app (fetch transport)
 * and the standalone test script (SDK transport).
 */
export function buildReceiptRequestBody(
  imageBase64: string,
  mediaType: ReceiptImageMediaType = 'image/jpeg',
): ReceiptRequestBody {
  return {
    model: RECEIPT_VISION_MODEL,
    // Receipts can have 40+ items; budget generously to avoid truncated JSON.
    max_tokens: 16384,
    // Cache the static prompt; subsequent receipts within ~5min share the cache.
    system: [
      {
        type: 'text',
        text: RECEIPT_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [RECEIPT_TOOL],
    // Force the model to call the tool; guarantees structured output, no prose
    // narration of ambiguous lines.
    tool_choice: { type: 'tool', name: RECEIPT_TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
        ],
      },
    ],
  };
}

/**
 * Extracts and validates the ParsedReceipt from a response's content blocks.
 * Throws ReceiptParseError if there's no tool_use block or it fails the schema.
 * Pure — transports hand it whatever content they've assembled.
 */
export function parseReceiptToolUse(content: ReadonlyArray<ResponseContentBlock>): ParsedReceipt {
  const toolBlock = content.find((c) => c.type === 'tool_use');
  if (!toolBlock) {
    throw new ReceiptParseError('Vision response contained no tool_use block');
  }

  const validated = validateParsedReceipt(toolBlock.input);
  if (!validated) {
    throw new ReceiptParseError(
      `Vision response did not match schema: ${JSON.stringify(toolBlock.input).slice(0, 300)}`,
    );
  }
  return validated;
}
