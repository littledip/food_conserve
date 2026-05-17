# Food Conserve

Gamified food-waste reduction for households. Scan groceries in, track expirations, earn a Food Score and a daily streak by avoiding waste. Phase 2 will connect households to grocery retailers for personalized restocking and consumption-based offers.

## Status

Phase 1 MVP, pre-launch. Local-only persistence today (AsyncStorage). Cloud sync via Supabase (event-sourced, multi-device) is fully designed but not yet implemented — see [docs/product-spec.md](docs/product-spec.md) deferred decisions and the architecture plan referenced in [Documentation](#documentation).

## What it does

- **Scan a barcode** (Open Food Facts lookup) or enter items manually, with editable expiration, storage location, quantity, and category.
- **Home screen** — daily summary with food score, streak, monthly savings, "Needs attention" list of items expiring today/tomorrow with one-tap Used / Wasted icons (context-aware emphasis as items pass expiration) and a "Move to freezer" badge for freezable items.
- **Pantry screen** — grouped by category, one category expanded at a time, with collapsed previews. Tap any row to open a detail sheet with Used all / Used half / Used a third / custom-amount presets, Move to freezer (when freezable), and a destructive "Threw it out" path.
- **Disposition log** — every Used or Wasted action records a typed event with quantity, category, and whether the item was past its expiration. Provides the data layer for the eventual Food Score waste-rate calculation.
- **Splash screen** — minimum 3 seconds, also gates on AsyncStorage rehydration so no "empty then populated" flash.
- **Profile** — lifetime stats, food-score breakdown, monthly savings chart, preferences (display-only), and a destructive "Reset pantry" affordance for clean-slate testing.

## Tech stack

- **Mobile**: Expo SDK 54, React Native 0.81, React 19, TypeScript 5.9
- **Routing**: expo-router (file-based)
- **Camera**: expo-camera with barcode scanning; Open Food Facts API for product lookup
- **State**: Zustand 5 with the `persist` middleware backed by `@react-native-async-storage/async-storage` (`version: 1`)
- **Testing**: Jest 29 + ts-jest, node environment, AsyncStorage mocked via the package's built-in jest mock
- **Icons**: `@expo/vector-icons` (Ionicons)

See [package.json](package.json) for exact versions.

## Getting started

### Prerequisites

- Node.js (Active LTS)
- npm (bundled with Node)
- Either:
  - Expo Go on a physical iOS or Android device (fastest path), or
  - Xcode (for iOS Simulator), or
  - Android Studio (for Android Emulator)

### Install

```sh
npm install
```

### Run

```sh
npm start         # Expo dev server with QR code for Expo Go
npm run ios       # iOS Simulator (requires Xcode)
npm run android   # Android Emulator (requires Android Studio)
npm run web       # Web — limited; camera not available in browser
```

### Test

```sh
npx jest          # all unit tests (currently 45 passing)
npx tsc --noEmit  # type-check the entire project
```

## Project structure

```
.
├── app/                       # expo-router file-based routes
│   ├── _layout.tsx            # root layout; splash + AsyncStorage hydration gate
│   └── (tabs)/                # bottom-tab group
│       ├── _layout.tsx        # tab bar config
│       ├── index.tsx          # Home
│       ├── pantry.tsx         # Pantry list + item detail sheet
│       ├── scan.tsx           # Barcode / manual entry
│       └── profile.tsx        # Stats + preferences + Reset
├── stores/
│   └── pantryStore.ts         # Zustand store, actions, selector hooks,
│                              #   persist middleware, Date revivers
├── types/
│   └── grocery.ts             # GroceryItem, DispositionEvent, etc.
├── constants/
│   ├── theme.ts               # Color palette + spacing tokens
│   └── mockData.ts            # Mock items — kept as test fixtures; not loaded
│                              #   into the store anymore (empty seed)
├── docs/
│   └── product-spec.md        # Product spec, data models, screen specs,
│                              #   deferred decisions table (19+ entries)
├── __tests__/
│   └── pantryStore.test.ts    # 45 unit tests covering pure helpers, store
│                              #   actions, persistence revivers, and reset
├── jest.config.js             # ts-jest + node env + jest.setup.js
├── jest.setup.js              # mocks AsyncStorage for tests
├── app.json                   # Expo app config
└── tsconfig.json              # extends expo/tsconfig.base, strict on
```

## Architecture notes

### State management

The pantry store is a hybrid of Zustand for client state and `useReducer`/`useState` for screen-local flows (e.g., the Scan screen's barcode lookup state machine). Selector hooks (`useUrgentItems`, `useExpiringThisWeek`, `useUpcomingWeek`, `useItemCount`, etc.) use `useShallow` so components only re-render when their slice changes — a 30-item pantry doesn't re-render the whole UI on a single edit.

### Persistence

Zustand's `persist` middleware writes the `items` and `dispositionLog` slices to AsyncStorage on every mutation. On launch, `useHasHydrated()` blocks the root layout from rendering tabs until rehydration completes. `Date` fields are revived from ISO strings via explicit walkers (`reviveItem`, `reviveDispositionEvent`) so they come back as real `Date` instances. Version is `1`; the first schema change will introduce a `migrate` function.

### Event-sourcing direction

The disposition log is already event-sourced (immutable, insert-only). The cloud-sync design (Supabase, multi-device) extends this pattern to every state change: a single `grocery_events` table as the source of truth, Postgres triggers maintaining read-optimized projections (`grocery_items`, `disposition_events`, etc.), Supabase Realtime as the pub-sub layer. Conflict resolution is implicit — events compose under server-assigned sequence numbers. This sidesteps last-write-wins issues for `remaining_quantity` and gives the Food Score / AI layers their training data for free.

## Documentation

- [docs/product-spec.md](docs/product-spec.md) — full product specification:
  - App overview, platform decision, design language with color palette
  - Data models (`GroceryItem`, `ConsumptionProfile`, `DispositionEvent`)
  - Per-screen specifications (Home, Pantry, Scan, Profile)
  - Deferred decisions table (currently 19 rows — open architecture / UX questions parked for later, each with the options considered and the conditions for revisiting)

## Roadmap

Tracked in detail in the deferred decisions table; high-level themes:

- **Cloud sync** (Supabase, event-sourced) — design locked, implementation pending.
- **Bare React Native migration** — Expo managed today; eject path is `npx expo prebuild` keeping Expo packages, or full swap to React Navigation + `react-native-vision-camera`.
- **AI/ML layer** — household consumption profile blending, freezer-life baselines per category/item, Open Food Facts category mapping.
- **Phase 2 marketplace** — Instacart / Walmart / Amazon Fresh integrations.
- **Push notifications** — expiration alerts via a server-side cron scanning `effective_expiration_date`.

## License

Not yet set.
