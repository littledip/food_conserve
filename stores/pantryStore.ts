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
  RecallableItem,
} from '../types/grocery';

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
  addItem: (item: GroceryItem) => void;
  updateItem: (id: string, patch: Partial<GroceryItem>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, to: StorageLocation) => void;
  consumeItem: (id: string, used: number) => void;
  disposeItem: (id: string, disposition: Disposition) => void;
  recallItem: (itemId: string) => void;
  setBarcodeCategoryOverride: (barcode: string, category: ItemCategory) => void;
  resetPantry: () => void;
};

const generateEventId = (): string =>
  `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildDispositionEvent = (
  item: GroceryItem,
  disposition: Disposition,
  quantity: number,
  now: Date = new Date(),
): DispositionEvent => ({
  id: generateEventId(),
  itemId: item.id,
  itemName: item.name,
  category: item.category,
  disposition,
  quantity,
  unitOfMeasure: item.unitOfMeasure,
  date: now,
  expiredAtTime: item.effectiveExpirationDate.getTime() < now.getTime(),
});

export const usePantryStore = create<PantryState>()(
  persist(
    (set) => ({
      items: [],
      dispositionLog: [],
      barcodeCategoryOverrides: {},
      recallableItems: [],

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

      disposeItem: (id, disposition) =>
        set((state) => {
          const item = state.items.find((i) => i.id === id);
          if (!item) return state;
          const event = buildDispositionEvent(item, disposition, item.remainingQuantity);
          const pruned = state.recallableItems.filter((r) => isRecallable(r.disposedAt, event.date));
          const recallableItems =
            disposition === 'used'
              ? [...pruned, { item, dispositionEventId: event.id, disposedAt: event.date }]
              : pruned;
          return {
            items: state.items.filter((i) => i.id !== id),
            dispositionLog: [...state.dispositionLog, event],
            recallableItems,
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

      resetPantry: () =>
        set({
          items: [],
          dispositionLog: [],
          barcodeCategoryOverrides: {},
          recallableItems: [],
        }),
    }),
    {
      name: 'food-conserve-pantry/v1',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        items: state.items,
        dispositionLog: state.dispositionLog,
        barcodeCategoryOverrides: state.barcodeCategoryOverrides,
        recallableItems: state.recallableItems,
      }),
      merge: (persistedState, currentState) => {
        const p = (persistedState ?? {}) as {
          items?: unknown[];
          dispositionLog?: unknown[];
          barcodeCategoryOverrides?: unknown;
          recallableItems?: unknown[];
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

export const useAddItem = () => usePantryStore((s) => s.addItem);

export const useUpdateItem = () => usePantryStore((s) => s.updateItem);

export const useRemoveItem = () => usePantryStore((s) => s.removeItem);

export const useConsumeItem = () => usePantryStore((s) => s.consumeItem);

export const useDisposeItem = () => usePantryStore((s) => s.disposeItem);

export const useMoveItem = () => usePantryStore((s) => s.moveItem);

export const useResetPantry = () => usePantryStore((s) => s.resetPantry);

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
