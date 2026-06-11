import { GroceryItem, DispositionEvent, RecallableItem } from '../types/grocery';
import {
  daysUntil,
  filterByDaysUntil,
  fractionalUseAmount,
  isRecallable,
  RECALL_WINDOW_DAYS,
  reviveItem,
  reviveDispositionEvent,
  usePantryStore,
} from '../stores/pantryStore';

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

describe('store actions: consumeItem', () => {
  beforeEach(() => {
    usePantryStore.setState({
      items: [
        makeItem('a', 5),
        makeItem('b', 3),
        makeItem('c', 1),
      ],
    });
  });

  it('decrements remainingQuantity by the consumed amount', () => {
    usePantryStore.getState().consumeItem('a', 0.4);
    const a = usePantryStore.getState().items.find((i) => i.id === 'a');
    expect(a?.remainingQuantity).toBeCloseTo(0.6);
  });

  it('clamps to 0 (does not go negative on over-use)', () => {
    usePantryStore.getState().consumeItem('a', 999);
    const a = usePantryStore.getState().items.find((i) => i.id === 'a');
    expect(a?.remainingQuantity).toBe(0);
  });

  it('is a no-op for an unknown id', () => {
    const before = usePantryStore.getState().items;
    usePantryStore.getState().consumeItem('nonexistent', 0.5);
    const after = usePantryStore.getState().items;
    expect(after.map((i) => i.remainingQuantity)).toEqual(before.map((i) => i.remainingQuantity));
  });

  it('does not modify other items', () => {
    usePantryStore.getState().consumeItem('a', 0.5);
    const b = usePantryStore.getState().items.find((i) => i.id === 'b');
    const c = usePantryStore.getState().items.find((i) => i.id === 'c');
    expect(b?.remainingQuantity).toBe(1);
    expect(c?.remainingQuantity).toBe(1);
  });
});

