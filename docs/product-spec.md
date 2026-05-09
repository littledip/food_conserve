# Food Conserve — Product Specification

## 1. App Overview

Food Conserve is a gamified food waste reduction app for consumers. The core loop:
- Users scan groceries into a household inventory
- The app tracks expiration dates and alerts users before food goes to waste
- Avoiding waste earns a "Food Score" and builds a daily streak
- Savings are calculated and shown as a motivating metric

**Phase 2 vision:** A two-sided marketplace connecting households to grocery retailers (Instacart, Walmart, Amazon Fresh) — enabling personalized offers based on household consumption patterns and purchase timing.

---

## 2. Platform Decision

**Chosen stack: React Native + Expo**

React Native was chosen over Flutter for the following reasons:

- **Camera and ML integration**: Libraries like `react-native-vision-camera` are battle-tested for barcode scanning and real-time image recognition — the primary input mechanism for the product.
- **Third-party ecosystem**: Instacart, Walmart, and Amazon Fresh have better-documented JavaScript SDKs, simplifying the Phase 2 retailer integration.
- **Expo**: Managed layer that handles native build complexity, enables over-the-air updates without app store submissions, and accelerates the path to a testable prototype. Can be "ejected" to bare React Native if lower-level control is needed later.
- **Hiring**: The JavaScript/TypeScript talent pool is substantially larger than Dart's.

**Deferred:** Expo managed workflow vs. bare React Native — see Deferred Decisions.

---

## 3. Design Language

**Visual style:** Warm & earthy. Natural greens, warm ambers, soft creams. Feels trustworthy and organic rather than cold and techy.

### Color Palette

| Token | Hex | Usage |
|---|---|---|
| Primary Green | `#3B6D11` | Header backgrounds, active tab, links, section labels |
| Dark Green | `#27500A` | Large numbers, card headings, score pill background |
| Mid Green | `#639922` | Progress bars, stat sublabels, fresh item dots |
| Light Green | `#C0DD97` | Status bar text on dark header, projection pill background |
| Teal Sub | `#9FE1CB` | Subtitle text on dark headers |
| Stat Card BG | `#EAF3DE` | Savings metric card, lifetime stat cards |
| Pantry Count BG | `#FAEEDA` | Pantry count metric card (warm amber tint) |
| Alert Card BG | `#FCEBEB` | Needs Attention card background |
| Alert Border | `#F09595` | Needs Attention card border |
| Background | `#F7F3EE` | General screen background |
| Card White | `#FFFFFF` | Pantry group cards, settings groups, score card |
| Border Color | `#D3D1C7` | Card borders, tab bar border |
| Subtle Border | `#F1EFE8` | Progress bar backgrounds, inner dividers |
| Orange | `#EF9F27` | Streak badge, amber urgency dots, scan frequency bar |
| Orange Dark | `#854F0B` | Streak best text, pantry count label, correction link |
| Streak Text | `#412402` | Streak number |
| Streak Sub | `#633806` | Streak label/sub text |
| Amber Text | `#BA7517` | Pantry count subtext |
| Red Dot | `#E24B4A` | Red urgency dots |
| Red Text | `#A32D2D` | "Expires today" text |
| Red Dark | `#791F1F` | Alert card title, "See all" link |
| Urgent Badge BG | `#FCEBEB` | Urgency count badge in category header |
| Item Border Urgent | `#97C459` | Urgent pantry item border |
| Freeze Badge BG | `#E6F1FB` | Freezable badge background (blue) |
| Freeze Badge Text | `#0C447C` | Freezable badge text (blue) |
| Bar Light | `#97C459` | Monthly savings bar (non-current months) |

### Navigation

4-tab bottom navigation: **Home · Pantry · Scan · Profile**

---

## 4. Data Models

### 4.1 GroceryItem

The core object representing a single physical item in the household's inventory. It is a factual record — it doesn't know anything about the household's patterns or history.

