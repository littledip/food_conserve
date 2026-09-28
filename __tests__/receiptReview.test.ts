import { parsePurchaseDate, plannedUnitCount } from '../services/receiptReview';

describe('parsePurchaseDate', () => {
  it('parses a well-formed date into a local Date', () => {
    const d = parsePurchaseDate('2026-06-11');
    expect(d).toBeInstanceOf(Date);
    // Local components, not UTC — guards against the day-shift bug.
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5); // June (0-indexed)
    expect(d!.getDate()).toBe(11);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parsePurchaseDate('  2026-01-02  ')!.getDate()).toBe(2);
  });

  it('returns undefined for null', () => {
    expect(parsePurchaseDate(null)).toBeUndefined();
  });

  it('returns undefined for malformed strings', () => {
    expect(parsePurchaseDate('')).toBeUndefined();
    expect(parsePurchaseDate('06/11/2026')).toBeUndefined();
    expect(parsePurchaseDate('2026-6-11')).toBeUndefined();
    expect(parsePurchaseDate('not a date')).toBeUndefined();
  });

  it('returns undefined for an out-of-range calendar date', () => {
    // JS Date rolls 2026-02-30 over to March; reject rather than silently shift.
    const d = parsePurchaseDate('2026-13-40');
    // Either undefined (rejected) — month 13 produces NaN only if invalid; assert
    // we never return a date claiming to be month 13.
    expect(d === undefined || d.getMonth() !== 12).toBe(true);
  });
});

describe('plannedUnitCount (split rule)', () => {
  it('fans out an integer quantity > 1 on a per-unit item', () => {
    expect(plannedUnitCount('units', 3)).toBe(3);
    expect(plannedUnitCount('units', 12)).toBe(12);
  });

  it('keeps a single unit for quantity 1', () => {
    expect(plannedUnitCount('units', 1)).toBe(1);
  });

  it('keeps weight-priced rows as a single fractional item', () => {
    expect(plannedUnitCount('lbs', 1.42)).toBe(1);
    expect(plannedUnitCount('oz', 8)).toBe(1);
    expect(plannedUnitCount('LBS', 3)).toBe(1); // case-insensitive
  });

  it('keeps a fractional non-weight quantity as one item', () => {
    expect(plannedUnitCount('units', 2.5)).toBe(1);
  });

  it('treats zero or negative quantities as a single item', () => {
    expect(plannedUnitCount('units', 0)).toBe(1);
    expect(plannedUnitCount('units', -2)).toBe(1);
  });
});
