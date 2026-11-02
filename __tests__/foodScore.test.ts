import {
  computeFoodScoreForPeriod,
  filterTrackedEvents,
  FOOD_SCORE_TRACKING_START,
  getCurrentMonthBounds,
} from '../services/foodScore';
import type { DispositionEvent } from '../types/grocery';

const d = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

// 'each', no ITEM_IMPACT_TABLE entry for 'Mystery Item' -> weight
// resolution falls through to the raw-quantity fallback, which is exactly
// what most of these tests want to isolate (the ratio math itself, not
// weight lookups already covered in environmentalImpact.test.ts).
function wasted(
  itemId: string, dateIso: string, quantity: number, originalQuantity: number,
  id = `w-${itemId}-${dateIso}`,
): DispositionEvent {
  return {
    id, itemId, itemName: 'Mystery Item', category: 'produce',
    disposition: 'wasted', wasteMethod: 'trash',
    quantity, originalQuantity, unitOfMeasure: 'each', date: d(dateIso), expiredAtTime: false,
  };
}

function used(
  itemId: string, dateIso: string, quantity: number, originalQuantity: number,
  id = `u-${itemId}-${dateIso}`,
): DispositionEvent {
  return {
    id, itemId, itemName: 'Mystery Item', category: 'produce',
    disposition: 'used',
    quantity, originalQuantity, unitOfMeasure: 'each', date: d(dateIso), expiredAtTime: false,
  };
}

const SEPT_START = d('2026-09-01');
const SEPT_END = d('2026-09-30');

describe('computeFoodScoreForPeriod', () => {
  it('scores a fully-used item with zero waste as 100', () => {
    const result = computeFoodScoreForPeriod([used('a', '2026-09-05', 1, 1)], SEPT_START, SEPT_END);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].score).toBe(100);
    expect(result.periodItemScore).toBe(100);
  });

  it('scores a fully-wasted item as 0', () => {
    const result = computeFoodScoreForPeriod([wasted('a', '2026-09-05', 1, 1)], SEPT_START, SEPT_END);
    expect(result.outcomes[0].score).toBe(0);
    expect(result.periodItemScore).toBe(0);
  });

  it('scores a partial waste proportionally, even while the item is still active', () => {
    // Bought 10, wasted 3, nothing else resolved yet this period.
    const result = computeFoodScoreForPeriod([wasted('a', '2026-09-05', 3, 10)], SEPT_START, SEPT_END);
    expect(result.outcomes[0].score).toBe(70);
    expect(result.periodItemScore).toBe(70);
  });

  it('carries cumulative waste across periods — a later clean event still reflects earlier waste', () => {
    const log = [
      wasted('a', '2026-08-20', 2, 10),  // partial waste in August
      used('a', '2026-09-05', 8, 10),    // remainder fully used in September, no further waste
    ];

    const august = computeFoodScoreForPeriod(log, d('2026-08-01'), d('2026-08-31'));
    expect(august.periodItemScore).toBe(80); // (10-2)/10

    const september = computeFoodScoreForPeriod(log, SEPT_START, SEPT_END);
    expect(september.periodItemScore).toBe(80); // same cumulative ratio, carried forward
  });

  it('averages scores across multiple items with outcomes in the same period', () => {
    const log = [
      used('a', '2026-09-05', 10, 10),       // 100
      wasted('b', '2026-09-10', 10, 10),     // 0
    ];
    const result = computeFoodScoreForPeriod(log, SEPT_START, SEPT_END);
    expect(result.periodItemScore).toBe(50);
  });

  it('skips events with zero (or missing) original quantity rather than dividing by zero', () => {
    const result = computeFoodScoreForPeriod([used('a', '2026-09-05', 0, 0)], SEPT_START, SEPT_END);
    expect(result.outcomes).toEqual([]);
    expect(result.periodItemScore).toBeNull();
  });

  it('ignores events outside the period window', () => {
    const result = computeFoodScoreForPeriod([used('a', '2026-10-05', 1, 1)], SEPT_START, SEPT_END);
    expect(result.outcomes).toEqual([]);
    expect(result.periodItemScore).toBeNull();
  });

  it('scores 100 outright when there are no outcomes yet this period — nothing wasted is a perfect record, not an unknown', () => {
    const result = computeFoodScoreForPeriod([], SEPT_START, SEPT_END);
    expect(result.periodItemScore).toBeNull();
    expect(result.finalScore).toBe(100);
    expect(result.longestStreakDays).toBe(30); // nothing wasted -> the whole period is clean
  });

  it('matches the worked example: periodItemScore 90, longest streak 15/30 days -> finalScore 82', () => {
    // One waste event mid-period: scores (10-1)/10=90, and splits the
    // 30-day period into a 15-day clean run before it and 14 after.
    const result = computeFoodScoreForPeriod([wasted('a', '2026-09-16', 1, 10)], SEPT_START, SEPT_END);

    expect(result.periodItemScore).toBe(90);
    expect(result.longestStreakDays).toBe(15);
    expect(result.daysInPeriod).toBe(30);
    expect(result.finalScore).toBeCloseTo(82);
  });

  it('falls back to a raw-quantity ratio when weight cannot be resolved', () => {
    // 'jar' has no embedded weight and no ITEM_IMPACT_TABLE entry — this
    // is exactly the case resolveWeightKgFor returns null for, so the
    // ratio should still work using quantity directly.
    const result = computeFoodScoreForPeriod(
      [{
        id: 'w1', itemId: 'a', itemName: 'Mystery Item', category: 'condiments',
        disposition: 'wasted', wasteMethod: 'trash',
        quantity: 1, originalQuantity: 4, unitOfMeasure: 'jar', date: d('2026-09-05'), expiredAtTime: false,
      }],
      SEPT_START, SEPT_END,
    );
    expect(result.periodItemScore).toBe(75); // (4-1)/4
  });
});

