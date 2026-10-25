// Fractional consumption (e.g. "used a third") divides a quantity by a
// denominator, producing floats like 0.3333333333333333 that read poorly
// wherever a remaining amount is displayed (pantry.tsx's detail sheet,
// the chat assistant's narration). This recognizes common proper fractions
// and spells them out; anything else falls back to a rounded decimal.

const DENOMINATOR_WORDS: Record<number, [singular: string, plural: string]> = {
  2: ['half', 'halves'],
  3: ['third', 'thirds'],
  4: ['quarter', 'quarters'],
  5: ['fifth', 'fifths'],
  6: ['sixth', 'sixths'],
  7: ['seventh', 'sevenths'],
  8: ['eighth', 'eighths'],
  9: ['ninth', 'ninths'],
  10: ['tenth', 'tenths'],
};

const NUMERATOR_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

const EPSILON = 1e-9;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// `frac` must be in (0, 1) exclusive. Returns e.g. "One-third", "Two-thirds",
// or null if it doesn't match a recognized fraction (denominators 2-10,
// lowest terms only).
function properFractionToWords(frac: number): string | null {
  for (let d = 2; d <= 10; d++) {
    const n = Math.round(frac * d);
    if (n <= 0 || n >= d || gcd(n, d) !== 1) continue;
    if (Math.abs(frac - n / d) > EPSILON) continue;
    const word = n === 1 ? DENOMINATOR_WORDS[d][0] : DENOMINATOR_WORDS[d][1];
    return `${NUMERATOR_WORDS[n]}-${word}`;
  }
  return null;
}

// Formats a quantity for display: whole numbers pass through unchanged,
// recognized fractions become words ("One-half"), mixed numbers become
// "N and <fraction words>", and anything else is rounded to 2 decimals.
export function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);

  const whole = Math.floor(value);
  const frac = value - whole;
  const fracWords = properFractionToWords(frac);
  if (fracWords === null) {
    return String(Math.round(value * 100) / 100);
  }
  if (whole === 0) return fracWords;
  const lowerFirst = fracWords.charAt(0).toLowerCase() + fracWords.slice(1);
  return `${whole} and ${lowerFirst}`;
}
