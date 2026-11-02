import type { DispositionEvent, GroceryItem, ItemCategory, WasteMethod } from '../types/grocery';

// Per-item environmental footprint data, deliberately with NO category-level
// fallback: produce/protein/dairy/grains cohere roughly by ingredient, but
// condiments/beverages/frozen/snacks/other don't (a "snacks" average spans
// Nuts at 0.43 kgCO2e/kg to Dark Chocolate at 46.65) — a category average
// there would be noise dressed up as a number. An item missing from this
// table has unknown impact, full stop; that's a real gap to surface and
// close by adding more items, not something to paper over with a guess.
//
// co2ePerKg: Our World in Data / Poore & Nemecek (2018), global average
// kgCO2eq per kg of product. See https://ourworldindata.org/grapher/ghg-per-kg-poore
// Branded/processed items are mapped to their closest raw-ingredient proxy
// (e.g. Hummus -> Other Pulses, Peanut Butter -> Groundnuts).
//
// typicalUnitWeightKg: only needed for genuinely ambiguous count units
// ("each", "jar", "box", "container") — rough estimates, correctable as
// real data comes in. Omitted when unitOfMeasure already embeds a weight
// (e.g. "6oz bag", "16oz bag") since resolveWeightKg parses that directly.
//
// defaultWasteMethod: the item's typical physical disposal pathway, used to
// pre-select (not force) the waste-method chip. Liquids default to 'drain'
// (you pour them out, you don't trash or compost milk); produce defaults to
// 'compost'; everything else defaults to 'trash' as the conservative
// baseline when we don't have a reason to assume better.
interface ItemImpactProfile {
  co2ePerKg: number;
  typicalUnitWeightKg?: number;
  defaultWasteMethod: WasteMethod;
}

const ITEM_IMPACT_TABLE: Record<string, ItemImpactProfile> = {
  apples: { co2ePerKg: 0.43, typicalUnitWeightKg: 0.18, defaultWasteMethod: 'compost' },
  bananas: { co2ePerKg: 0.86, typicalUnitWeightKg: 0.12, defaultWasteMethod: 'compost' },
  'yellow onion': { co2ePerKg: 0.50, typicalUnitWeightKg: 0.15, defaultWasteMethod: 'compost' },
  cauliflower: { co2ePerKg: 0.51, typicalUnitWeightKg: 0.6, defaultWasteMethod: 'compost' },
  cucumber: { co2ePerKg: 0.53, typicalUnitWeightKg: 0.3, defaultWasteMethod: 'compost' },
  zucchini: { co2ePerKg: 0.53, typicalUnitWeightKg: 0.2, defaultWasteMethod: 'compost' },
  'butternut squash': { co2ePerKg: 0.53, typicalUnitWeightKg: 0.9, defaultWasteMethod: 'compost' },
  'acorn squash': { co2ePerKg: 0.53, typicalUnitWeightKg: 0.5, defaultWasteMethod: 'compost' },
  eggplant: { co2ePerKg: 0.53, typicalUnitWeightKg: 0.45, defaultWasteMethod: 'compost' },
  'string beans': { co2ePerKg: 0.53, defaultWasteMethod: 'compost' },
  kiwis: { co2ePerKg: 1.05, typicalUnitWeightKg: 0.075, defaultWasteMethod: 'compost' },
  avocados: { co2ePerKg: 1.05, typicalUnitWeightKg: 0.2, defaultWasteMethod: 'compost' },
  blackberries: { co2ePerKg: 1.53, typicalUnitWeightKg: 0.17, defaultWasteMethod: 'compost' },
  blueberries: { co2ePerKg: 1.53, typicalUnitWeightKg: 0.17, defaultWasteMethod: 'compost' },
  eggs: { co2ePerKg: 4.67, typicalUnitWeightKg: 0.05, defaultWasteMethod: 'trash' },
  'shredded mozzarella cheese': { co2ePerKg: 23.88, defaultWasteMethod: 'trash' },
  milk: { co2ePerKg: 3.15, defaultWasteMethod: 'drain' },
  'unsweetened vanilla almond milk': { co2ePerKg: 0.98, defaultWasteMethod: 'drain' },
  'tangerine juice': { co2ePerKg: 0.39, defaultWasteMethod: 'drain' },
  hummus: { co2ePerKg: 1.79, defaultWasteMethod: 'trash' },
  'peanut butter': { co2ePerKg: 3.23, typicalUnitWeightKg: 0.45, defaultWasteMethod: 'trash' },
  walnuts: { co2ePerKg: 0.43, defaultWasteMethod: 'trash' },
  'triscuits (family size)': { co2ePerKg: 1.57, typicalUnitWeightKg: 0.41, defaultWasteMethod: 'trash' },
  'spaghetti №3': { co2ePerKg: 1.57, typicalUnitWeightKg: 0.45, defaultWasteMethod: 'trash' },
  penne: { co2ePerKg: 1.57, defaultWasteMethod: 'trash' },
  toufayan: { co2ePerKg: 1.57, typicalUnitWeightKg: 0.34, defaultWasteMethod: 'trash' },
  'yasso yogurt bars': { co2ePerKg: 3.15, typicalUnitWeightKg: 0.28, defaultWasteMethod: 'trash' },
};

