import type { DispositionEvent } from '../types/grocery';
import { resolveWeightKgFor } from './environmentalImpact';
import { longestCleanStreakInPeriod, dayNumber } from './streaks';

// Local calendar month containing `now` — the period the Home/Profile
// Food Score displays by default.
export function getCurrentMonthBounds(now: Date = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
  };
}

// Weight if resolvable, else the raw quantity itself as a same-unit
// fallback ("a fraction would be provided" when weight can't be
// determined) — numerator and denominator always use the same mode for a
// given item, so the ratio stays valid either way.
function weightOrQuantity(name: string, unitOfMeasure: string, quantity: number): number {
  return resolveWeightKgFor(name, unitOfMeasure, quantity) ?? quantity;
}

// Food Score tracking officially starts 2026-11-01 — events before this
// predate the feature (and predate originalQuantity being captured at all
// on older entries), so they're excluded rather than scored on incomplete
// data. Policy, not something intrinsic to the formula itself, which is
// why this lives alongside computeFoodScoreForPeriod rather than inside it.
// Local calendar date, not UTC — matches getCurrentMonthBounds's own local
// semantics; a UTC-midnight timestamp read back with .getFullYear()/
// .getMonth() (as pendingPeriodCheckpoints does) resolves to October in
// negative-UTC-offset timezones, not November.
export const FOOD_SCORE_TRACKING_START = new Date(2026, 10, 1);

export function filterTrackedEvents(
  dispositionLog: DispositionEvent[],
  trackingStart: Date = FOOD_SCORE_TRACKING_START,
): DispositionEvent[] {
  return dispositionLog.filter((e) => e.date.getTime() >= trackingStart.getTime());
}

export interface ItemOutcomeScore {
  event: DispositionEvent;
  score: number; // 0-100
}

export interface FoodScorePeriodResult {
  outcomes: ItemOutcomeScore[];
  periodItemScore: number | null; // average of outcomes' scores; null if none this period
  longestStreakDays: number;
  daysInPeriod: number;
  finalScore: number | null; // the 0.8/0.2 blend; null when periodItemScore is null
}

// Each event is fully self-contained (itemName, unitOfMeasure, quantity,
// originalQuantity) — no separate purchase-info lookup needed, and no
// dependency on the item still being present in pantryStore's live items
// array (it may have been fully used up or wasted out long since).
export function computeFoodScoreForPeriod(
  dispositionLog: DispositionEvent[],
  periodStart: Date,
  periodEnd: Date,
): FoodScorePeriodResult {
  const startDay = dayNumber(periodStart);
  const endDay = dayNumber(periodEnd);
  const daysInPeriod = endDay - startDay + 1;

  // Chronological order matters: each event's score depends on waste
  // accumulated up through (and including) that event's own date.
  const sortedLog = [...dispositionLog].sort((a, b) => a.date.getTime() - b.date.getTime());

  const cumulativeWastedByItem = new Map<string, number>();
  const outcomes: ItemOutcomeScore[] = [];

  for (const event of sortedLog) {
    if (event.disposition === 'wasted') {
      const wastedThisEvent = weightOrQuantity(event.itemName, event.unitOfMeasure, event.quantity);
      cumulativeWastedByItem.set(
        event.itemId,
        (cumulativeWastedByItem.get(event.itemId) ?? 0) + wastedThisEvent,
      );
    }

    const eventDay = dayNumber(event.date);
    if (eventDay < startDay || eventDay > endDay) continue; // outcome outside this period

    const purchasedWeight = weightOrQuantity(event.itemName, event.unitOfMeasure, event.originalQuantity);
    if (purchasedWeight <= 0) continue; // can't form a ratio against zero

    const cumulativeWasted = cumulativeWastedByItem.get(event.itemId) ?? 0;
    const score = Math.max(0, Math.min(100, ((purchasedWeight - cumulativeWasted) / purchasedWeight) * 100));

    outcomes.push({ event, score });
  }

  const periodItemScore = outcomes.length === 0
    ? null
    : outcomes.reduce((sum, o) => sum + o.score, 0) / outcomes.length;

  const longestStreakDays = longestCleanStreakInPeriod(dispositionLog, periodStart, periodEnd);

  // No outcomes yet this period means nothing has been wasted or resolved
  // at all — that's a perfect record so far, not an unknown, so it scores
  // 100 outright rather than blending an undefined periodItemScore with
  // the streak term.
  const finalScore = periodItemScore === null
    ? 100
    : 0.8 * periodItemScore + 0.2 * (longestStreakDays / daysInPeriod) * 100;

  return { outcomes, periodItemScore, longestStreakDays, daysInPeriod, finalScore };
}