describe('store actions: removeItem', () => {
  beforeEach(() => {
    usePantryStore.setState({
      items: [
        makeItem('a', 5),
        makeItem('b', 3),
        makeItem('c', 1),
      ],
    });
  });

  it('removes the matching item', () => {
    usePantryStore.getState().removeItem('b');
    const ids = usePantryStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(['a', 'c']);
  });

  it('leaves other items untouched', () => {
    usePantryStore.getState().removeItem('a');
    const items = usePantryStore.getState().items;
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.remainingQuantity === 1)).toBe(true);
  });

  it('is a no-op for an unknown id', () => {
    usePantryStore.getState().removeItem('nonexistent');
    const ids = usePantryStore.getState().items.map((i) => i.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('handles removing the last item', () => {
    usePantryStore.setState({ items: [makeItem('only', 5)] });
    usePantryStore.getState().removeItem('only');
    expect(usePantryStore.getState().items).toEqual([]);
  });
});

describe('store actions: disposeItem', () => {
  // These items use real-time-relative expirations (rather than the fixed NOW
  // used elsewhere in this file), because disposeItem reads real Date.now()
  // internally to compute expiredAtTime — so the test needs to stay robust
  // regardless of when it runs.
  beforeEach(() => {
    const realDay = (n: number) => new Date(Date.now() + n * 86400000);
    usePantryStore.setState({
      items: [
        { ...makeItem('future', 0), effectiveExpirationDate: realDay(365) },
        { ...makeItem('today', 0), effectiveExpirationDate: realDay(0) },
        { ...makeItem('past', 0), effectiveExpirationDate: realDay(-30) },
      ],
      dispositionLog: [],
    });
  });

  it("disposeItem('used') removes the item and logs a Used event", () => {
    usePantryStore.getState().disposeItem('future', 'used');
    const state = usePantryStore.getState();
    expect(state.items.map((i) => i.id)).toEqual(['today', 'past']);
    expect(state.dispositionLog).toHaveLength(1);
    expect(state.dispositionLog[0]).toMatchObject({
      itemId: 'future',
      itemName: 'future',
      disposition: 'used',
      quantity: 1,
    });
  });

  it("disposeItem('wasted') removes the item and logs a Wasted event", () => {
    usePantryStore.getState().disposeItem('today', 'wasted');
    const state = usePantryStore.getState();
    expect(state.items.map((i) => i.id)).toEqual(['future', 'past']);
    expect(state.dispositionLog[0]).toMatchObject({
      itemId: 'today',
      disposition: 'wasted',
      quantity: 1,
    });
  });

  it('records expiredAtTime: true when expiration is in the past', () => {
    usePantryStore.getState().disposeItem('past', 'wasted');
    const event = usePantryStore.getState().dispositionLog[0];
    expect(event.expiredAtTime).toBe(true);
  });

  it('records expiredAtTime: false when expiration is in the future', () => {
    usePantryStore.getState().disposeItem('future', 'used');
    const event = usePantryStore.getState().dispositionLog[0];
    expect(event.expiredAtTime).toBe(false);
  });

  it('is a no-op for an unknown id (no event logged, items unchanged)', () => {
    const before = usePantryStore.getState();
    usePantryStore.getState().disposeItem('nonexistent', 'used');
    const after = usePantryStore.getState();
    expect(after.items).toEqual(before.items);
    expect(after.dispositionLog).toEqual([]);
  });
});

describe('fractionalUseAmount', () => {
  it('Brown rice: 1.5 of 2 lbs remaining, "Used half" should consume 0.75 (half of remaining), not 1.0 (half of original)', () => {
    const rice: GroceryItem = {
      ...makeItem('rice', 7),
      name: 'Brown rice',
      originalQuantity: 2,
      remainingQuantity: 1.5,
    };
    expect(fractionalUseAmount(rice, 2)).toBeCloseTo(0.75);
  });

  it('Eggs: 9 of 12 remaining, "Used a third" consumes 3 (a third of remaining)', () => {
    const eggs: GroceryItem = {
      ...makeItem('eggs', 7),
      originalQuantity: 12,
      remainingQuantity: 9,
    };
    expect(fractionalUseAmount(eggs, 3)).toBeCloseTo(3);
  });

  it('Fresh item (remaining === original): "Used half" consumes half', () => {
    const fresh: GroceryItem = {
      ...makeItem('fresh', 7),
      originalQuantity: 1,
      remainingQuantity: 1,
    };
    expect(fractionalUseAmount(fresh, 2)).toBeCloseTo(0.5);
  });
});

describe('store actions: moveItem (freezer)', () => {
  const DAY_MS = 86400000;

  const freezableItem = (id: string, opts: Partial<GroceryItem> = {}): GroceryItem => ({
    ...makeItem(id, 5),
    isFreezable: true,
    storageLocation: 'fridge',
    storageHistory: [{ eventType: 'added', location: 'fridge', date: NOW }],
    ...opts,
  });

  beforeEach(() => {
    usePantryStore.setState({ items: [freezableItem('a')], dispositionLog: [] });
  });

  it("moves item to 'freezer' and appends a moved_to_freezer event to storageHistory", () => {
    usePantryStore.getState().moveItem('a', 'freezer');
    const item = usePantryStore.getState().items[0];
    expect(item.storageLocation).toBe('freezer');
    const last = item.storageHistory[item.storageHistory.length - 1];
    expect(last.eventType).toBe('moved_to_freezer');
    expect(last.location).toBe('freezer');
  });

  it('sets freezerExpirationDate to default (~90 days out) when not previously set', () => {
    usePantryStore.getState().moveItem('a', 'freezer');
    const item = usePantryStore.getState().items[0];
    expect(item.freezerExpirationDate).toBeDefined();
    const days = Math.round((item.freezerExpirationDate!.getTime() - Date.now()) / DAY_MS);
    expect(days).toBeGreaterThanOrEqual(89);
    expect(days).toBeLessThanOrEqual(91);
  });

  it('uses existing freezerExpirationDate when already set', () => {
    const customExp = new Date('2026-09-01T00:00:00Z');
    usePantryStore.setState({
      items: [freezableItem('a', { freezerExpirationDate: customExp })],
      dispositionLog: [],
    });
    usePantryStore.getState().moveItem('a', 'freezer');
    const item = usePantryStore.getState().items[0];
    expect(item.freezerExpirationDate).toEqual(customExp);
  });

  it('updates effectiveExpirationDate to the freezer expiration date', () => {
    usePantryStore.getState().moveItem('a', 'freezer');
    const item = usePantryStore.getState().items[0];
    expect(item.effectiveExpirationDate).toEqual(item.freezerExpirationDate);
  });

  it('refreezing (after a moved_to_fridge event) increments thawCycleCount', () => {
    usePantryStore.setState({
      items: [freezableItem('a', {
        storageLocation: 'fridge',
        thawCycleCount: 0,
        storageHistory: [
          { eventType: 'added', location: 'fridge', date: NOW },
          { eventType: 'moved_to_freezer', location: 'freezer', date: NOW },
          { eventType: 'moved_to_fridge', location: 'fridge', date: NOW },
        ],
      })],
      dispositionLog: [],
    });
    usePantryStore.getState().moveItem('a', 'freezer');
    const item = usePantryStore.getState().items[0];
    expect(item.thawCycleCount).toBe(1);
  });

  it('first freeze (no prior moved_to_fridge in history) does not increment thawCycleCount', () => {
    usePantryStore.getState().moveItem('a', 'freezer');
    const item = usePantryStore.getState().items[0];
    expect(item.thawCycleCount).toBe(0);
  });

  it('is a no-op when target location equals current location', () => {
    usePantryStore.setState({
      items: [freezableItem('a', { storageLocation: 'freezer' })],
      dispositionLog: [],
    });
    const before = usePantryStore.getState().items[0];
    usePantryStore.getState().moveItem('a', 'freezer');
    const after = usePantryStore.getState().items[0];
    expect(after).toEqual(before);
  });
});

describe('reviveItem', () => {
  it('converts all Date fields back to Date instances after JSON round-trip', () => {
    const original: GroceryItem = {
      ...makeItem('rt', 5),
      printedExpirationDate: offsetDay(5),
      freezerExpirationDate: offsetDay(90),
      storageHistory: [
        { eventType: 'added', location: 'fridge', date: NOW },
        { eventType: 'moved_to_freezer', location: 'freezer', date: offsetDay(1) },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(original));
    const revived = reviveItem(roundTripped);

    expect(revived.effectiveExpirationDate).toBeInstanceOf(Date);
    expect(revived.effectiveExpirationDate.getTime()).toBe(original.effectiveExpirationDate.getTime());
    expect(revived.printedExpirationDate).toBeInstanceOf(Date);
    expect(revived.freezerExpirationDate).toBeInstanceOf(Date);
    expect(revived.purchaseDate).toBeInstanceOf(Date);
    expect(revived.dateAdded).toBeInstanceOf(Date);
    expect(revived.storageHistory).toHaveLength(2);
    expect(revived.storageHistory[0].date).toBeInstanceOf(Date);
    expect(revived.storageHistory[1].date.getTime()).toBe(offsetDay(1).getTime());
  });

  it('leaves optional Date fields undefined when not present in the input', () => {
    const original: GroceryItem = makeItem('no-optionals', 5);
    const roundTripped = JSON.parse(JSON.stringify(original));
    const revived = reviveItem(roundTripped);

    expect(revived.printedExpirationDate).toBeUndefined();
    expect(revived.freezerExpirationDate).toBeUndefined();
    expect(revived.effectiveExpirationDate).toBeInstanceOf(Date);
  });

  it('preserves non-date primitive fields', () => {
    const original: GroceryItem = {
      ...makeItem('strs', 5),
      name: 'Brown rice',
      category: 'grains',
      barcode: '012345678905',
      remainingQuantity: 1.5,
      originalQuantity: 2,
    };
    const revived = reviveItem(JSON.parse(JSON.stringify(original)));

    expect(revived.name).toBe('Brown rice');
    expect(revived.category).toBe('grains');
    expect(revived.barcode).toBe('012345678905');
    expect(revived.remainingQuantity).toBe(1.5);
    expect(revived.originalQuantity).toBe(2);
  });
});

describe('reviveDispositionEvent', () => {
  it('converts the date field back to a Date after JSON round-trip', () => {
    const original: DispositionEvent = {
      id: 'evt-1',
      itemId: 'a',
      itemName: 'Chicken',
      category: 'protein',
      disposition: 'wasted',
      quantity: 1.5,
      unitOfMeasure: 'lbs',
      date: NOW,
      expiredAtTime: true,
    };
    const revived = reviveDispositionEvent(JSON.parse(JSON.stringify(original)));

    expect(revived.date).toBeInstanceOf(Date);
    expect(revived.date.getTime()).toBe(NOW.getTime());
    expect(revived.disposition).toBe('wasted');
    expect(revived.quantity).toBe(1.5);
    expect(revived.expiredAtTime).toBe(true);
  });
});

describe('store actions: resetPantry', () => {
  it('clears items and dispositionLog', () => {
    usePantryStore.setState({
      items: [makeItem('a', 5), makeItem('b', 3)],
      dispositionLog: [
        {
          id: 'evt-1', itemId: 'a', itemName: 'a', category: 'other',
          disposition: 'used', quantity: 1, unitOfMeasure: 'units',
          date: NOW, expiredAtTime: false,
        },
      ],
    });
    usePantryStore.getState().resetPantry();
    const state = usePantryStore.getState();
    expect(state.items).toEqual([]);
    expect(state.dispositionLog).toEqual([]);
  });

  it('is idempotent when called on already-empty state', () => {
    usePantryStore.setState({ items: [], dispositionLog: [] });
    usePantryStore.getState().resetPantry();
    const state = usePantryStore.getState();
    expect(state.items).toEqual([]);
    expect(state.dispositionLog).toEqual([]);
  });
});

describe('store actions: consumeItem logs Used events', () => {
  beforeEach(() => {
    usePantryStore.setState({
      items: [makeItem('a', 5)],
      dispositionLog: [],
    });
  });

  it('appends a Used event with the consumed quantity', () => {
    usePantryStore.getState().consumeItem('a', 0.4);
    const log = usePantryStore.getState().dispositionLog;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      itemId: 'a',
      disposition: 'used',
      quantity: 0.4,
    });
  });

  it('does not log when called with an unknown id', () => {
    usePantryStore.getState().consumeItem('nonexistent', 0.5);
    expect(usePantryStore.getState().dispositionLog).toEqual([]);
  });
});