describe('filterTrackedEvents', () => {
  it('excludes events before the tracking start date', () => {
    const log = [wasted('a', '2026-10-31', 1, 1), used('b', '2026-11-01', 1, 1)];
    expect(filterTrackedEvents(log)).toEqual([log[1]]);
  });

  it('defaults to FOOD_SCORE_TRACKING_START (2026-11-01, local) when no cutoff is given', () => {
    // Local calendar date, not UTC — see the comment on the constant's
    // definition for why (must match getCurrentMonthBounds's semantics).
    expect(FOOD_SCORE_TRACKING_START.getFullYear()).toBe(2026);
    expect(FOOD_SCORE_TRACKING_START.getMonth()).toBe(10); // November, 0-indexed
    expect(FOOD_SCORE_TRACKING_START.getDate()).toBe(1);
  });

  it('accepts a custom cutoff for testing/flexibility', () => {
    const log = [wasted('a', '2026-01-05', 1, 1), used('b', '2026-01-10', 1, 1)];
    expect(filterTrackedEvents(log, d('2026-01-08'))).toEqual([log[1]]);
  });

  it('matches the first-day-of-tracking scenario: no events yet, 1-day streak, score is 100', () => {
    // Simulates "as of right now" being Nov 1 itself — the live hook
    // clips periodEnd to today rather than the full (not-yet-elapsed)
    // month end, so the period-so-far is just this one day.
    const novStart = d('2026-11-01');
    const asOfNov1 = d('2026-11-01');
    const trackedLog = filterTrackedEvents([]); // nothing logged yet
    const result = computeFoodScoreForPeriod(trackedLog, novStart, asOfNov1);
    expect(result.daysInPeriod).toBe(1);
    expect(result.longestStreakDays).toBe(1); // just Nov 1 itself, clean so far
    expect(result.finalScore).toBe(100);
  });
});

describe('getCurrentMonthBounds', () => {
  it('returns the first and last day of the given date\'s calendar month', () => {
    const { start, end } = getCurrentMonthBounds(new Date(2026, 10, 15)); // Nov 15, 2026 (local)
    expect(start).toEqual(new Date(2026, 10, 1));
    expect(end).toEqual(new Date(2026, 11, 0)); // Nov 30
  });
});

describe('daysInPeriod (regression: same local day must never span 2 UTC calendar days)', () => {
  it('is 1 when periodStart is local midnight and periodEnd is later the same local day', () => {
    // Reproduces a real bug: in a negative-UTC-offset timezone, local
    // evening is already the next UTC calendar day, so a naive UTC-floor
    // day count saw this as spanning 2 days instead of 1 — which silently
    // dragged a 100 periodItemScore down to 90 via the streak-fraction
    // term (0.8*100 + 0.2*(1/2)*100 = 90 instead of 0.8*100 + 0.2*(1/1)*100
    // = 100). Both dates below are deliberately the same local calendar
    // day regardless of what timezone this test runs in.
    const periodStart = new Date(2026, 10, 1, 0, 0, 0);
    const periodEnd = new Date(2026, 10, 1, 21, 0, 0);
    const result = computeFoodScoreForPeriod(
      [used('a', '2026-11-01', 1, 1)],
      periodStart,
      periodEnd,
    );
    expect(result.daysInPeriod).toBe(1);
    expect(result.finalScore).toBe(100); // 0.8*100 + 0.2*(1/1)*100
  });
});