```typescript
type ItemCategory =
  | 'produce'
  | 'protein'
  | 'dairy'
  | 'grains'
  | 'condiments'
  | 'beverages'
  | 'frozen'
  | 'snacks'
  | 'other';

type StorageLocation = 'fridge' | 'freezer' | 'pantry';

type ExpirationDateType =
  | 'use_by'
  | 'best_by'
  | 'sell_by'
  | 'freeze_by'
  | 'freeze_or_use_by'
  | 'estimated';

type StorageEventType =
  | 'added'
  | 'moved_to_freezer'
  | 'moved_to_fridge'
  | 'moved_to_pantry';

interface StorageEvent {
  eventType: StorageEventType;
  location: StorageLocation;
  date: Date;
}

interface GroceryItem {
  id: string;

  // --- Identity ---
  name: string;
  category: ItemCategory;
  barcode?: string;           // UPC for packaged goods
  imageUrl?: string;

  // --- Location ---
  storageLocation: StorageLocation;
  storageHistory: StorageEvent[];  // Full chronological movement log

  // --- Expiration & Freshness ---
  printedExpirationDate?: Date;   // Immutable — what the label says
  effectiveExpirationDate: Date;  // Computed — used for urgency logic and alerts
  expirationDateType: ExpirationDateType;
  freezerExpirationDate?: Date;   // AI-estimated when item is frozen
  isFreezable: boolean;
  fridgeDaysUsedBeforeFreeze?: number;  // Computed from storageHistory
  thawCycleCount: number;         // Safety-critical: refreezing after thaw is a risk

  // --- Quantity ---
  unitOfMeasure: string;          // 'units', 'grams', 'ml', 'lbs', etc.
  originalQuantity: number;
  remainingQuantity: number;

  // --- Source & Cost ---
  purchaseDate: Date;
  dateAdded: Date;
  store?: string;
  unitCost?: number;              // Optional until grocery API integration (Phase 2)
  totalCost?: number;
  inputMethod: 'barcode' | 'image_recognition' | 'manual' | 'receipt' | 'api_import';
}
```

**Key design decisions:**

- **`printedExpirationDate` vs `effectiveExpirationDate`**: The printed date is immutable — it's what the label says. The effective date is what the app actually uses for urgency logic. When an item is frozen, `effectiveExpirationDate` switches to `freezerExpirationDate` automatically.
- **`storageHistory`**: Replaces simple `movedToFreezer`/`movedToFreezerDate` fields with a full movement log. Enables computing `fridgeDaysUsedBeforeFreeze` and `thawCycleCount` from first principles.
- **Freeze cycle safety**: When an item moves from freezer back to fridge, the new `effectiveExpirationDate` is calculated based on how much fridge shelf life was consumed before freezing, not the original printed date. `thawCycleCount` tracks refreezing risk.
- **`isFreezable`**: Drives the "Move to freezer" CTA and "Freezable — save it today" badge. Not all items can be frozen.
- **`unitCost` / `totalCost`**: Optional until Phase 2 grocery API integration. The savings calculation degrades gracefully to estimates when these are null.
- **`inputMethod`**: Quiet but valuable for AI improvement — if image recognition consistently misidentifies a produce item, that's detectable in the data.

---

### 4.2 ConsumptionProfile

A learned model of household behavior, built by observing many GroceryItems over time. Fundamentally different from `GroceryItem` — it's aggregate and probabilistic, not factual.

```typescript
type ProfileScope = 'item' | 'category' | 'household';
type ConfidenceLevel = 'low' | 'medium' | 'high';
// low:    < 5 observations — fall back to population average
// medium: 5–20 observations — blend household data with population
// high:   > 20 observations — use household data primarily

interface ConsumptionProfile {
  scope: ProfileScope;
  householdId: string;
  itemBarcode?: string;         // For item-scope profiles
  category?: ItemCategory;      // For category-scope profiles

  consumptionRate: number;      // Units consumed per day
  consumptionRateTrend: 'improving' | 'stable' | 'worsening';
  wasteRate: number;            // Percentage of items wasted (0–1)

  averageCost?: number;         // Average cost per unit for this item/category
  freezeFrequency?: number;     // How often this household freezes this item
  avgFridgeDaysBeforeFreeze?: number;

  seasonalVariation: boolean;   // Whether consumption varies significantly by season

  observationCount: number;
  confidenceLevel: ConfidenceLevel;
  lastUpdated: Date;
}
```

**Three-scope hierarchy:** A household will have multiple `ConsumptionProfile` records:
- **Household scope** (1 per household): Overall behavior signals. Available immediately.
- **Category scope** (1 per category purchased): How the household uses produce, protein, etc. Builds after a few weeks.
- **Item scope** (1 per distinct item with sufficient history): The most precise. Reliable after a few months.

The AI reads up the hierarchy by confidence — item first, fall back to category, fall back to household if needed.

**`consumptionRateTrend`** is a gamification driver: "improving" means consuming food faster relative to their own history — a Food Score signal and positive reinforcement notification candidate.

---

## 5. Screen Specifications

### 5.1 Home Screen

**Purpose:** Daily summary. Create the habit of opening the app each morning.

**Layout:** Green header + cream body.

**Header elements:**
- Greeting: "Good morning, Sarah"
- Title: "Your day at a glance"
- **Score pill** (dark green `#27500A`): Food score (large number) + "Top X% of households" on the left; orange streak badge on the right

