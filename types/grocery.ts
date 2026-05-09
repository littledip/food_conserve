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
