import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  GroceryItem,
  ItemCategory,
  StorageLocation,
  StorageEvent,
  StorageEventType,
  Disposition,
  DispositionEvent,
  WasteMethod,
  RecallableItem,
  StreakLogEntry,
} from '../types/grocery';
import {
  computeFoodScoreForPeriod,
  filterTrackedEvents,
  FOOD_SCORE_TRACKING_START,
  getCurrentMonthBounds,
  type FoodScorePeriodResult,
} from '../services/foodScore';
import { fullCleanDaysBefore, currentCleanStreakDays } from '../services/streaks';

const DAY_MS = 86400000;
const URGENT_DAYS = 1;
const WEEK_DAYS = 7;

export const RECALL_WINDOW_DAYS = 7;

export const daysUntil = (date: Date, now: Date = new Date()): number =>
  Math.ceil((date.getTime() - now.getTime()) / DAY_MS);

export const isRecallable = (disposedAt: Date, now: Date = new Date()): boolean =>
  now.getTime() - disposedAt.getTime() <= RECALL_WINDOW_DAYS * DAY_MS;

export type DayRange = { minExclusive?: number; maxInclusive?: number };

export const filterByDaysUntil = (
  items: GroceryItem[],
  range: DayRange,
  now: Date = new Date(),
): GroceryItem[] =>
  items.filter((i) => {
    const d = daysUntil(i.effectiveExpirationDate, now);
    if (range.minExclusive !== undefined && d <= range.minExclusive) return false;
    if (range.maxInclusive !== undefined && d > range.maxInclusive) return false;
    return true;
  });

// Amount to subtract from remainingQuantity for a "Used 1/N" preset.
// Anchored to remainingQuantity so partially-consumed items behave intuitively:
// a 2-lb rice bag with 1.5 lbs left → "Used half" consumes 0.75 lb, leaving 0.75 lb.
export const fractionalUseAmount = (item: GroceryItem, denom: number): number =>
  item.remainingQuantity / denom;

const moveEventType = (to: StorageLocation): StorageEventType =>
  to === 'freezer' ? 'moved_to_freezer' : to === 'fridge' ? 'moved_to_fridge' : 'moved_to_pantry';

// Default freezer shelf-life when no estimate exists. Spec calls for AI-estimated
// per-item / per-category; this is a placeholder until that lands.
const DEFAULT_FREEZER_DAYS = 90;

export const defaultFreezerExpiration = (now: Date = new Date()): Date =>
  new Date(now.getTime() + DEFAULT_FREEZER_DAYS * DAY_MS);

// --- Persistence revivers ---
// JSON.stringify turns Date instances into ISO strings; on rehydrate we walk the
// known Date fields explicitly so non-date strings are left alone.

const toDate = (v: unknown): Date | undefined => {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : undefined;
  }
  return undefined;
};

const reviveStorageEvent = (raw: unknown): StorageEvent => {
  const r = raw as { eventType: StorageEventType; location: StorageLocation; date: unknown };
  return {
    eventType: r.eventType,
    location: r.location,
    date: toDate(r.date) ?? new Date(),
  };
};

export const reviveItem = (raw: unknown): GroceryItem => {
  const r = raw as Record<string, unknown>;
  return {
    ...(r as unknown as GroceryItem),
    printedExpirationDate: toDate(r.printedExpirationDate),
    effectiveExpirationDate: toDate(r.effectiveExpirationDate) ?? new Date(),
    freezerExpirationDate: toDate(r.freezerExpirationDate),
    purchaseDate: toDate(r.purchaseDate) ?? new Date(),
    dateAdded: toDate(r.dateAdded) ?? new Date(),
    storageHistory: Array.isArray(r.storageHistory) ? r.storageHistory.map(reviveStorageEvent) : [],
  };
};

export const reviveDispositionEvent = (raw: unknown): DispositionEvent => {
  const r = raw as DispositionEvent & { date: unknown };
  return {
    ...r,
    date: toDate(r.date) ?? new Date(),
  };
};

