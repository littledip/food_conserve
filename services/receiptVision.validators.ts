import type { ItemCategory, ParsedReceipt, ParsedReceiptItem } from '../types/grocery';

const VALID_CATEGORIES: ReadonlySet<ItemCategory> = new Set([
  'produce', 'protein', 'dairy', 'grains',
  'condiments', 'beverages', 'frozen', 'snacks', 'other',
]);

const VALID_CONFIDENCE: ReadonlySet<string> = new Set(['high', 'low']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isOptionalNumber = (v: unknown): boolean =>
  v === null || isFiniteNumber(v);

function validateItem(x: unknown): ParsedReceiptItem | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;

  if (typeof r.name !== 'string' || !r.name.trim()) return null;
  if (typeof r.category !== 'string' || !VALID_CATEGORIES.has(r.category as ItemCategory)) return null;
  if (!isFiniteNumber(r.quantity) || r.quantity <= 0) return null;
  if (typeof r.unitOfMeasure !== 'string' || !r.unitOfMeasure.trim()) return null;
  if (!isOptionalNumber(r.unitCost)) return null;
  if (!isOptionalNumber(r.totalCost)) return null;
  if (!isFiniteNumber(r.shelfLifeDays) || r.shelfLifeDays <= 0) return null;
  if (typeof r.confidence !== 'string' || !VALID_CONFIDENCE.has(r.confidence)) return null;

  return {
    name: r.name.trim(),
    category: r.category as ItemCategory,
    quantity: r.quantity,
    unitOfMeasure: r.unitOfMeasure.trim(),
    unitCost: r.unitCost as number | null,
    totalCost: r.totalCost as number | null,
    shelfLifeDays: Math.round(r.shelfLifeDays),
    confidence: r.confidence as 'high' | 'low',
  };
}

// Returns the validated ParsedReceipt or null if the payload doesn't match the
// schema. We coerce conservatively (round shelfLifeDays, trim strings) but
// reject anything structurally wrong — bad input is a prompt bug to surface,
// not paper over.
export function validateParsedReceipt(x: unknown): ParsedReceipt | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;

  const store =
    r.store === null ? null
    : typeof r.store === 'string' ? (r.store.trim() || null)
    : undefined;
  if (store === undefined) return null;

  let purchaseDate: string | null;
  if (r.purchaseDate === null) {
    purchaseDate = null;
  } else if (typeof r.purchaseDate === 'string' && DATE_RE.test(r.purchaseDate)) {
    purchaseDate = r.purchaseDate;
  } else {
    return null;
  }

  if (!Array.isArray(r.items)) return null;
  const items: ParsedReceiptItem[] = [];
  for (const raw of r.items) {
    const item = validateItem(raw);
    if (!item) return null;
    items.push(item);
  }

  return { store, purchaseDate, items };
}