**Body elements:**
1. **Metric cards row** (side by side):
   - *Saved this month*: MTD savings + "X of Y days" + green projection pill "on pace for $Z" (daily run rate × days remaining)
   - *Items in pantry*: Total item count + "N expiring this week"
2. **"Needs attention"** section: Shows only items expiring **today or tomorrow** with colored urgency dots (red = today, amber = tomorrow). Title states the count explicitly.
3. **"See all expiring this week"** row: Links to the Pantry screen. Previews the next item beyond what's shown ("1 more — Greek yogurt, 5 days").

**UX decisions:**
- The urgency hierarchy (red → amber) creates a clear action signal without feeling alarming.
- Metric cards appear *before* the alert section: positive reinforcement (savings, pantry count) before urgency (expiring items).
- The projection is intentionally conservative — overshooting a projection feels worse than beating a modest one.

---

### 5.2 Pantry Screen

**Purpose:** Source of truth for all household inventory. Every other screen depends on this data being accurate.

**Layout:** Cream background. "Pantry" in dark green as a page title (no green header bar).

**Header elements:**
- Search bar (white, full-width)
- Filter button (outlined, lines icon + "Filter" label)

**Category list:**
- Items are **grouped by category** (factory default; user-configurable in Preferences)
- **One category open at a time** — opening a new category collapses the previous one
- **Collapsed category** shows a preview row: colored dots + comma-separated item names, grouped by urgency (urgent items first with amber dot, fresh items with green dot)
- **Category header** shows: name + urgency badge ("N urgent", red pill) + item count + ▲/▼ collapse indicator

**Item rows:**
- **Urgent item** (expiring today or tomorrow): white background, green border (`#97C459`), red dot, "Today" label in red. If `isFreezable`: blue "Freezable — save it today" badge.
- **Normal item**: cream background, gray border, green dot, days remaining in green.

**"See all expiring this week"** from Home routes here with an expiration filter pre-applied (future wiring — for MVP, Pantry opens in default state).

**Filter panel** (bottom sheet): Expiring window, Storage location, Category sections. Apply button shows result count.

**UX decisions:**
- Grouped by category because that's how people mentally scan their kitchen ("what do I have for protein tonight?").
- One category open at a time keeps the list scannable on a real device with 30+ items.
- The collapsed preview gives just enough information to decide whether to expand without tapping everything.

---

### 5.3 Scan Screen

**Purpose:** Primary entry point for adding items to the pantry.

**Layout:** Fixed (no scroll). Dark camera view (top) + cream bottom sheet (bottom).

**Camera view:**
- Live camera feed (`expo-camera` `CameraView`, facing back)
- "POINT AT BARCODE" label (small caps, muted)
- Viewfinder frame with 4 corner brackets (light green `#EAF3DE`)
- Scan line (green `#97C459`, centered vertically in frame)
- "Hold steady — scanning automatically" hint below the frame
- Mode selector: **Barcode** (default) | **Photo** | **Manual**

**Barcode mode — scan states:**

| State | Sheet shows |
|---|---|
| `idle` | "Point your camera at a barcode" prompt |
| `loading` | Spinner + "Looking up item…" |
| `result` | Result card with real item data |
| `error` | Error message + "Try again" button |

- Barcode detection via `onBarcodeScanned` (pauses after each detect to prevent repeated fires)
- Item lookup via **Open Food Facts API** (`world.openfoodfacts.org/api/v0/product/{barcode}.json`) — free, no API key
- On lookup success: populates name, brand, category, barcode, match confidence
- On lookup failure (item not found or network error): shows error state with retry option
- "Scan another" resets to idle

**Result card (barcode mode):**
- Item name + brand/category/UPC (from API)
- Match confidence bar
- **Editable fields**: Expiration date (with type selector), Storage location, Quantity + unit, Store
- Action buttons: **Scan another** (secondary) | **Add to pantry** (primary, 2× width)

**Manual mode:**
- Camera area dims and shows "MANUAL ENTRY" label (no live feed needed)
- Sheet becomes a blank entry form: Name, Category, Expiration date + type, Storage location, Quantity + unit, Store
- Footer buttons: **Cancel** (returns to Barcode mode) | **Add to pantry** (validates name non-empty)

**Photo mode:** chip is present in the UI; behavior deferred (see Deferred Decisions).

**Pantry persistence:** "Add to pantry" currently logs the item. Shared state layer (React Context or Zustand) needed to make items visible in the Pantry screen — deferred to the next implementation phase.

**UX decisions:**
- Scan state machine prevents the result card from showing on launch — sheet is minimal until a barcode is detected.
- Field controls use cream background (`#F7F3EE`) to feel editable but not heavy.
- "Add to pantry" is 2× wider than "Scan another" to bias toward the primary action.
- Camera permission is requested on first entry to the screen; graceful message shown if denied.

