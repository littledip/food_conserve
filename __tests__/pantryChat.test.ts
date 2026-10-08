import {
  buildPantrySnapshot,
  resolveItemId,
  validateAddItemsInput,
  validateConsumeItemInput,
  validateDisposeItemWastedInput,
  validateItemIdInput,
  validateMoveItemInput,
  validateUpdateItemInput,
} from '../services/pantryChat';
import type { GroceryItem, RecallableItem } from '../types/grocery';

function makeItem(overrides: Partial<GroceryItem> = {}): GroceryItem {
  const now = new Date('2026-06-15');
  return {
    id: 'item-1',
    name: 'Milk',
    category: 'dairy',
    storageLocation: 'fridge',
    storageHistory: [],
    effectiveExpirationDate: new Date('2026-06-20'),
    expirationDateType: 'best_by',
    isFreezable: false,
    thawCycleCount: 0,
    unitOfMeasure: 'gal',
    originalQuantity: 1,
    remainingQuantity: 1,
    purchaseDate: now,
    dateAdded: now,
    inputMethod: 'manual',
    ...overrides,
  };
}

describe('buildPantrySnapshot', () => {
  const now = new Date('2026-06-15T00:00:00');

  it('computes daysUntilExpiration relative to now', () => {
    const item = makeItem({ effectiveExpirationDate: new Date('2026-06-20T00:00:00') });
    const snapshot = buildPantrySnapshot([item], [], now);
    expect(snapshot.nowIso).toBe('2026-06-15');
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].id).toBe('item-1');
    expect(snapshot.items[0].daysUntilExpiration).toBe(5);
  });

  it('includes recently-used items with days-ago', () => {
    const recallable: RecallableItem[] = [
      {
        item: makeItem({ id: 'item-2', name: 'Eggs' }),
        dispositionEventId: 'evt-1',
        disposedAt: new Date('2026-06-13T00:00:00'),
      },
    ];
    const snapshot = buildPantrySnapshot([], recallable, now);
    expect(snapshot.recentlyUsed).toEqual([{ itemId: 'item-2', name: 'Eggs', disposedDaysAgo: 2 }]);
  });
});

describe('validateAddItemsInput', () => {
  const validItem = {
    name: 'Eggs',
    category: 'dairy',
    quantity: 12,
    unitOfMeasure: 'each',
    storageLocation: null,
    estimatedShelfLifeDays: 21,
    explicitExpirationDate: null,
    unitCost: null,
    totalCost: null,
  };

  it('accepts a well-formed single-item payload', () => {
    const result = validateAddItemsInput({ items: [validItem] });
    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].storageLocation).toBeUndefined();
  });

  it('accepts multiple items in one call', () => {
    const result = validateAddItemsInput({
      items: [validItem, { ...validItem, name: 'Bread', category: 'grains' }],
    });
    expect(result!.items).toHaveLength(2);
  });

  it('rejects an empty items array', () => {
    expect(validateAddItemsInput({ items: [] })).toBeNull();
  });

  it('rejects an invalid category', () => {
    expect(validateAddItemsInput({ items: [{ ...validItem, category: 'nonsense' }] })).toBeNull();
  });

  it('rejects a non-positive quantity', () => {
    expect(validateAddItemsInput({ items: [{ ...validItem, quantity: 0 }] })).toBeNull();
  });

  it('rejects a malformed explicitExpirationDate', () => {
    expect(
      validateAddItemsInput({ items: [{ ...validItem, explicitExpirationDate: '06/01/2026' }] }),
    ).toBeNull();
  });

  it('accepts a valid explicit storageLocation', () => {
    const result = validateAddItemsInput({ items: [{ ...validItem, storageLocation: 'freezer' }] });
    expect(result!.items[0].storageLocation).toBe('freezer');
  });

  it('rejects an invalid storageLocation', () => {
    expect(validateAddItemsInput({ items: [{ ...validItem, storageLocation: 'garage' }] })).toBeNull();
  });

  it('accepts a name-only item and fills in defaults for everything else', () => {
    const result = validateAddItemsInput({ items: [{ name: 'Peanut Butter' }] });
    expect(result).not.toBeNull();
    expect(result!.items[0]).toEqual({
      name: 'Peanut Butter',
      category: 'other',
      quantity: 1,
      unitOfMeasure: 'each',
      storageLocation: undefined,
      estimatedShelfLifeDays: 14,
      explicitExpirationDate: null,
      unitCost: null,
      totalCost: null,
    });
  });

  it('still rejects a name-only item with no name at all', () => {
    expect(validateAddItemsInput({ items: [{}] })).toBeNull();
  });

  it('defaults are applied independently — a provided category does not force providing others', () => {
    const result = validateAddItemsInput({ items: [{ name: 'Peanut Butter', category: 'condiments' }] });
    expect(result!.items[0].category).toBe('condiments');
    expect(result!.items[0].quantity).toBe(1);
    expect(result!.items[0].estimatedShelfLifeDays).toBe(14);
  });
});

