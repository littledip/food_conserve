// Pure, RN-free helpers for the receipt review → bulk-add step. Kept out of the
// scan screen so the split rule and date parsing are unit-testable without
// dragging in expo-camera et al. (same pattern as receiptVision.validators.ts).

// Weight-priced units stay a single fractional GroceryItem; everything else with
// an integer quantity > 1 fans out into that many single-unit items (the split
// rule). kg/g included for completeness though the parser only emits lbs/oz.
export const WEIGHT_UNITS = new Set(['lbs', 'oz', 'kg', 'g']);

// Parse the LLM's 'YYYY-MM-DD' purchase date into a local Date (not UTC, so the
// day doesn't shift across timezones). Returns undefined when absent/malformed,
// letting callers fall back to "now".
export function parsePurchaseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// How many independent pantry items a review row becomes under the split rule:
// an integer quantity > 1 on a per-unit item fans out into that many single-unit
// items; weight-priced or fractional rows stay one item.
export function plannedUnitCount(unitOfMeasure: string, quantity: number): number {
  const isWeight = WEIGHT_UNITS.has(unitOfMeasure.toLowerCase());
  return !isWeight && Number.isInteger(quantity) && quantity > 1 ? quantity : 1;
}