const reviveStreakLogEntry = (raw: unknown): StreakLogEntry => {
  const r = raw as StreakLogEntry & { endedOn: unknown };
  return {
    ...r,
    endedOn: toDate(r.endedOn) ?? new Date(),
  };
};

// --- Destructive-write guard ---

// Set by resetPantry immediately before its set(), and consumed by the very
// next setItem — which persist invokes synchronously from that set, so there
// is no window for an unrelated write to claim it. No timers involved.
let destructiveWriteAllowed = false;

const rowCount = (raw: string | null): number | null => {
  if (!raw) return null;
  try {
    const state = (JSON.parse(raw) as { state?: Record<string, unknown> }).state ?? {};
    const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
    return len(state.items) + len(state.dispositionLog) + len(state.streakLog);
  } catch {
    return null; // unparseable: treat as unknown, never as "empty"
  }
};

// Wraps AsyncStorage so a write that would replace real pantry data with an
// empty store is refused unless resetPantry explicitly authorized it.
//
// This exists because that is precisely how a week of real data was lost: a
// schema-version downgrade made zustand hand `undefined` to merge, merge
// produced a valid-looking empty state, and the next persist wrote it over
// everything. Nothing in the normal flow legitimately empties the store —
// only resetPantry does — so anything else doing it is a bug, and the right
// response is to refuse the write and leave the data recoverable on disk.
const guardedPantryStorage = {
  getItem: (name: string) => AsyncStorage.getItem(name),
  removeItem: (name: string) => AsyncStorage.removeItem(name),
  setItem: async (name: string, value: string): Promise<void> => {
    const authorized = destructiveWriteAllowed;
    destructiveWriteAllowed = false; // consume-once

    if (!authorized) {
      const incoming = rowCount(value);
      if (incoming === 0) {
        const existing = rowCount(await AsyncStorage.getItem(name));
        if (existing !== null && existing > 0) {
          console.error(
            `[pantryStore] REFUSED a write that would have replaced ${existing} stored rows ` +
              'with an empty store. Data left intact on disk. This indicates a hydration ' +
              'or migration failure — check for a schema-version mismatch.',
          );
          return;
        }
      }
    }
    await AsyncStorage.setItem(name, value);
  },
};

// Exported for the guard's tests; not part of the public store surface.
export const __authorizeDestructiveWrite = (): void => {
  destructiveWriteAllowed = true;
};

// --- Schema migration ---

export const PANTRY_STORE_SCHEMA_VERSION = 2;

// v1 -> v2 gained a required `originalQuantity` on DispositionEvent. The true
// value is unrecoverable for events written before the field existed, so it is
// backfilled from `quantity` — i.e. "assume this event disposed the item's
// whole original amount."
//
// That choice is deliberately the pessimistic one. For a 'used' event it is
// immaterial: the Food Score ratio is (original - wasted) / original, and with
// no waste the result is 100 regardless. For a 'wasted' event it yields a
// score of 0, the worst defensible reading, which matches the conservative
// default already used for wasteMethod ('trash'). Guessing a larger original
// quantity would invent a better score than the data supports.
//
// Events missing the field necessarily predate the build that added it. Most
// will also predate FOOD_SCORE_TRACKING_START and so be excluded from scoring
// entirely by filterTrackedEvents — but that is not guaranteed for an install
// upgrading late, which is exactly why the backfill errs low rather than high.
const backfillOriginalQuantity = (raw: unknown): unknown => {
  const event = (raw ?? {}) as Record<string, unknown>;
  if (typeof event.originalQuantity === 'number') return event;
  return {
    ...event,
    originalQuantity: typeof event.quantity === 'number' ? event.quantity : 0,
  };
};