const WEIGHT_UNIT_TO_KG: Record<string, number> = {
  kg: 1,
  g: 0.001,
  lb: 0.453592,
  lbs: 0.453592,
  oz: 0.0283495,
};

const EMBEDDED_WEIGHT_REGEX = /(\d+(?:\.\d+)?)\s*(kg|g|lbs?|oz)\b/i;

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// Prefers a weight parsed directly out of unitOfMeasure itself — many real
// unit strings already embed one ("6oz bag", "1lb bag", or a bare "oz" for
// liquids tracked by weight) — over the item table's typicalUnitWeightKg,
// which is only a rough guess for genuinely ambiguous count units.
function parseUnitWeightKg(unitOfMeasure: string): number | null {
  const trimmed = unitOfMeasure.trim().toLowerCase();
  const match = trimmed.match(EMBEDDED_WEIGHT_REGEX);
  if (match) {
    const amount = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    return amount * WEIGHT_UNIT_TO_KG[unit];
  }
  if (trimmed in WEIGHT_UNIT_TO_KG) return WEIGHT_UNIT_TO_KG[trimmed];
  return null;
}

type WeighableItem = Pick<GroceryItem, 'name' | 'unitOfMeasure' | 'remainingQuantity'>;

// Weight of `quantity` units of this named item, or null if it can't be
// determined (e.g. a volume unit like "half gallon" with no curated
// fallback) — callers must treat null as "unknown," not zero. Generic over
// quantity so callers can resolve weight for remainingQuantity,
// originalQuantity, or a single disposition event's own quantity alike.
export function resolveWeightKgFor(name: string, unitOfMeasure: string, quantity: number): number | null {
  const perUnitKg = parseUnitWeightKg(unitOfMeasure);
  if (perUnitKg !== null) return perUnitKg * quantity;

  const profile = ITEM_IMPACT_TABLE[normalizeName(name)];
  if (profile?.typicalUnitWeightKg != null) return profile.typicalUnitWeightKg * quantity;

  return null;
}

// Total weight of the item's current remaining quantity.
export function resolveWeightKg(item: WeighableItem): number | null {
  return resolveWeightKgFor(item.name, item.unitOfMeasure, item.remainingQuantity);
}

export interface EnvironmentalImpactResult {
  co2eKg: number;
  co2ePerKg: number;
}

// null means unknown impact — either the item isn't in the table, or its
// weight can't be resolved. Never guess a number in either case.
export function getEnvironmentalImpact(item: WeighableItem): EnvironmentalImpactResult | null {
  const profile = ITEM_IMPACT_TABLE[normalizeName(item.name)];
  if (!profile) return null;

  const weightKg = resolveWeightKg(item);
  if (weightKg === null) return null;

  return { co2eKg: weightKg * profile.co2ePerKg, co2ePerKg: profile.co2ePerKg };
}

// Pre-selects the waste-method chip; the user can still correct it before
// confirming, same as the existing blanket 'trash' default this refines.
export function resolveDefaultWasteMethod(item: Pick<GroceryItem, 'name'>): WasteMethod {
  return ITEM_IMPACT_TABLE[normalizeName(item.name)]?.defaultWasteMethod ?? 'trash';
}

export interface UnmappedWasteRecord {
  itemName: string;
  category: ItemCategory;
  quantity: number;
  unitOfMeasure: string;
  wasteMethod: WasteMethod;
  date: Date;
}

// Wasted items with no impact-table entry — a coverage gap to surface
// (and to prioritize when curating ITEM_IMPACT_TABLE further), derived
// straight from dispositionLog rather than tracked in separate storage.
export function getUnmappedWastedItems(dispositionLog: DispositionEvent[]): UnmappedWasteRecord[] {
  return dispositionLog
    .filter((e): e is DispositionEvent & { disposition: 'wasted' } => e.disposition === 'wasted')
    .filter((e) => !(normalizeName(e.itemName) in ITEM_IMPACT_TABLE))
    .map((e) => ({
      itemName: e.itemName,
      category: e.category,
      quantity: e.quantity,
      unitOfMeasure: e.unitOfMeasure,
      wasteMethod: e.wasteMethod,
      date: e.date,
    }));
}
