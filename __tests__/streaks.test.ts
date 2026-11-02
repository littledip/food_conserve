import { bestStreakFromLog, currentCleanStreakDays } from '../services/streaks';
import type { DispositionEvent } from '../types/grocery';

// Local new Date(y, m, d) throughout, matching how these functions resolve
// calendar days — ISO 'Z' strings could land on a different local day
// depending on the test machine's timezone.
function wastedAt(date: Date): DispositionEvent {
  return {
    id: `w-${date.getTime()}`, itemId: 'item', itemName: 'Something', category: 'produce',
    disposition: 'wasted', wasteMethod: 'trash',
    quantity: 1, originalQuantity: 1, unitOfMeasure: 'each', date, expiredAtTime: false,
  };
}

describe('currentCleanStreakDays', () => {
  const nov = (day: number) => new Date(2026, 10, day, 12);
  const NOV_1 = new Date(2026, 10, 1);

  it('counts the trailing run after a mid-period break, not the longest run', () => {
    // Clean Nov 1-9 (longest = 9), waste Nov 10, clean Nov 11-15 (current = 5).
    const log = [wastedAt(nov(10))];
    expect(currentCleanStreakDays(log, NOV_1, nov(15))).toBe(5);
  });

  it('counts the in-progress day, so the window\'s first clean day reads 1', () => {
    expect(currentCleanStreakDays([], NOV_1, nov(1))).toBe(1);
  });

  it('is 0 on a day waste was recorded', () => {
    expect(currentCleanStreakDays([wastedAt(nov(15))], NOV_1, nov(15))).toBe(0);
  });

  it('never reaches back before the window start', () => {
    // Waste in October is outside the window; the run still starts Nov 1.
    expect(currentCleanStreakDays([wastedAt(new Date(2026, 9, 2, 12))], NOV_1, nov(4))).toBe(4);
  });

  it('spans a period boundary rather than resetting at it', () => {
    // Clean from Nov 25 through Dec 3 = 9 days, uninterrupted by the month end.
    const log = [wastedAt(nov(24))];
    expect(currentCleanStreakDays(log, NOV_1, new Date(2026, 11, 3, 12))).toBe(9);
  });
});

describe('bestStreakFromLog', () => {
  it('is the current streak when the log is empty', () => {
    expect(bestStreakFromLog([], 5)).toBe(5);
  });

  it('is the longest logged entry when it beats the current streak', () => {
    expect(bestStreakFromLog([{ length: 4 }, { length: 28 }], 3)).toBe(28);
  });

  it('is 0 when there is no data at all', () => {
    expect(bestStreakFromLog([], 0)).toBe(0);
  });
});
