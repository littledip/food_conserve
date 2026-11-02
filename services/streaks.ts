import type { DispositionEvent } from '../types/grocery';

// A streak is "consecutive calendar days with no wasted disposition." Any
// waste resets it to 0 the same day; the day after, it starts counting
// again.
//
// Streaks are derived from dispositionLog here, then checkpointed into
// pantryStore's persisted `streakLog` at the two moments one can end: a
// waste event, or a Food Score period closing while one is still running.
// Every function below is bounded by an explicit window start so a derived
// streak can never reach back before Food Score tracking began.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Local calendar day, not a raw UTC-timestamp floor — flooring date.getTime()
// directly conflates "today" with "tomorrow" for several hours every day in
// any negative-UTC-offset timezone (e.g. 7pm-midnight local in US Eastern
// is already past midnight UTC), which was inflating streak counts by a
// full day. Date.UTC() here just encodes the already-local-extracted y/m/d
// as an unambiguous integer index — no further timezone reinterpretation.
//
// Exported and reused by services/foodScore.ts and stores/pantryStore.ts
// rather than reimplemented locally — this exact bug was independently
// introduced three times by three copy-pasted versions of this function
// before they were consolidated down to this single implementation.
export function dayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY;
}

// Best streak from persisted streakLog entries (see types/grocery.ts's
// StreakLogEntry) plus however long the current/in-progress one is —
// generic over `{ length }` so it works for StreakLogEntry without this
// pure module depending on that type.
export function bestStreakFromLog(entries: { length: number }[], currentStreakDays: number): number {
  return Math.max(currentStreakDays, 0, ...entries.map((e) => e.length));
}

// Count of FULL clean days immediately preceding `breakDay`, never looking
// earlier than `windowStart`. A streak is composed of complete days without
// waste, so the break day itself never counts — which is exactly why a
// streak displaying as N days gets recorded as N-1 when waste lands on that
// Nth (still in-progress) day. Returns 0 when the break lands on the window's
// own first day, or on the day right after a previous break.
//
// `windowStart` is what keeps persisted streaks from reaching back before
// Food Score tracking began; without it, derivation would silently measure
// from the earliest-ever pantry activity instead.
export function fullCleanDaysBefore(
  dispositionLog: DispositionEvent[],
  windowStart: Date,
  breakDate: Date,
): number {
  const startDay = dayNumber(windowStart);
  const breakDay = dayNumber(breakDate);
  if (breakDay <= startDay) return 0;

  const wasteDays = new Set(
    dispositionLog
      .filter((e): e is DispositionEvent & { disposition: 'wasted' } => e.disposition === 'wasted')
      .map((e) => dayNumber(e.date)),
  );

  let count = 0;
  for (let day = breakDay - 1; day >= startDay; day--) {
    if (wasteDays.has(day)) break;
    count++;
  }
  return count;
}

// The streak running RIGHT NOW: clean days since the most recent waste
// event, through `now` inclusive. The in-progress day counts here (so day
// one of a window reads 1, and waste today reads 0) — that is exactly the
// "displays as N, records N-1" relationship with fullCleanDaysBefore.
//
// Deliberately NOT period-scoped: a run spanning Nov 25 -> Dec 3 is a
// 9-day current streak, not a 3-day one, so only `windowStart` (tracking
// start) bounds it — unlike longestCleanStreakInPeriod below, which the
// Food Score uses and which treats the period edges as walls.
export function currentCleanStreakDays(
  dispositionLog: DispositionEvent[],
  windowStart: Date,
  now: Date = new Date(),
): number {
  const startDay = dayNumber(windowStart);
  const todayDay = dayNumber(now);
  if (todayDay < startDay) return 0;

  const wasteDaysSoFar = dispositionLog
    .filter((e): e is DispositionEvent & { disposition: 'wasted' } => e.disposition === 'wasted')
    .map((e) => dayNumber(e.date))
    .filter((day) => day <= todayDay);

  const rangeStart = wasteDaysSoFar.length === 0
    ? startDay
    : Math.max(Math.max(...wasteDaysSoFar) + 1, startDay);

  return Math.max(0, todayDay - rangeStart + 1);
}

// Longest run of consecutive clean days within [periodStart, periodEnd],
// treating the period's own edges as the walls rather than all-time
// activity — used by the Food Score's streak-weighting term, which cares
// about "longest streak in September," not the all-time streak history.
export function longestCleanStreakInPeriod(
  dispositionLog: DispositionEvent[],
  periodStart: Date,
  periodEnd: Date,
): number {
  const startDay = dayNumber(periodStart);
  const endDay = dayNumber(periodEnd);

  const wasteDaysInPeriod = Array.from(
    new Set(
      dispositionLog
        .filter((e): e is DispositionEvent & { disposition: 'wasted' } => e.disposition === 'wasted')
        .map((e) => dayNumber(e.date))
        .filter((day) => day >= startDay && day <= endDay),
    ),
  ).sort((a, b) => a - b);

  let longest = 0;
  let rangeStart = startDay;
  for (const breakDay of wasteDaysInPeriod) {
    longest = Math.max(longest, breakDay - rangeStart);
    rangeStart = breakDay + 1;
  }
  longest = Math.max(longest, endDay - rangeStart + 1);

  return Math.max(longest, 0);
}
