// End-to-end persistence tests: seed AsyncStorage, hydrate the real store,
// and assert nothing is lost. Unit-testing `migratePantryStore` in isolation
// is not enough — the data-loss risk lives in the migrate -> merge -> set
// handoff, and in whether zustand writes the result back to storage.
//
// Each case re-imports the store under jest.resetModules(), and must seed the
// SAME AsyncStorage module instance the store will import — a fresh registry
// hands the store an empty mock, which silently fakes a pass/fail.
const v1State = {
  items: [{
    id: 'item-1', name: 'Tangerine Juice', category: 'beverages',
    storageLocation: 'fridge',
    storageHistory: [{ eventType: 'added', location: 'fridge', date: '2026-10-28T12:00:00.000Z' }],
    effectiveExpirationDate: '2026-11-20T12:00:00.000Z',
    expirationDateType: 'best_by', isFreezable: false, thawCycleCount: 0,
    unitOfMeasure: 'oz', originalQuantity: 32, remainingQuantity: 16,
    purchaseDate: '2026-10-28T12:00:00.000Z', dateAdded: '2026-10-28T12:00:00.000Z',
    inputMethod: 'manual',
  }],
  dispositionLog: [{
    id: 'evt-1', itemId: 'item-1', itemName: 'Kiwis', category: 'produce',
    disposition: 'used', quantity: 2, unitOfMeasure: 'each',
    date: '2026-10-29T12:00:00.000Z', expiredAtTime: false,
  }],
  barcodeCategoryOverrides: { '123': 'dairy' },
  recallableItems: [],
};

async function hydrateFrom(blob: object) {
  jest.resetModules();
  // Seed the SAME module instance the store will import.
  const AS = (await import('@react-native-async-storage/async-storage')).default;
  await AS.clear();
  await AS.setItem('food-conserve-pantry/v1', JSON.stringify(blob));
  const { usePantryStore } = await import('../stores/pantryStore');
  await usePantryStore.persist.rehydrate();
  const after = await AS.getItem('food-conserve-pantry/v1');
  return { state: usePantryStore.getState(), stored: JSON.parse(after!) };
}

test('v1 blob survives migrate -> merge -> hydrate', async () => {
  const { state, stored } = await hydrateFrom({ version: 1, state: v1State });
  console.log('>>> V1 -> items:', state.items.length, '| dispositionLog:', state.dispositionLog.length);
  console.log('>>> V1 -> name:', state.items[0]?.name, '| origQty backfilled:', state.dispositionLog[0]?.originalQuantity);
  console.log('>>> V1 -> expiration is Date:', state.items[0]?.effectiveExpirationDate instanceof Date);
  console.log('>>> V1 -> storage now: version', stored.version, 'items', stored.state.items.length);
  expect(state.items).toHaveLength(1);
  expect(state.dispositionLog[0].originalQuantity).toBe(2);
});

test('v2 blob (already migrated) hydrates unchanged', async () => {
  const v2State = {
    ...v1State,
    dispositionLog: [{ ...v1State.dispositionLog[0], originalQuantity: 2 }],
    streakLog: [], lastStreakCheckpointAt: null,
  };
  const { state } = await hydrateFrom({ version: 2, state: v2State });
  console.log('>>> V2 -> items:', state.items.length, '| dispositionLog:', state.dispositionLog.length);
  expect(state.items).toHaveLength(1);
});

test('REGRESSION: a schema DOWNGRADE must not empty the store', async () => {
  // The exact scenario that lost a week of data: storage written by a newer
  // build (v3 here) loaded by an older one. Previously zustand found no
  // migrate path, handed undefined to merge, and merge produced an empty
  // store which the next write persisted over everything.
  const v3State = {
    ...v1State,
    dispositionLog: [{ ...v1State.dispositionLog[0], originalQuantity: 2 }],
    streakLog: [], lastStreakCheckpointAt: null,
    someFutureSlice: { not: 'known to this build' },
  };
  const { state } = await hydrateFrom({ version: 3, state: v3State });
  expect(state.items).toHaveLength(1);
  expect(state.dispositionLog).toHaveLength(1);
  expect(state.items[0].name).toBe('Tangerine Juice');
});

test('the storage guard refuses an unauthorized write that would empty real data', async () => {
  jest.resetModules();
  const AS = (await import('@react-native-async-storage/async-storage')).default;
  await AS.clear();
  await AS.setItem('food-conserve-pantry/v1', JSON.stringify({ version: 2, state: v1State }));

  const { usePantryStore } = await import('../stores/pantryStore');
  await usePantryStore.persist.rehydrate();
  expect(usePantryStore.getState().items).toHaveLength(1);

  // Simulate the failure mode: force empty state in memory, then let persist write.
  usePantryStore.setState({ items: [], dispositionLog: [], streakLog: [] });
  await new Promise((r) => setTimeout(r, 0));

  const raw = await AS.getItem('food-conserve-pantry/v1');
  const stored = JSON.parse(raw!);
  expect(stored.state.items).toHaveLength(1); // refused — disk still intact
});

test('resetPantry is still able to clear storage legitimately', async () => {
  jest.resetModules();
  const AS = (await import('@react-native-async-storage/async-storage')).default;
  await AS.clear();
  await AS.setItem('food-conserve-pantry/v1', JSON.stringify({ version: 2, state: v1State }));

  const { usePantryStore } = await import('../stores/pantryStore');
  await usePantryStore.persist.rehydrate();
  usePantryStore.getState().resetPantry();
  await new Promise((r) => setTimeout(r, 0));

  const stored = JSON.parse((await AS.getItem('food-conserve-pantry/v1'))!);
  expect(stored.state.items).toHaveLength(0); // authorized — write went through
});
