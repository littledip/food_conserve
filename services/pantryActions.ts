// Shared GroceryItem-construction helpers used by every "add to pantry" entry
// point: manual entry, barcode scan, receipt bulk-add (scan.tsx), and the
// conversational assistant (pantryChatExecutor.ts). Kept RN-free like
// receiptReview.ts so the date/storage-location logic is unit-testable.
import {
  ExpirationDateType,
  StorageLocation,
  ItemCategory,
  GroceryItem,
} from '../types/grocery';
import { parsePurchaseDate } from './receiptReview';

// Default storage by category (callers may override per row). Mirrors the spec:
// produce/protein/dairy → fridge, frozen → freezer, everything else → pantry.
export function storageForCategory(category: ItemCategory): StorageLocation {
  switch (category) {
    case 'produce':
    case 'protein':
    case 'dairy':
      return 'fridge';
    case 'frozen':
      return 'freezer';
    default:
      return 'pantry';
  }
}

export function buildItem(args: {
  name: string;
  category: ItemCategory;
  barcode?: string;
  expirationDate: Date;
  expirationType: ExpirationDateType;
  storageLocation: StorageLocation;
  quantity: number;
  unit: string;
  store: string;
  inputMethod: GroceryItem['inputMethod'];
  unitCost?: number;
  totalCost?: number;
  purchaseDate?: Date;
}): GroceryItem {
  const now = new Date();
  return {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    name: args.name,
    category: args.category,
    barcode: args.barcode,
    storageLocation: args.storageLocation,
    storageHistory: [{ eventType: 'added', location: args.storageLocation, date: now }],
    printedExpirationDate: args.expirationDate,
    effectiveExpirationDate: args.expirationDate,
    expirationDateType: args.expirationType,
    isFreezable: false,
    thawCycleCount: 0,
    unitOfMeasure: args.unit,
    originalQuantity: args.quantity,
    remainingQuantity: args.quantity,
    purchaseDate: args.purchaseDate ?? now,
    dateAdded: now,
    store: args.store || undefined,
    unitCost: args.unitCost,
    totalCost: args.totalCost,
    inputMethod: args.inputMethod,
  };
}

// The conversational assistant's add_items tool input for a single item —
// looser than scan.tsx's ReviewItem since the model may omit storageLocation
// and gives a shelf-life estimate in days rather than a concrete date.
export type ChatAddItem = {
  name: string;
  category: ItemCategory;
  quantity: number;
  unitOfMeasure: string;
  storageLocation?: StorageLocation;
  estimatedShelfLifeDays: number;
  explicitExpirationDate?: string | null;
  unitCost?: number | null;
  totalCost?: number | null;
};

// Builds the GroceryItem for one add_items entry: an explicit date (parsed the
// same way as a receipt's purchase date) wins over the shelf-life estimate;
// storageLocation falls back to the category default when the model omits it.
export function buildItemFromChatInput(input: ChatAddItem, now: Date = new Date()): GroceryItem {
  const explicit = input.explicitExpirationDate
    ? parsePurchaseDate(input.explicitExpirationDate)
    : undefined;

  let expirationDate: Date;
  if (explicit) {
    expirationDate = explicit;
  } else {
    expirationDate = new Date(now);
    expirationDate.setHours(0, 0, 0, 0);
    expirationDate.setDate(expirationDate.getDate() + input.estimatedShelfLifeDays);
  }

  return buildItem({
    name: input.name,
    category: input.category,
    expirationDate,
    expirationType: 'estimated',
    storageLocation: input.storageLocation ?? storageForCategory(input.category),
    quantity: input.quantity,
    unit: input.unitOfMeasure,
    store: '',
    inputMethod: 'manual',
    unitCost: input.unitCost ?? undefined,
    totalCost: input.totalCost ?? undefined,
  });
}

// The conversational assistant's update_item tool input — edits fields on an
// EXISTING item (name, category, storage location, expiration) rather than
// constructing a new one. Scoped deliberately narrow: no quantity/cost
// editing, since originalQuantity vs. remainingQuantity semantics get tricky
// once an item's been partially consumed — consume_item/mark_item_used_up
// already cover reducing quantity.
export type ChatUpdateItem = {
  name?: string;
  category?: ItemCategory;
  storageLocation?: StorageLocation;
  estimatedShelfLifeDaysFromPurchase?: number;
  explicitExpirationDate?: string | null;
};

// Builds the patch for pantryStore's updateItem(id, patch). An explicit date
// wins over a re-estimated shelf life, mirroring buildItemFromChatInput's
// precedence; the shelf-life estimate is anchored to the item's original
// purchaseDate (not "today") so correcting a guess doesn't also silently
// extend the item's life by however long it's been sitting in the pantry.
export function buildUpdatePatchFromChatInput(
  input: ChatUpdateItem,
  item: GroceryItem,
): Partial<GroceryItem> {
  const patch: Partial<GroceryItem> = {};

  if (input.name !== undefined) patch.name = input.name;
  if (input.category !== undefined) patch.category = input.category;
  if (input.storageLocation !== undefined) patch.storageLocation = input.storageLocation;

  let newExpiration: Date | undefined;
  if (input.explicitExpirationDate) {
    newExpiration = parsePurchaseDate(input.explicitExpirationDate);
  } else if (input.estimatedShelfLifeDaysFromPurchase !== undefined) {
    newExpiration = new Date(item.purchaseDate);
    newExpiration.setHours(0, 0, 0, 0);
    newExpiration.setDate(newExpiration.getDate() + input.estimatedShelfLifeDaysFromPurchase);
  }
  if (newExpiration) {
    patch.effectiveExpirationDate = newExpiration;
    patch.printedExpirationDate = newExpiration;
    patch.expirationDateType = 'estimated';
  }

  return patch;
}