// Runs BEFORE `merge`, on the raw deserialized blob — so Dates are still ISO
// strings here and must not be touched. `merge` revives them afterward.
//
// The `streakLog` and `lastStreakCheckpointAt` slices were also added after v1,
// but need no migration step: `merge` already defaults a missing streakLog to
// [] and a missing lastStreakCheckpointAt to null.
export const migratePantryStore = (persistedState: unknown, fromVersion: number): unknown => {
  // A stored version NEWER than this build's (a downgrade — e.g. checking out
  // an older branch during development) cannot be migrated backwards. Pass it
  // through untouched rather than letting zustand fall into its
  // "no migrate function was provided" path, which hands `undefined` to merge
  // and silently presents as an empty pantry. `merge` whitelists known fields,
  // so unknown newer ones are ignored; the visible data survives.
  if (fromVersion > PANTRY_STORE_SCHEMA_VERSION) {
    console.warn(
      `[pantryStore] stored schema v${fromVersion} is newer than this build (v${PANTRY_STORE_SCHEMA_VERSION}); ` +
        'loading as-is without migration.',
    );
    return persistedState;
  }

  if (fromVersion >= 2) return persistedState;

  const p = (persistedState ?? {}) as Record<string, unknown>;
  return {
    ...p,
    dispositionLog: Array.isArray(p.dispositionLog)
      ? p.dispositionLog.map(backfillOriginalQuantity)
      : [],
  };
};

type PantryState = {
  items: GroceryItem[];
  dispositionLog: DispositionEvent[];
  // User-corrected category per barcode. OFF crowdsourced categories are often
  // wrong (e.g. a shelf-stable rice tagged as "frozen-pre-cooked-rice"); once
  // the user fixes one, we remember it for next time.
  barcodeCategoryOverrides: Record<string, ItemCategory>;
  // Snapshots of fully-disposed 'used' items, for undoing a mis-tap of
  // "Used all". Entries auto-prune after RECALL_WINDOW_DAYS. 'wasted'
  // disposals are not snapshotted.
  recallableItems: RecallableItem[];
  // Persisted streak history (see types/grocery.ts's StreakLogEntry) — not
  // purely derived, because a streak still in progress when a Food Score
  // period (month) closes needs to be checkpointed at that boundary, which
  // requires remembering it happened rather than re-scanning forever.
  streakLog: StreakLogEntry[];
  // The last calendar month whose period-end checkpoint has already been
  // processed (or null if none yet) — lets checkpointElapsedStreakPeriods
  // catch up on any months that elapsed while the app was closed, without
  // reprocessing months already handled.
  lastStreakCheckpointAt: Date | null;
  addItem: (item: GroceryItem) => void;
  updateItem: (id: string, patch: Partial<GroceryItem>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, to: StorageLocation) => void;
  consumeItem: (id: string, used: number) => void;
  // wasteMethod is only meaningful when disposition is 'wasted'; defaults to
  // 'trash' when omitted. Passing it with disposition: 'used' is harmless —
  // buildDispositionEvent only reads it in the 'wasted' branch.
  disposeItem: (id: string, disposition: Disposition, wasteMethod?: WasteMethod) => void;
  recallItem: (itemId: string) => void;
  setBarcodeCategoryOverride: (barcode: string, category: ItemCategory) => void;
  // Backfills a streakLog 'period_end' entry for every fully-elapsed
  // calendar month since the last checkpoint, if a streak was still
  // unbroken at that month's close. Called on app launch (after hydration)
  // so months aren't missed just because no disposal happened in them —
  // also runs automatically inside disposeItem on every waste event.
  checkpointElapsedStreakPeriods: () => void;
  // ONE-TIME recovery: replaces items and dispositionLog wholesale, so
  // re-running it cannot duplicate rows. Remove with services/restoreBackup.ts.
  restoreFromBackup: (items: GroceryItem[], dispositionLog: DispositionEvent[]) => void;
  resetPantry: () => void;
};