---

### 5.4 Profile Screen

**Purpose:** Personal stats, Food Score breakdown, savings history, and app preferences.

**Layout:** Green header + scrollable cream body.

**Header elements:**
- Avatar circle with initials
- Name + "Member since" + household info
- Summary boxes side by side: Food Score box (dark green) + Streak box (orange)

**Body sections:**
1. **Lifetime stats**: 3-column grid of green-tinted cards — Total saved, Items tracked, Waste avoided (with benchmark comparison "vs. 68% avg")
2. **Food score breakdown**: White card. Large score number + "Top X% of households". Four component bars: Waste rate, Savings trend, Streak, Scan frequency (Scan frequency uses amber bar as it's the lagging indicator)
3. **Monthly savings**: Bar chart with time range selector (3 mo / 6 mo / Year). Current month shown in darker green, with footnote "* [Month] in progress".
4. **Preferences**: Notifications, Default pantry view, Units of measure

**UX decisions:**
- Score + streak are surfaced in the header (not buried in the body) so they're immediately visible — same emotional hook as the Home screen.
- The four breakdown bars make the score feel earned and legible, not arbitrary.
- "Scan frequency" in amber is a deliberate gentle nudge — it's the one input the user can most directly control.

---

## 6. Deferred Decisions / Notes for Later

These items were explicitly parked during the design session and should be revisited:

| # | Topic | Detail |
|---|---|---|
| 1 | **Expo managed vs. bare workflow** | Deferred pending native camera requirements. If `react-native-vision-camera` requires bare workflow, this forces the decision. |
| 2 | **GroceryItem state machine** | Define valid `StorageLocation` transitions (e.g., freezer → pantry should not be allowed without passing through fridge). Likely a simple state machine alongside the object spec. |
| 3 | **ConsumptionProfile blending algorithm** | How to weight household-specific data against population averages at "medium" confidence. Core AI/ML product spec work. |
| 4 | **Population benchmark data source** | USDA food waste data, proprietary benchmarks from aggregated anonymized data, or a combination. Needed for low-confidence fallback in `ConsumptionProfile`. |
| 5 | **"vs. same point last month" savings comparison** | Requires at least one full prior month of data. Revisit once retention strategy is defined and we know what data we'll have at 30/60/90 day marks. |
| 6 | **"Add item" button on Pantry screen** | Deferred until Scan screen flow is finalized. Entry point for now is the Scan tab. Button placement and behavior should feel like a natural extension of the Scan screen. |
| 7 | **Weekly challenges / gamification** | The weekly challenge card was removed from the Home screen as clutter. Consider: dedicated Challenges tab, section within Profile, or push notification mechanic ("This week's challenge: zero waste!"). |
| 8 | **ConsumptionProfile object split** | Evaluate whether to split into three distinct typed objects — `HouseholdProfile`, `CategoryProfile`, `ItemProfile` — sharing a common base interface. Single object with scope discriminator is simpler to start; three typed objects may be cleaner as the AI layer grows. Revisit when defining data persistence and query strategy. |
| 9 | **"Log partial use" interaction** | Three options: slider (0–100% remaining), quick-tap presets ("used half", "used a third", "almost gone"), or free entry in the item's unit of measure. Decision affects `remainingQuantity` data reliability and savings calculation accuracy. |
| 10 | **Food score name finalization** | "Food score" is the working placeholder. Final name should follow once the scoring model inputs are defined (waste reduction, savings, streak, meal planning compliance, scan frequency, etc.). Candidates discussed: Kitchen Score, Harvest Score, Pantry Score. |
| 11 | **Savings projection algorithm** | Projection should be slightly conservative (daily run rate × remaining days, rounded down). Overshooting a projection feels worse than beating a modest one. |
| 12 | **Meal suggestions section** | Visible on Home screen mockup but not designed in detail. Meal suggestions should be tied to at-risk items ("cook this to avoid waste"). Deferred to a later design session. |
| 13 | **"Not the right item?" correction flow on Scan screen** | When a barcode scan returns the wrong item, the user needs a way to correct it. Options considered: inline name edit (text field replaces item name in the result card), search modal (slide-up sheet with search bar to look up the correct item by name or barcode), or full manual entry form. Removed from MVP UI pending a design decision on the correction UX. |
| 14 | **Open Food Facts → `ItemCategory` mapping** | Barcode adds currently default to `category: 'other'` because OFF returns freeform `categories_tags` strings (e.g. `en:meals`, `en:dairy`) that don't map cleanly onto our nine-category enum. Options: maintain a hand-curated mapping table, derive a category from the most-specific tag with a fuzzy match, or surface a category picker on the result card so the user confirms. The third option also doubles as training signal for a future automated mapping. |
