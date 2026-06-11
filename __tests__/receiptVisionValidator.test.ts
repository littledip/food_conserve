import { validateParsedReceipt } from '../services/receiptVision.validators';

const validItem = {
  name: 'Organic Bananas',
  category: 'produce',
  quantity: 1.42,
  unitOfMeasure: 'lbs',
  unitCost: 0.59,
  totalCost: 0.84,
  shelfLifeDays: 6,
  confidence: 'high',
};

const validReceipt = {
  store: 'Whole Foods',
  purchaseDate: '2026-06-07',
  items: [validItem],
};

describe('validateParsedReceipt — happy path', () => {
  it('accepts a well-formed payload and returns it', () => {
    const result = validateParsedReceipt(validReceipt);
    expect(result).not.toBeNull();
    expect(result!.store).toBe('Whole Foods');
    expect(result!.purchaseDate).toBe('2026-06-07');
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0]).toMatchObject({
      name: 'Organic Bananas',
      category: 'produce',
      shelfLifeDays: 6,
    });
  });

  it('accepts null store and null purchaseDate', () => {
    const result = validateParsedReceipt({ ...validReceipt, store: null, purchaseDate: null });
    expect(result).not.toBeNull();
    expect(result!.store).toBeNull();
    expect(result!.purchaseDate).toBeNull();
  });

  it('accepts null unitCost and null totalCost on an item', () => {
    const result = validateParsedReceipt({
      ...validReceipt,
      items: [{ ...validItem, unitCost: null, totalCost: null }],
    });
    expect(result).not.toBeNull();
    expect(result!.items[0].unitCost).toBeNull();
    expect(result!.items[0].totalCost).toBeNull();
  });

  it('accepts an empty items array', () => {
    const result = validateParsedReceipt({ ...validReceipt, items: [] });
    expect(result).not.toBeNull();
    expect(result!.items).toEqual([]);
  });

  it('rounds non-integer shelfLifeDays', () => {
    const result = validateParsedReceipt({
      ...validReceipt,
      items: [{ ...validItem, shelfLifeDays: 6.7 }],
    });
    expect(result!.items[0].shelfLifeDays).toBe(7);
  });

  it('trims whitespace from store and item names', () => {
    const result = validateParsedReceipt({
      ...validReceipt,
      store: '  Whole Foods  ',
      items: [{ ...validItem, name: '  Organic Bananas  ' }],
    });
    expect(result!.store).toBe('Whole Foods');
    expect(result!.items[0].name).toBe('Organic Bananas');
  });

  it('treats whitespace-only store as null', () => {
    const result = validateParsedReceipt({ ...validReceipt, store: '   ' });
    expect(result!.store).toBeNull();
  });
});

describe('validateParsedReceipt — rejection cases', () => {
  it('rejects non-object input', () => {
    expect(validateParsedReceipt(null)).toBeNull();
    expect(validateParsedReceipt('not an object')).toBeNull();
    expect(validateParsedReceipt(42)).toBeNull();
    expect(validateParsedReceipt([])).toBeNull();
  });

  it('rejects bad purchaseDate format', () => {
    expect(validateParsedReceipt({ ...validReceipt, purchaseDate: '6/7/2026' })).toBeNull();
    expect(validateParsedReceipt({ ...validReceipt, purchaseDate: '2026-6-7' })).toBeNull();
    expect(validateParsedReceipt({ ...validReceipt, purchaseDate: 1234 })).toBeNull();
  });

  it('rejects missing items array', () => {
    const { items: _items, ...rest } = validReceipt;
    expect(validateParsedReceipt(rest)).toBeNull();
  });

  it('rejects unknown category', () => {
    const result = validateParsedReceipt({
      ...validReceipt,
      items: [{ ...validItem, category: 'pharmacy' }],
    });
    expect(result).toBeNull();
  });

  it('rejects unknown confidence value', () => {
    const result = validateParsedReceipt({
      ...validReceipt,
      items: [{ ...validItem, confidence: 'medium' }],
    });
    expect(result).toBeNull();
  });

  it('rejects empty name', () => {
    const result = validateParsedReceipt({
      ...validReceipt,
      items: [{ ...validItem, name: '   ' }],
    });
    expect(result).toBeNull();
  });

  it('rejects non-positive quantity', () => {
    expect(validateParsedReceipt({
      ...validReceipt, items: [{ ...validItem, quantity: 0 }],
    })).toBeNull();
    expect(validateParsedReceipt({
      ...validReceipt, items: [{ ...validItem, quantity: -1 }],
    })).toBeNull();
  });

  it('rejects non-finite shelfLifeDays', () => {
    expect(validateParsedReceipt({
      ...validReceipt, items: [{ ...validItem, shelfLifeDays: 0 }],
    })).toBeNull();
    expect(validateParsedReceipt({
      ...validReceipt, items: [{ ...validItem, shelfLifeDays: Infinity }],
    })).toBeNull();
  });

  it('rejects non-numeric unitCost (other than null)', () => {
    const result = validateParsedReceipt({
      ...validReceipt,
      items: [{ ...validItem, unitCost: 'cheap' }],
    });
    expect(result).toBeNull();
  });

  it('rejects if any one item is bad — strict mode', () => {
    const result = validateParsedReceipt({
      ...validReceipt,
      items: [validItem, { ...validItem, category: 'invalid' }],
    });
    expect(result).toBeNull();
  });
});
