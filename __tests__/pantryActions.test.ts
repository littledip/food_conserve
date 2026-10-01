import {
  buildItem,
  buildItemFromChatInput,
  buildUpdatePatchFromChatInput,
  storageForCategory,
} from '../services/pantryActions';
import type { GroceryItem } from '../types/grocery';

describe('storageForCategory', () => {
  it('maps produce/protein/dairy to fridge', () => {
    expect(storageForCategory('produce')).toBe('fridge');
    expect(storageForCategory('protein')).toBe('fridge');
    expect(storageForCategory('dairy')).toBe('fridge');
  });

  it('maps frozen to freezer', () => {
    expect(storageForCategory('frozen')).toBe('freezer');
  });

  it('maps everything else to pantry', () => {
    expect(storageForCategory('grains')).toBe('pantry');
    expect(storageForCategory('other')).toBe('pantry');
  });
});

describe('buildItem', () => {
  it('constructs a GroceryItem from the given fields', () => {
    const exp = new Date('2026-07-01');
    const item = buildItem({
      name: 'Milk',
      category: 'dairy',
      expirationDate: exp,
      expirationType: 'best_by',
      storageLocation: 'fridge',
      quantity: 1,
      unit: 'gal',
      store: 'Kroger',
      inputMethod: 'manual',
    });

    expect(item.name).toBe('Milk');
    expect(item.remainingQuantity).toBe(1);
    expect(item.originalQuantity).toBe(1);
    expect(item.effectiveExpirationDate).toBe(exp);
    expect(item.storageHistory).toHaveLength(1);
    expect(item.storageHistory[0].eventType).toBe('added');
    expect(item.id).toBeTruthy();
  });

  it('treats an empty store string as undefined', () => {
    const item = buildItem({
      name: 'Rice',
      category: 'grains',
      expirationDate: new Date(),
      expirationType: 'estimated',
      storageLocation: 'pantry',
      quantity: 1,
      unit: 'lbs',
      store: '',
      inputMethod: 'manual',
    });
    expect(item.store).toBeUndefined();
  });
});

describe('buildItemFromChatInput', () => {
  const now = new Date('2026-06-15T00:00:00');

  it('derives the expiration date from estimatedShelfLifeDays when no explicit date is given', () => {
    const item = buildItemFromChatInput(
      {
        name: 'Eggs',
        category: 'dairy',
        quantity: 12,
        unitOfMeasure: 'each',
        estimatedShelfLifeDays: 21,
        explicitExpirationDate: null,
        unitCost: null,
        totalCost: null,
      },
      now,
    );
    const expected = new Date(now);
    expected.setHours(0, 0, 0, 0);
    expected.setDate(expected.getDate() + 21);
    expect(item.effectiveExpirationDate.getTime()).toBe(expected.getTime());
  });

  it('prefers an explicit date over the shelf-life estimate', () => {
    const item = buildItemFromChatInput(
      {
        name: 'Bread',
        category: 'grains',
        quantity: 1,
        unitOfMeasure: 'loaf',
        estimatedShelfLifeDays: 5,
        explicitExpirationDate: '2026-07-04',
        unitCost: null,
        totalCost: null,
      },
      now,
    );
    expect(item.effectiveExpirationDate.getFullYear()).toBe(2026);
    expect(item.effectiveExpirationDate.getMonth()).toBe(6); // July
    expect(item.effectiveExpirationDate.getDate()).toBe(4);
  });

  it('falls back to the category default storage location when omitted', () => {
    const item = buildItemFromChatInput(
      {
        name: 'Chicken',
        category: 'protein',
        quantity: 1,
        unitOfMeasure: 'lbs',
        estimatedShelfLifeDays: 3,
        explicitExpirationDate: null,
        unitCost: null,
        totalCost: null,
      },
      now,
    );
    expect(item.storageLocation).toBe('fridge');
  });

  it('honors an explicit storageLocation override', () => {
    const item = buildItemFromChatInput(
      {
        name: 'Soup',
        category: 'other',
        quantity: 1,
        unitOfMeasure: 'can',
        storageLocation: 'freezer',
        estimatedShelfLifeDays: 300,
        explicitExpirationDate: null,
        unitCost: null,
        totalCost: null,
      },
      now,
    );
    expect(item.storageLocation).toBe('freezer');
  });

  it('marks expirationDateType as estimated and inputMethod as manual', () => {
    const item = buildItemFromChatInput(
      {
        name: 'Yogurt',
        category: 'dairy',
        quantity: 1,
        unitOfMeasure: 'each',
        estimatedShelfLifeDays: 21,
        explicitExpirationDate: null,
        unitCost: null,
        totalCost: null,
      },
      now,
    );
    expect(item.expirationDateType).toBe('estimated');
    expect(item.inputMethod).toBe('manual');
  });
});

describe('buildUpdatePatchFromChatInput', () => {
  const existingItem: GroceryItem = {
    id: 'item-1',
    name: 'Eggs',
    category: 'dairy',
    storageLocation: 'fridge',
    storageHistory: [],
    effectiveExpirationDate: new Date('2026-06-21'),
    expirationDateType: 'estimated',
    isFreezable: false,
    thawCycleCount: 0,
    unitOfMeasure: 'each',
    originalQuantity: 12,
    remainingQuantity: 12,
    purchaseDate: new Date('2026-05-31T00:00:00'),
    dateAdded: new Date('2026-05-31T00:00:00'),
    inputMethod: 'manual',
  };

  it('patches only the fields given', () => {
    const patch = buildUpdatePatchFromChatInput({ category: 'other' }, existingItem);
    expect(patch).toEqual({ category: 'other' });
  });

  it('re-estimates the expiration from the original purchaseDate, not today', () => {
    const patch = buildUpdatePatchFromChatInput(
      { estimatedShelfLifeDaysFromPurchase: 25 },
      existingItem,
    );
    const expected = new Date(existingItem.purchaseDate);
    expected.setHours(0, 0, 0, 0);
    expected.setDate(expected.getDate() + 25);
    expect(patch.effectiveExpirationDate?.getTime()).toBe(expected.getTime());
    expect(patch.printedExpirationDate?.getTime()).toBe(expected.getTime());
    expect(patch.expirationDateType).toBe('estimated');
  });

  it('prefers an explicit date over a shelf-life re-estimate', () => {
    const patch = buildUpdatePatchFromChatInput(
      { explicitExpirationDate: '2026-07-04', estimatedShelfLifeDaysFromPurchase: 25 },
      existingItem,
    );
    expect(patch.effectiveExpirationDate?.getFullYear()).toBe(2026);
    expect(patch.effectiveExpirationDate?.getMonth()).toBe(6);
    expect(patch.effectiveExpirationDate?.getDate()).toBe(4);
  });

  it('returns an empty patch when nothing is given', () => {
    expect(buildUpdatePatchFromChatInput({}, existingItem)).toEqual({});
  });
});