const generateEventId = (): string =>
  `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildDispositionEvent = (
  item: GroceryItem,
  disposition: Disposition,
  quantity: number,
  wasteMethod?: WasteMethod,
  now: Date = new Date(),
): DispositionEvent => {
  const base = {
    id: generateEventId(),
    itemId: item.id,
    itemName: item.name,
    category: item.category,
    quantity,
    originalQuantity: item.originalQuantity,
    unitOfMeasure: item.unitOfMeasure,
    date: now,
    expiredAtTime: item.effectiveExpirationDate.getTime() < now.getTime(),
  };
  // Defaults to 'trash' (landfill) — the conservative assumption backed by
  // real EPA WARM data; the UI lets the user change it before confirming.
  return disposition === 'wasted'
    ? { ...base, disposition: 'wasted', wasteMethod: wasteMethod ?? 'trash' }
    : { ...base, disposition: 'used' };
};

const generateStreakId = (): string =>
  `streak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Never let a persisted streak reach back before Food Score tracking began,
// even if the pantry has older history — the displayed streak is scoped to
// the tracking window, and the two must agree.
const streakWindowStart = (periodStart: Date): Date =>
  periodStart.getTime() > FOOD_SCORE_TRACKING_START.getTime() ? periodStart : FOOD_SCORE_TRACKING_START;

const previousDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);

const nextDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

