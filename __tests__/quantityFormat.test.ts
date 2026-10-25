import { formatQuantity } from '../services/quantityFormat';

describe('formatQuantity', () => {
  it('passes whole numbers through unchanged', () => {
    expect(formatQuantity(0)).toBe('0');
    expect(formatQuantity(1)).toBe('1');
    expect(formatQuantity(12)).toBe('12');
  });

  it('spells out common proper fractions', () => {
    expect(formatQuantity(0.5)).toBe('One-half');
    expect(formatQuantity(0.25)).toBe('One-quarter');
    expect(formatQuantity(0.75)).toBe('Three-quarters');
    expect(formatQuantity(1 / 3)).toBe('One-third');
    expect(formatQuantity(2 / 3)).toBe('Two-thirds');
  });

  it('handles the exact floating-point division results fractionalUseAmount produces', () => {
    expect(formatQuantity(1 / 3)).toBe('One-third');
    expect(formatQuantity((1 - 1 / 3) - 1 / 3)).toBe('One-third');
  });

  it('spells out mixed numbers as "N and <fraction>"', () => {
    expect(formatQuantity(1.5)).toBe('1 and one-half');
    expect(formatQuantity(2 + 1 / 3)).toBe('2 and one-third');
  });

  it('falls back to a rounded decimal for unrecognized fractions', () => {
    expect(formatQuantity(0.123456)).toBe('0.12');
  });
});