describe('isRecallable', () => {
  it('returns true within the window (6 days ago)', () => {
    const now = new Date('2026-05-29T12:00:00Z');
    const disposed = new Date(now.getTime() - 6 * 86400000);
    expect(isRecallable(disposed, now)).toBe(true);
  });

  it('returns false past the window (8 days ago)', () => {
    const now = new Date('2026-05-29T12:00:00Z');
    const disposed = new Date(now.getTime() - 8 * 86400000);
    expect(isRecallable(disposed, now)).toBe(false);
  });

  it('returns true at exactly the window boundary', () => {
    const now = new Date('2026-05-29T12:00:00Z');
    const disposed = new Date(now.getTime() - RECALL_WINDOW_DAYS * 86400000);
    expect(isRecallable(disposed, now)).toBe(true);
  });
});

describe('store actions: recallItem and disposeItem snapshotting', () => {
  beforeEach(() => {
    usePantryStore.getState().resetPantry();
    const realDay = (n: number) => new Date(Date.now() + n * 86400000);
    usePantryStore.setState({
      items: [
        { ...makeItem('milk', 0), effectiveExpirationDate: realDay(5) },
        { ...makeItem('bread', 0), effectiveExpirationDate: realDay(-2) }, // already expired
      ],
    });
  });

  it("disposeItem('used') adds a RecallableItem snapshot linked to the logged event", () => {
    usePantryStore.getState().disposeItem('milk', 'used');
    const state = usePantryStore.getState();
    expect(state.recallableItems).toHaveLength(1);
    const entry = state.recallableItems[0];
    expect(entry.item.id).toBe('milk');
    expect(entry.item.name).toBe('milk');
    expect(entry.item.remainingQuantity).toBe(1);
    expect(state.dispositionLog).toHaveLength(1);
    expect(entry.dispositionEventId).toBe(state.dispositionLog[0].id);
    expect(entry.disposedAt).toBeInstanceOf(Date);
  });

  it("disposeItem('wasted') does NOT add a recallable entry", () => {
    usePantryStore.getState().disposeItem('milk', 'wasted');
    const state = usePantryStore.getState();
    expect(state.recallableItems).toEqual([]);
    expect(state.dispositionLog).toHaveLength(1);
  });

  it('recallItem restores the item and reverses the disposition event', () => {
    usePantryStore.getState().disposeItem('milk', 'used');
    const original = usePantryStore.getState().recallableItems[0].item;

    usePantryStore.getState().recallItem('milk');
    const state = usePantryStore.getState();

    expect(state.items.map((i) => i.id)).toContain('milk');
    expect(state.recallableItems).toEqual([]);
    expect(state.dispositionLog).toEqual([]); // matching event removed
    const restored = state.items.find((i) => i.id === 'milk');
    expect(restored?.effectiveExpirationDate.getTime()).toBe(original.effectiveExpirationDate.getTime());
  });

  it('recallItem preserves an original past-dated expiration as-is', () => {
    usePantryStore.getState().disposeItem('bread', 'used');
    const originalExp = usePantryStore.getState().recallableItems[0].item.effectiveExpirationDate;
    usePantryStore.getState().recallItem('bread');
    const restored = usePantryStore.getState().items.find((i) => i.id === 'bread');
    expect(restored?.effectiveExpirationDate.getTime()).toBe(originalExp.getTime());
    // Sanity: this expiration is in the past
    expect(restored!.effectiveExpirationDate.getTime()).toBeLessThan(Date.now());
  });

  it('recallItem is a no-op for an unknown id', () => {
    const before = usePantryStore.getState();
    usePantryStore.getState().recallItem('nonexistent');
    const after = usePantryStore.getState();
    expect(after.items).toEqual(before.items);
    expect(after.recallableItems).toEqual(before.recallableItems);
    expect(after.dispositionLog).toEqual(before.dispositionLog);
  });

  it('disposeItem prunes recallable entries older than the window', () => {
    const stale: RecallableItem = {
      item: { ...makeItem('old-yogurt', 0) },
      dispositionEventId: 'evt-stale',
      disposedAt: new Date(Date.now() - 100 * 86400000), // way past 7d window
    };
    usePantryStore.setState({ recallableItems: [stale] });

    usePantryStore.getState().disposeItem('milk', 'used');
    const recallable = usePantryStore.getState().recallableItems;
    expect(recallable.map((r) => r.item.id)).toEqual(['milk']); // stale dropped
  });
});