describe('validateItemIdInput', () => {
  it('accepts and trims a non-empty itemId', () => {
    expect(validateItemIdInput({ itemId: ' abc ' })).toEqual({ itemId: 'abc' });
  });

  it('rejects a missing or empty itemId', () => {
    expect(validateItemIdInput({})).toBeNull();
    expect(validateItemIdInput({ itemId: '' })).toBeNull();
  });
});

describe('validateDisposeItemWastedInput', () => {
  it('accepts an itemId with wasteMethod null, defaulting the field to null', () => {
    expect(validateDisposeItemWastedInput({ itemId: 'x', wasteMethod: null })).toEqual({
      itemId: 'x',
      wasteMethod: null,
    });
  });

  it('accepts an itemId with wasteMethod omitted entirely', () => {
    expect(validateDisposeItemWastedInput({ itemId: 'x' })).toEqual({ itemId: 'x', wasteMethod: null });
  });

  it('accepts a valid explicit wasteMethod', () => {
    expect(validateDisposeItemWastedInput({ itemId: 'x', wasteMethod: 'compost' })).toEqual({
      itemId: 'x',
      wasteMethod: 'compost',
    });
    expect(validateDisposeItemWastedInput({ itemId: 'x', wasteMethod: 'drain' })).toEqual({
      itemId: 'x',
      wasteMethod: 'drain',
    });
  });

  it('rejects an invalid wasteMethod', () => {
    expect(validateDisposeItemWastedInput({ itemId: 'x', wasteMethod: 'recycle' })).toBeNull();
  });

  it('rejects a missing or empty itemId', () => {
    expect(validateDisposeItemWastedInput({ wasteMethod: 'trash' })).toBeNull();
    expect(validateDisposeItemWastedInput({ itemId: '', wasteMethod: 'trash' })).toBeNull();
  });
});

describe('validateConsumeItemInput', () => {
  it('accepts a positive amount', () => {
    expect(validateConsumeItemInput({ itemId: 'x', amount: 0.5 })).toEqual({ itemId: 'x', amount: 0.5 });
  });

  it('rejects a zero or negative amount', () => {
    expect(validateConsumeItemInput({ itemId: 'x', amount: 0 })).toBeNull();
    expect(validateConsumeItemInput({ itemId: 'x', amount: -1 })).toBeNull();
  });
});

describe('validateUpdateItemInput', () => {
  it('accepts an itemId-only payload with everything else null', () => {
    const result = validateUpdateItemInput({
      itemId: 'x',
      name: null,
      category: null,
      storageLocation: null,
      estimatedShelfLifeDaysFromPurchase: null,
      explicitExpirationDate: null,
    });
    expect(result).toEqual({ itemId: 'x' });
  });

  it('accepts a partial correction (category only)', () => {
    const result = validateUpdateItemInput({
      itemId: 'x',
      name: null,
      category: 'produce',
      storageLocation: null,
      estimatedShelfLifeDaysFromPurchase: null,
      explicitExpirationDate: null,
    });
    expect(result).toEqual({ itemId: 'x', category: 'produce' });
  });

  it('rejects a missing itemId', () => {
    expect(validateUpdateItemInput({ name: 'Eggs' })).toBeNull();
  });

  it('rejects an invalid category', () => {
    expect(validateUpdateItemInput({ itemId: 'x', category: 'nonsense' })).toBeNull();
  });

  it('rejects a non-positive shelf-life re-estimate', () => {
    expect(validateUpdateItemInput({ itemId: 'x', estimatedShelfLifeDaysFromPurchase: 0 })).toBeNull();
  });

  it('rejects a malformed explicit date', () => {
    expect(validateUpdateItemInput({ itemId: 'x', explicitExpirationDate: '07/04/2026' })).toBeNull();
  });
});

describe('validateMoveItemInput', () => {
  it('accepts a valid location', () => {
    expect(validateMoveItemInput({ itemId: 'x', to: 'freezer' })).toEqual({ itemId: 'x', to: 'freezer' });
  });

  it('rejects an invalid location', () => {
    expect(validateMoveItemInput({ itemId: 'x', to: 'garage' })).toBeNull();
  });
});

describe('resolveItemId', () => {
  it('finds an item by id', () => {
    const item = makeItem();
    expect(resolveItemId('item-1', [item])).toBe(item);
  });

  it('returns undefined when not found', () => {
    expect(resolveItemId('missing', [makeItem()])).toBeUndefined();
  });
});