// Backfills a 'period_end' StreakLogEntry for every fully-elapsed calendar
// month since lastCheckpointAt (or since FOOD_SCORE_TRACKING_START's month
// if never checkpointed), capturing the streak still running at that month's
// close. Never touches the current, still-in-progress month, since "now"
// might be any day within it.
//
// The month's final day IS counted here — unlike the 'wasted' trigger's
// in-progress day — because a fully-elapsed month's last day is itself a
// complete day. That's modeled by measuring full clean days before the day
// *after* the month ends.
export const pendingPeriodCheckpoints = (
  dispositionLog: DispositionEvent[],
  lastCheckpointAtRaw: Date | null,
  now: Date,
): { newEntries: StreakLogEntry[]; newLastCheckpointAt: Date | null } => {
  // Normalize at the boundary: persisted Dates come back from AsyncStorage
  // as ISO strings, and a stale/partial rehydrate can deliver one here even
  // though the type says Date — which crashed on .getFullYear() in practice.
  // Every other persisted Date in this store goes through a revive* helper
  // for the same reason; this is that guard for a value arriving by argument.
  const lastCheckpointAt = toDate(lastCheckpointAtRaw) ?? null;

  const newEntries: StreakLogEntry[] = [];
  let cursor = lastCheckpointAt
    ? new Date(lastCheckpointAt.getFullYear(), lastCheckpointAt.getMonth() + 1, 1)
    : new Date(FOOD_SCORE_TRACKING_START.getFullYear(), FOOD_SCORE_TRACKING_START.getMonth(), 1);
  const nowMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let newLastCheckpointAt = lastCheckpointAt;

  while (cursor.getTime() < nowMonthStart.getTime()) {
    const { start, end } = getCurrentMonthBounds(cursor);
    const length = fullCleanDaysBefore(dispositionLog, streakWindowStart(start), nextDay(end));
    // Recorded even at length 0 (month closed on a waste day, so no streak
    // was running at the boundary) — matching the 'wasted' trigger, which
    // also persists zero-length entries. Both are the factual record that a
    // streak ended here; keeping them symmetric avoids a log where zeros
    // appear from one trigger but never the other.
    newEntries.push({ id: generateStreakId(), length, endedOn: end, trigger: 'period_end' });
    newLastCheckpointAt = end;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return { newEntries, newLastCheckpointAt };
};

// The streak that just ended because waste was recorded on `breakDate`.
// Counts only FULL clean days, so the break day itself never contributes:
// a streak displaying as N days is recorded as N-1, and waste on the very
// first day of a window records 0. Always returns an entry — a zero-length
// one is still the factual record of a streak ending here.
// `dispositionLog` must already include the triggering event itself.
export const streakBrokenBy = (
  dispositionLog: DispositionEvent[],
  breakDate: Date,
): StreakLogEntry => {
  const length = fullCleanDaysBefore(dispositionLog, FOOD_SCORE_TRACKING_START, breakDate);
  return {
    id: generateStreakId(),
    length,
    endedOn: previousDay(breakDate),
    trigger: 'wasted',
  };
};

export const usePantryStore = create<PantryState>()(
  persist(
    (set) => ({
      items: [],
      dispositionLog: [],
      barcodeCategoryOverrides: {},
      recallableItems: [],
      streakLog: [],
      lastStreakCheckpointAt: null,

      addItem: (item) =>
        set((state) => ({ items: [...state.items, item] })),

      updateItem: (id, patch) =>
        set((state) => ({
          items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
        })),

      removeItem: (id) =>
        set((state) => ({ items: state.items.filter((i) => i.id !== id) })),

      moveItem: (id, to) =>
        set((state) => ({
          items: state.items.map((i) => {
            if (i.id !== id || i.storageLocation === to) return i;
            const now = new Date();
            const event: StorageEvent = { eventType: moveEventType(to), location: to, date: now };
            const refreezing = to === 'freezer' && i.storageHistory.some((e) => e.eventType === 'moved_to_fridge');
            const base = {
              ...i,
              storageLocation: to,
              storageHistory: [...i.storageHistory, event],
              thawCycleCount: refreezing ? i.thawCycleCount + 1 : i.thawCycleCount,
            };
            if (to === 'freezer') {
              const freezerExp = i.freezerExpirationDate ?? defaultFreezerExpiration(now);
              return {
                ...base,
                freezerExpirationDate: freezerExp,
                effectiveExpirationDate: freezerExp,
              };
            }
            return base;
          }),
        })),

      consumeItem: (id, used) =>
        set((state) => {
          const item = state.items.find((i) => i.id === id);
          if (!item) return state;
          const event = buildDispositionEvent(item, 'used', used);
          return {
            items: state.items.map((i) =>
              i.id === id ? { ...i, remainingQuantity: Math.max(0, i.remainingQuantity - used) } : i,
            ),
            dispositionLog: [...state.dispositionLog, event],
          };
        }),

      disposeItem: (id, disposition, wasteMethod) =>
        set((state) => {
          const item = state.items.find((i) => i.id === id);
          if (!item) return state;
          const event = buildDispositionEvent(item, disposition, item.remainingQuantity, wasteMethod);
          const pruned = state.recallableItems.filter((r) => isRecallable(r.disposedAt, event.date));
          const recallableItems =
            disposition === 'used'
              ? [...pruned, { item, dispositionEventId: event.id, disposedAt: event.date }]
              : pruned;
          const updatedDispositionLog = [...state.dispositionLog, event];

          // Catch up on any fully-elapsed months first (Trigger 2), then
          // record the streak this specific waste event just broke, if any
          // (Trigger 1). Order doesn't affect correctness — the catch-up
          // only ever looks at strictly-past months, untouched by today's
          // new event.
          const { newEntries: periodEntries, newLastCheckpointAt } = pendingPeriodCheckpoints(
            state.dispositionLog, state.lastStreakCheckpointAt, event.date,
          );
          const streakLogAdditions = [...periodEntries];
          if (disposition === 'wasted') {
            streakLogAdditions.push(streakBrokenBy(updatedDispositionLog, event.date));
          }

          return {
            items: state.items.filter((i) => i.id !== id),
            dispositionLog: updatedDispositionLog,
            recallableItems,
            streakLog: streakLogAdditions.length > 0 ? [...state.streakLog, ...streakLogAdditions] : state.streakLog,
            lastStreakCheckpointAt: newLastCheckpointAt,
          };
        }),

      checkpointElapsedStreakPeriods: () =>
        set((state) => {
          const { newEntries, newLastCheckpointAt } = pendingPeriodCheckpoints(
            state.dispositionLog, state.lastStreakCheckpointAt, new Date(),
          );
          // Compare through toDate: state.lastStreakCheckpointAt may still be
          // an unrevived ISO string, which has no .getTime().
          const previous = toDate(state.lastStreakCheckpointAt) ?? null;
          if (newEntries.length === 0 && newLastCheckpointAt?.getTime() === previous?.getTime()) {
            return state;
          }
          return {
            streakLog: [...state.streakLog, ...newEntries],
            lastStreakCheckpointAt: newLastCheckpointAt,
          };
        }),

      recallItem: (itemId) =>
        set((state) => {
          const entry = state.recallableItems.find((r) => r.item.id === itemId);
          if (!entry) return state;
          return {
            items: [...state.items, entry.item],
            recallableItems: state.recallableItems.filter((r) => r.item.id !== itemId),
            dispositionLog: state.dispositionLog.filter((e) => e.id !== entry.dispositionEventId),
          };
        }),

      setBarcodeCategoryOverride: (barcode, category) =>
        set((state) => ({
          barcodeCategoryOverrides: { ...state.barcodeCategoryOverrides, [barcode]: category },
        })),

      restoreFromBackup: (items, dispositionLog) =>
        set({ items, dispositionLog, streakLog: [], lastStreakCheckpointAt: null }),

      resetPantry: () => {
        // The one legitimate empty write. Authorize it so the destructive-write
        // guard lets it through; the flag is consumed by this set's persist.
        __authorizeDestructiveWrite();
        set({
          items: [],
          dispositionLog: [],
          barcodeCategoryOverrides: {},
          recallableItems: [],
          streakLog: [],
          lastStreakCheckpointAt: null,
        });
      },
    }),
    {
      // The "/v1" here is the AsyncStorage *key*, not the schema version —
      // renaming it would orphan every existing install's data. Schema
      // versioning is `version` below.
      name: 'food-conserve-pantry/v1',
      version: PANTRY_STORE_SCHEMA_VERSION,
      migrate: migratePantryStore,
      // Guarded wrapper, not raw AsyncStorage — see guardedPantryStorage.
      storage: createJSONStorage(() => guardedPantryStorage),
      partialize: (state) => ({
        items: state.items,
        dispositionLog: state.dispositionLog,
        barcodeCategoryOverrides: state.barcodeCategoryOverrides,
        recallableItems: state.recallableItems,
        streakLog: state.streakLog,
        lastStreakCheckpointAt: state.lastStreakCheckpointAt,
      }),
      merge: (persistedState, currentState) => {
        const p = (persistedState ?? {}) as {
          items?: unknown[];
          dispositionLog?: unknown[];
          barcodeCategoryOverrides?: unknown;
          recallableItems?: unknown[];
          streakLog?: unknown[];
          lastStreakCheckpointAt?: unknown;
        };
        const overrides: Record<string, ItemCategory> = {};
        if (p.barcodeCategoryOverrides && typeof p.barcodeCategoryOverrides === 'object') {
          for (const [k, v] of Object.entries(p.barcodeCategoryOverrides as Record<string, unknown>)) {
            if (typeof v === 'string') overrides[k] = v as ItemCategory;
          }
        }
        return {
          ...currentState,
          items: Array.isArray(p.items) ? p.items.map(reviveItem) : [],
          dispositionLog: Array.isArray(p.dispositionLog)
            ? p.dispositionLog.map(reviveDispositionEvent)
            : [],
          barcodeCategoryOverrides: overrides,
          recallableItems: Array.isArray(p.recallableItems)
            ? p.recallableItems
                .map((r) => {
                  const rec = r as { item?: unknown; dispositionEventId?: unknown; disposedAt?: unknown };
                  if (!rec.item || typeof rec.dispositionEventId !== 'string') return null;
                  return {
                    item: reviveItem(rec.item),
                    dispositionEventId: rec.dispositionEventId,
                    disposedAt: toDate(rec.disposedAt) ?? new Date(),
                  };
                })
                .filter((r): r is RecallableItem => r !== null)
            : [],
          streakLog: Array.isArray(p.streakLog) ? p.streakLog.map(reviveStreakLogEntry) : [],
          lastStreakCheckpointAt: toDate(p.lastStreakCheckpointAt) ?? null,
        };
      },
    },
  ),
);

// --- Selector hooks ---

export const useItemCount = () => usePantryStore((s) => s.items.length);

export const useUrgentItems = () =>
  usePantryStore(
    useShallow((s) => filterByDaysUntil(s.items, { maxInclusive: URGENT_DAYS })),
  );

export const useExpiringThisWeek = () =>
  usePantryStore(
    useShallow((s) => filterByDaysUntil(s.items, { maxInclusive: WEEK_DAYS })),
  );

export const useUpcomingWeek = () =>
  usePantryStore(
    useShallow((s) =>
      filterByDaysUntil(s.items, { minExclusive: URGENT_DAYS, maxInclusive: WEEK_DAYS }),
    ),
  );

export const useExpiringThisWeekCount = () =>
  usePantryStore(
    (s) => filterByDaysUntil(s.items, { maxInclusive: WEEK_DAYS }).length,
  );

export const useItemsByCategory = (category: ItemCategory) =>
  usePantryStore(useShallow((s) => s.items.filter((i) => i.category === category)));

export const useAllItems = () => usePantryStore(useShallow((s) => s.items));

export const useDispositionLog = () => usePantryStore(useShallow((s) => s.dispositionLog));

export const useStreakLog = () => usePantryStore(useShallow((s) => s.streakLog));

export const useCheckpointElapsedStreakPeriods = () =>
  usePantryStore((s) => s.checkpointElapsedStreakPeriods);

// Only counts disposition events on/after FOOD_SCORE_TRACKING_START —
// tracking officially begins 2026-11-01, so earlier history (which also
// predates originalQuantity being captured on older entries) is excluded
// rather than scored on incomplete data. Also clips periodEnd to "now" when
// querying an in-progress period (e.g. the current month) — otherwise
// daysInPeriod/longestStreakDays would count days that haven't happened
// yet as if they were already known to be clean.
export const useFoodScoreForPeriod = (periodStart: Date, periodEnd: Date): FoodScorePeriodResult => {
  const dispositionLog = useDispositionLog();
  const now = new Date();
  const clippedEnd = periodEnd.getTime() > now.getTime() ? now : periodEnd;
  return computeFoodScoreForPeriod(filterTrackedEvents(dispositionLog), periodStart, clippedEnd);
};

// The streak running right now — what Home's badge and Profile's "Current
// streak" display. Distinct from the Food Score's internal streak term,
// which is the LONGEST run within the scored period; after a mid-period
// break those two legitimately differ (e.g. longest 9, current 5).
export const useCurrentStreakDays = (): number => {
  const dispositionLog = useDispositionLog();
  return currentCleanStreakDays(filterTrackedEvents(dispositionLog), FOOD_SCORE_TRACKING_START);
};

export const useAddItem = () => usePantryStore((s) => s.addItem);

export const useUpdateItem = () => usePantryStore((s) => s.updateItem);

export const useRemoveItem = () => usePantryStore((s) => s.removeItem);

export const useConsumeItem = () => usePantryStore((s) => s.consumeItem);

export const useDisposeItem = () => usePantryStore((s) => s.disposeItem);

export const useMoveItem = () => usePantryStore((s) => s.moveItem);

export const useResetPantry = () => usePantryStore((s) => s.resetPantry);

export const useRestoreFromBackup = () => usePantryStore((s) => s.restoreFromBackup);

export const useSetBarcodeCategoryOverride = () =>
  usePantryStore((s) => s.setBarcodeCategoryOverride);

export const useRecallableItems = () =>
  usePantryStore(useShallow((s) => s.recallableItems.filter((r) => isRecallable(r.disposedAt))));

export const useRecallItem = () => usePantryStore((s) => s.recallItem);

// Synchronous lookup — used by scan flow before dispatching state updates.
export const getBarcodeCategoryOverride = (barcode: string): ItemCategory | undefined =>
  usePantryStore.getState().barcodeCategoryOverrides[barcode];

export const useHasHydrated = (): boolean => {
  const [hydrated, setHydrated] = useState<boolean>(() => usePantryStore.persist.hasHydrated());
  useEffect(() => {
    const unsubStart = usePantryStore.persist.onHydrate(() => setHydrated(false));
    const unsubFinish = usePantryStore.persist.onFinishHydration(() => setHydrated(true));
    return () => {
      unsubStart();
      unsubFinish();
    };
  }, []);
  return hydrated;
};
