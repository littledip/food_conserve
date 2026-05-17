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
} from '../types/grocery';

const DAY_MS = 86400000;
const URGENT_DAYS = 1;
const WEEK_DAYS = 7;

export const daysUntil = (date: Date, now: Date = new Date()): number =>
  Math.ceil((date.getTime() - now.getTime()) / DAY_MS);

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
  addItem: (item: GroceryItem) => void;
  updateItem: (id: string, patch: Partial<GroceryItem>) => void;
  removeItem: (id: string) => void;
  moveItem: (id: string, to: StorageLocation) => void;
  consumeItem: (id: string, used: number) => void;
  disposeItem: (id: string, disposition: Disposition) => void;
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
          return {
            items: state.items.filter((i) => i.id !== id),
            dispositionLog: [...state.dispositionLog, event],
          };
        }),

      resetPantry: () => set({ items: [], dispositionLog: [] }),
    }),
    {
      name: 'food-conserve-pantry/v1',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        items: state.items,
        dispositionLog: state.dispositionLog,
      }),
      merge: (persistedState, currentState) => {
        const p = (persistedState ?? {}) as { items?: unknown[]; dispositionLog?: unknown[] };
        return {
          ...currentState,
          items: Array.isArray(p.items) ? p.items.map(reviveItem) : [],
          dispositionLog: Array.isArray(p.dispositionLog)
            ? p.dispositionLog.map(reviveDispositionEvent)
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
