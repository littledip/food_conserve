import { GroceryItem } from '../types/grocery';
import { daysUntil, filterByDaysUntil } from '../stores/pantryStore';

const NOW = new Date('2026-05-09T12:00:00Z');
const offsetDay = (n: number) => new Date(NOW.getTime() + n * 86400000);

const makeItem = (id: string, expiresInDays: number): GroceryItem => ({
  id,
  name: id,
  category: 'other',
  storageLocation: 'fridge',
  storageHistory: [{ eventType: 'added', location: 'fridge', date: NOW }],
  effectiveExpirationDate: offsetDay(expiresInDays),
  expirationDateType: 'best_by',
  isFreezable: false,
  thawCycleCount: 0,
  unitOfMeasure: 'units',
  originalQuantity: 1,
  remainingQuantity: 1,
  purchaseDate: NOW,
  dateAdded: NOW,
  inputMethod: 'manual',
});

describe('daysUntil', () => {
  it('returns 0 when the item expires exactly now', () => {
    expect(daysUntil(NOW, NOW)).toBe(0);
  });

  it('returns 1 for an item expiring tomorrow (24 hours out)', () => {
    expect(daysUntil(offsetDay(1), NOW)).toBe(1);
  });

  it('returns 7 for an item expiring a week out', () => {
    expect(daysUntil(offsetDay(7), NOW)).toBe(7);
  });

  it('returns a negative number for items already expired', () => {
    expect(daysUntil(offsetDay(-2), NOW)).toBe(-2);
  });

  it('uses Math.ceil so a partial day rounds up to the next whole day', () => {
    const halfDay = new Date(NOW.getTime() + 86400000 / 2);
    expect(daysUntil(halfDay, NOW)).toBe(1);
  });
});

describe('filterByDaysUntil', () => {
  const items = [
    makeItem('expired', -2),
    makeItem('today', 0),
    makeItem('tomorrow', 1),
    makeItem('two-days', 2),
    makeItem('five-days', 5),
    makeItem('one-week', 7),
    makeItem('next-week', 10),
  ];

  it('returns urgent items when maxInclusive=1 (today + tomorrow + already expired)', () => {
    const result = filterByDaysUntil(items, { maxInclusive: 1 }, NOW);
    expect(result.map((i) => i.id)).toEqual(['expired', 'today', 'tomorrow']);
  });

  it('returns the full this-week range when maxInclusive=7', () => {
    const result = filterByDaysUntil(items, { maxInclusive: 7 }, NOW);
    expect(result.map((i) => i.id)).toEqual([
      'expired', 'today', 'tomorrow', 'two-days', 'five-days', 'one-week',
    ]);
  });

  it('returns the upcoming-week subset (excludes today/tomorrow) when minExclusive=1, maxInclusive=7', () => {
    const result = filterByDaysUntil(items, { minExclusive: 1, maxInclusive: 7 }, NOW);
    expect(result.map((i) => i.id)).toEqual(['two-days', 'five-days', 'one-week']);
  });

  it('boundary: minExclusive is exclusive (an item exactly at the threshold is excluded)', () => {
    const result = filterByDaysUntil(items, { minExclusive: 2, maxInclusive: 7 }, NOW);
    expect(result.map((i) => i.id)).toEqual(['five-days', 'one-week']);
  });

  it('boundary: maxInclusive is inclusive (an item exactly at the threshold is included)', () => {
    const result = filterByDaysUntil(items, { minExclusive: 1, maxInclusive: 7 }, NOW);
    expect(result.map((i) => i.id)).toContain('one-week');
  });

  it('returns an empty array when no items match', () => {
    const result = filterByDaysUntil(items, { minExclusive: 100 }, NOW);
    expect(result).toEqual([]);
  });

  it('returns an empty array given empty input', () => {
    expect(filterByDaysUntil([], { maxInclusive: 7 }, NOW)).toEqual([]);
  });

  it('returns all items when no bounds are given', () => {
    expect(filterByDaysUntil(items, {}, NOW)).toHaveLength(items.length);
  });

  it('preserves input order', () => {
    const reordered = [...items].reverse();
    const result = filterByDaysUntil(reordered, { maxInclusive: 7 }, NOW);
    expect(result.map((i) => i.id)).toEqual([
      'one-week', 'five-days', 'two-days', 'tomorrow', 'today', 'expired',
    ]);
  });
});
