import {
  resolveWeightKg,
  getEnvironmentalImpact,
  resolveDefaultWasteMethod,
  getUnmappedWastedItems,
} from '../services/environmentalImpact';
import type { DispositionEvent } from '../types/grocery';

describe('resolveWeightKg', () => {
  it('parses a bare weight unit (oz) directly from unitOfMeasure', () => {
    // 16oz of almond milk remaining, tracked as quantity-in-oz.
    expect(resolveWeightKg({ name: 'Unsweetened Vanilla Almond Milk', unitOfMeasure: 'oz', remainingQuantity: 16 }))
      .toBeCloseTo(16 * 0.0283495);
  });

  it('parses a compound unit that embeds its own weight ("6oz bag")', () => {
    expect(resolveWeightKg({ name: 'Shredded Mozzarella Cheese', unitOfMeasure: '6oz bag', remainingQuantity: 1 }))
      .toBeCloseTo(6 * 0.0283495);
  });

  it('parses "1lb bag" style units', () => {
    expect(resolveWeightKg({ name: 'String Beans', unitOfMeasure: '1lb bag', remainingQuantity: 1 }))
      .toBeCloseTo(0.453592);
  });

  it('falls back to the item table\'s typicalUnitWeightKg for ambiguous count units', () => {
    expect(resolveWeightKg({ name: 'Apples', unitOfMeasure: 'each', remainingQuantity: 3 }))
      .toBeCloseTo(3 * 0.18);
  });

  it('returns null when neither the unit nor the item table resolves a weight', () => {
    // Legacy "half gallon" record predating the oz-only convention — a
    // volume unit, not a weight, with no curated fallback.
    expect(resolveWeightKg({ name: 'Milk', unitOfMeasure: 'half gallon', remainingQuantity: 1 })).toBeNull();
  });

  it('returns null for an item not in the table using an ambiguous unit', () => {
    expect(resolveWeightKg({ name: 'Mystery Snack', unitOfMeasure: 'box', remainingQuantity: 1 })).toBeNull();
  });
});

describe('getEnvironmentalImpact', () => {
  it('computes co2eKg for a known item with a resolvable weight', () => {
    const result = getEnvironmentalImpact({ name: 'Apples', unitOfMeasure: 'each', remainingQuantity: 2 });
    expect(result).not.toBeNull();
    expect(result!.co2ePerKg).toBe(0.43);
    expect(result!.co2eKg).toBeCloseTo(2 * 0.18 * 0.43);
  });

  it('returns null for a known item whose weight cannot be resolved', () => {
    expect(getEnvironmentalImpact({ name: 'Milk', unitOfMeasure: 'half gallon', remainingQuantity: 1 })).toBeNull();
  });

  it('returns null for an item with no table entry at all', () => {
    expect(getEnvironmentalImpact({ name: 'Mystery Snack', unitOfMeasure: 'box', remainingQuantity: 1 })).toBeNull();
  });

  it('never falls back to a category average', () => {
    // "Pear" shares the produce category with Apples but has no entry of
    // its own — must be unknown, not silently priced off a neighbor.
    expect(getEnvironmentalImpact({ name: 'Pear', unitOfMeasure: 'each', remainingQuantity: 1 })).toBeNull();
  });
});

describe('resolveDefaultWasteMethod', () => {
  it('defaults produce to compost', () => {
    expect(resolveDefaultWasteMethod({ name: 'Zucchini' })).toBe('compost');
  });

  it('defaults liquids to drain', () => {
    expect(resolveDefaultWasteMethod({ name: 'Milk' })).toBe('drain');
  });

  it('falls back to trash for an item with no curated default', () => {
    expect(resolveDefaultWasteMethod({ name: 'Mystery Snack' })).toBe('trash');
  });
});

describe('getUnmappedWastedItems', () => {
  const usedChicken: DispositionEvent = {
    id: 'evt-1', itemId: 'a', itemName: 'Chicken', category: 'protein',
    disposition: 'used', quantity: 1, originalQuantity: 1, unitOfMeasure: 'lbs',
    date: new Date(), expiredAtTime: false,
  };
  const wastedMysterySnack: DispositionEvent = {
    id: 'evt-2', itemId: 'b', itemName: 'Mystery Snack', category: 'snacks',
    disposition: 'wasted', wasteMethod: 'trash', quantity: 1, originalQuantity: 1, unitOfMeasure: 'box',
    date: new Date(), expiredAtTime: true,
  };
  const wastedApples: DispositionEvent = {
    id: 'evt-3', itemId: 'c', itemName: 'Apples', category: 'produce',
    disposition: 'wasted', wasteMethod: 'compost', quantity: 2, originalQuantity: 2, unitOfMeasure: 'each',
    date: new Date(), expiredAtTime: true,
  };

  it('excludes used (non-wasted) events', () => {
    expect(getUnmappedWastedItems([usedChicken])).toEqual([]);
  });

  it('excludes wasted events for items already in the impact table', () => {
    expect(getUnmappedWastedItems([wastedApples])).toEqual([]);
  });

  it('includes wasted events for items with no impact-table entry', () => {
    const result = getUnmappedWastedItems([usedChicken, wastedMysterySnack, wastedApples]);
    expect(result).toEqual([{
      itemName: 'Mystery Snack',
      category: 'snacks',
      quantity: 1,
      unitOfMeasure: 'box',
      wasteMethod: 'trash',
      date: wastedMysterySnack.date,
    }]);
  });
});
