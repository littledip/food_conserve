export type ItemCategory =
  | 'produce'
  | 'protein'
  | 'dairy'
  | 'grains'
  | 'condiments'
  | 'beverages'
  | 'frozen'
  | 'snacks'
  | 'other';

export type StorageLocation = 'fridge' | 'freezer' | 'pantry';

export type ExpirationDateType =
  | 'use_by'
  | 'best_by'
  | 'sell_by'
  | 'freeze_by'
  | 'freeze_or_use_by'
  | 'estimated';

export type StorageEventType =
  | 'added'
  | 'moved_to_freezer'
  | 'moved_to_fridge'
  | 'moved_to_pantry';

export interface StorageEvent {
  eventType: StorageEventType;
  location: StorageLocation;
  date: Date;
}

export interface GroceryItem {
  id: string;

  // --- Identity ---
  name: string;
  category: ItemCategory;
  barcode?: string;
  imageUrl?: string;

  // --- Location ---
  storageLocation: StorageLocation;
  storageHistory: StorageEvent[];

  // --- Expiration & Freshness ---
  printedExpirationDate?: Date;
  effectiveExpirationDate: Date;
  expirationDateType: ExpirationDateType;
  freezerExpirationDate?: Date;
  isFreezable: boolean;
  fridgeDaysUsedBeforeFreeze?: number;
  thawCycleCount: number;

  // --- Quantity ---
  unitOfMeasure: string;
  originalQuantity: number;
  remainingQuantity: number;

  // --- Source & Cost ---
  purchaseDate: Date;
  dateAdded: Date;
  store?: string;
  unitCost?: number;
  totalCost?: number;
  inputMethod: 'barcode' | 'image_recognition' | 'manual' | 'receipt' | 'api_import';
}

export type ProfileScope = 'item' | 'category' | 'household';
export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface ConsumptionProfile {
  scope: ProfileScope;
  householdId: string;
  itemBarcode?: string;
  category?: ItemCategory;

  consumptionRate: number;
  consumptionRateTrend: 'improving' | 'stable' | 'worsening';
  wasteRate: number;

  averageCost?: number;
  freezeFrequency?: number;
  avgFridgeDaysBeforeFreeze?: number;

  seasonalVariation: boolean;

  observationCount: number;
  confidenceLevel: ConfidenceLevel;
  lastUpdated: Date;
}

// Derived type for Pantry screen grouping
export interface GroupedPantryItems {
  category: ItemCategory;
  items: GroceryItem[];
  urgentCount: number; // items expiring within 2 days
}

export type Disposition = 'used' | 'wasted';

// How a wasted item physically left the household. Only meaningful for
// 'wasted' events — feeds the disposal-phase term (EPA WARM) of the Food
// Score's environmental-impact weighting, separate from the production
// footprint already captured by category/item. Defaults to 'trash'
// (landfill) at disposal time; the user can change it before confirming.
export type WasteMethod = 'trash' | 'compost' | 'drain';

interface DispositionEventBase {
  id: string;                      // event id (separate from item id)
  itemId: string;
  itemName: string;
  category: ItemCategory;
  quantity: number;                // amount used or wasted in this event
  unitOfMeasure: string;
  date: Date;
  expiredAtTime: boolean;          // was the item past its effective expiration when disposed?
}

// Discriminated on `disposition` so wasteMethod can only exist on a 'wasted'
// event — the type system enforces "empty method implies used" rather than
// relying on a convention every call site has to remember.
export type DispositionEvent =
  | (DispositionEventBase & { disposition: 'used' })
  | (DispositionEventBase & { disposition: 'wasted'; wasteMethod: WasteMethod });

// Snapshot of a fully-disposed item, kept so the user can undo a mistaken
// "Used all". DispositionEvent is intentionally lightweight for analytics;
// full state restoration needs the whole GroceryItem.
export interface RecallableItem {
  item: GroceryItem;
  dispositionEventId: string;
  disposedAt: Date;
}

// The shape Claude vision returns for a parsed receipt. Lives outside
// GroceryItem because it's the wire format from the LLM; the review-list UI
// translates each ParsedReceiptItem into a GroceryItem on user confirm.
export interface ParsedReceiptItem {
  name: string;                    // human-readable, abbreviations expanded
  category: ItemCategory;
  quantity: number;
  unitOfMeasure: string;           // 'units' default; 'lbs'/'oz' for weight-priced
  unitCost: number | null;         // null when discount/BOGO/unclear
  totalCost: number | null;
  shelfLifeDays: number;           // LLM's estimate, lean-low (see prompt rules)
  confidence: 'high' | 'low';      // 'low' when the line had pricing ambiguity
}

export interface ParsedReceipt {
  store: string | null;
  purchaseDate: string | null;     // 'YYYY-MM-DD'
  items: ParsedReceiptItem[];
}
