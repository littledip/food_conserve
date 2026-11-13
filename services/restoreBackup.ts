import type {
  DispositionEvent,
  GroceryItem,
  ItemCategory,
  WasteMethod,
} from '../types/grocery';
import { storageForCategory } from './pantryActions';

// ONE-TIME RECOVERY DATA — not a product feature.
//
// A schema-version downgrade emptied the local store on 2026-11-13 (see the
// destructive-write guard in stores/pantryStore.ts for the mechanism and the
// safeguard added afterward). This file reconstructs what could be recovered
// from the debug exports captured on 2026-11-01/02.
//
// WHAT IS REAL: every disposition event below — name, category, unit,
// quantity, disposition and timestamp are verbatim from the export, so Food
// Score and streak history are faithful.
//
// WHAT IS RECONSTRUCTED: item expiration dates. The export never captured
// them. Only the nine shelf-stable staples are restored, each dated
// `RESTORE_ANCHOR + shelfLifeDays`, because the fifteen perishable produce
// items from the export are twelve days past export and certainly gone —
// restoring them would have meant inventing freshness for food that no longer
// exists. `isFreezable` is also a judgement call, not recovered data.
//
// Delete this file once the restore has been applied.

export const RESTORE_ANCHOR = new Date('2026-11-01T12:00:00.000Z');

const DAY_MS = 86400000;

interface BackupItem {
  name: string;
  category: ItemCategory;
  unitOfMeasure: string;
  originalQuantity: number;
  remainingQuantity: number;
  // Days from RESTORE_ANCHOR. Reconstructed, not recovered.
  shelfLifeDays: number;
  isFreezable: boolean;
}

// The nine staples still plausibly valid. Quantities are verbatim from the
// export; shelfLifeDays is an estimate.
export const BACKUP_ITEMS: BackupItem[] = [
  { name: 'SPAGHETTI №3', category: 'grains', unitOfMeasure: 'units', originalQuantity: 1, remainingQuantity: 1, shelfLifeDays: 730, isFreezable: false },
  { name: 'Peanut Butter', category: 'condiments', unitOfMeasure: 'jar', originalQuantity: 1, remainingQuantity: 1, shelfLifeDays: 365, isFreezable: false },
  { name: 'Hummus', category: 'condiments', unitOfMeasure: 'oz', originalQuantity: 16, remainingQuantity: 16, shelfLifeDays: 20, isFreezable: false },
  { name: 'Walnuts', category: 'snacks', unitOfMeasure: '8oz bag', originalQuantity: 1, remainingQuantity: 0.5, shelfLifeDays: 120, isFreezable: true },
  { name: 'Tangerine Juice', category: 'beverages', unitOfMeasure: 'oz', originalQuantity: 32, remainingQuantity: 32, shelfLifeDays: 14, isFreezable: false },
  { name: 'Unsweetened Vanilla Almond Milk', category: 'beverages', unitOfMeasure: 'oz', originalQuantity: 32, remainingQuantity: 16, shelfLifeDays: 17, isFreezable: false },
  { name: 'Yogurt', category: 'dairy', unitOfMeasure: 'oz', originalQuantity: 32, remainingQuantity: 32, shelfLifeDays: 21, isFreezable: false },
  { name: 'Shredded Mozzarella Cheese', category: 'dairy', unitOfMeasure: '6oz bag', originalQuantity: 1, remainingQuantity: 1, shelfLifeDays: 28, isFreezable: true },
  { name: 'Guacamole', category: 'condiments', unitOfMeasure: 'container', originalQuantity: 2, remainingQuantity: 2, shelfLifeDays: 7, isFreezable: false },
];

interface BackupEvent {
  itemName: string;
  category: ItemCategory;
  unitOfMeasure: string;
  quantity: number;
  // Present only on the five events written after originalQuantity existed.
  // The rest are backfilled from quantity, matching migratePantryStore.
  originalQuantity?: number;
  disposition: 'used' | 'wasted';
  date: string;
}

// All 64 events, verbatim from the 2026-11-01 export.
export const BACKUP_EVENTS: BackupEvent[] = [
  { itemName: 'Eggs', category: 'protein', unitOfMeasure: 'eggs', quantity: 4, disposition: 'used', date: '2026-10-05T13:42:12.117Z' },
  { itemName: 'Kiwis', category: 'produce', unitOfMeasure: 'kiwis', quantity: 1, disposition: 'used', date: '2026-10-06T16:50:22.171Z' },
  { itemName: 'Eggs', category: 'protein', unitOfMeasure: 'eggs', quantity: 2, disposition: 'used', date: '2026-10-07T12:36:48.814Z' },
  { itemName: 'Kiwis', category: 'produce', unitOfMeasure: 'kiwis', quantity: 1, disposition: 'used', date: '2026-10-08T00:13:44.551Z' },
  { itemName: 'Kiwis', category: 'produce', unitOfMeasure: 'kiwis', quantity: 1, disposition: 'used', date: '2026-10-09T02:14:56.322Z' },
  { itemName: 'Toufayan', category: 'grains', unitOfMeasure: 'units', quantity: 1, disposition: 'used', date: '2026-10-10T21:03:40.530Z' },
  { itemName: 'Blackberries', category: 'produce', unitOfMeasure: 'container', quantity: 1, disposition: 'used', date: '2026-10-11T13:49:52.533Z' },
  { itemName: 'Kiwis', category: 'produce', unitOfMeasure: 'kiwis', quantity: 1, disposition: 'used', date: '2026-10-13T00:16:43.206Z' },
  { itemName: 'Apples', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-13T00:21:17.751Z' },
  { itemName: 'Toufayan', category: 'grains', unitOfMeasure: 'units', quantity: 1, disposition: 'used', date: '2026-10-13T00:24:29.628Z' },
  { itemName: 'Yasso Yogurt Bars', category: 'frozen', unitOfMeasure: 'box', quantity: 1, disposition: 'used', date: '2026-10-13T00:24:55.815Z' },
  { itemName: 'Eggs', category: 'protein', unitOfMeasure: 'eggs', quantity: 2, disposition: 'used', date: '2026-10-13T00:25:26.026Z' },
  { itemName: 'Kiwis', category: 'produce', unitOfMeasure: 'kiwis', quantity: 2, disposition: 'used', date: '2026-10-14T02:14:03.100Z' },
  { itemName: 'Zucchini', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-14T02:14:24.092Z' },
  { itemName: 'Blueberries', category: 'produce', unitOfMeasure: 'container', quantity: 1, disposition: 'used', date: '2026-10-14T02:14:40.514Z' },
  { itemName: 'Apples', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-14T02:14:55.211Z' },
  { itemName: 'Cauliflower', category: 'produce', unitOfMeasure: 'head', quantity: 1, disposition: 'used', date: '2026-10-16T10:28:37.833Z' },
  { itemName: 'Apples', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-16T10:28:45.159Z' },
  { itemName: 'Butternut Squash', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-16T10:28:57.048Z' },
  { itemName: 'Acorn Squash', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-16T10:29:00.224Z' },
  { itemName: 'Eggs', category: 'protein', unitOfMeasure: 'eggs', quantity: 4, disposition: 'used', date: '2026-10-17T12:33:09.990Z' },
  { itemName: 'Zucchini', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-17T12:33:30.605Z' },
  { itemName: 'Zucchini', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-17T12:33:35.630Z' },
  { itemName: 'Toufayan', category: 'grains', unitOfMeasure: 'units', quantity: 2, disposition: 'used', date: '2026-10-17T12:34:18.915Z' },
  { itemName: 'Kiwis', category: 'produce', unitOfMeasure: 'kiwis', quantity: 1, disposition: 'used', date: '2026-10-18T02:40:14.108Z' },
  { itemName: 'Blackberries', category: 'produce', unitOfMeasure: 'container', quantity: 1, disposition: 'used', date: '2026-10-18T02:40:19.137Z' },
  { itemName: 'Apples', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-18T02:40:40.075Z' },
  { itemName: 'Tangerine Juice', category: 'beverages', unitOfMeasure: 'oz', quantity: 32, disposition: 'used', date: '2026-10-18T02:41:37.265Z' },
  { itemName: 'Apples', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-20T01:18:36.411Z' },
  { itemName: 'Blueberries', category: 'produce', unitOfMeasure: 'container', quantity: 1, disposition: 'used', date: '2026-10-22T00:59:56.959Z' },
  { itemName: 'Eggplant', category: 'produce', unitOfMeasure: 'each', quantity: 0.5, disposition: 'used', date: '2026-10-22T01:00:04.501Z' },
  { itemName: 'Cucumber', category: 'produce', unitOfMeasure: 'each', quantity: 0.5, disposition: 'used', date: '2026-10-22T01:00:16.672Z' },
  { itemName: 'Kiwis', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-22T01:03:14.254Z' },
  { itemName: 'Apples', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-22T01:05:26.803Z' },
  { itemName: 'Toufayan', category: 'grains', unitOfMeasure: 'units', quantity: 3, disposition: 'used', date: '2026-10-22T01:06:08.565Z' },
  { itemName: 'Bananas', category: 'produce', unitOfMeasure: 'each', quantity: 2, disposition: 'used', date: '2026-10-22T01:08:17.545Z' },
  { itemName: 'Eggplant', category: 'produce', unitOfMeasure: 'each', quantity: 0.5, disposition: 'used', date: '2026-10-25T12:40:49.996Z' },
  { itemName: 'Zucchini', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-25T12:40:53.588Z' },
  { itemName: 'Avocados', category: 'produce', unitOfMeasure: 'each', quantity: 3, disposition: 'used', date: '2026-10-25T12:41:07.181Z' },
  { itemName: 'Kiwis', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-25T12:41:49.891Z' },
  { itemName: 'Bananas', category: 'produce', unitOfMeasure: 'each', quantity: 5, disposition: 'used', date: '2026-10-25T12:41:55.033Z' },
  { itemName: 'Apples', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-25T12:42:38.935Z' },
  { itemName: 'Toufayan', category: 'grains', unitOfMeasure: 'units', quantity: 1, disposition: 'used', date: '2026-10-25T12:43:05.465Z' },
  { itemName: 'Tangerine Juice', category: 'beverages', unitOfMeasure: 'oz', quantity: 32, disposition: 'used', date: '2026-10-25T12:43:19.864Z' },
  { itemName: 'Unsweetened Vanilla Almond Milk', category: 'beverages', unitOfMeasure: 'oz', quantity: 16, disposition: 'used', date: '2026-10-25T12:43:55.959Z' },
  { itemName: 'Cucumber', category: 'produce', unitOfMeasure: 'each', quantity: 0.16666666666666666, disposition: 'used', date: '2026-10-25T12:44:42.022Z' },
  { itemName: 'Milk', category: 'dairy', unitOfMeasure: 'half gallon', quantity: 1, disposition: 'used', date: '2026-10-29T18:43:40.738Z' },
  { itemName: 'Penne', category: 'grains', unitOfMeasure: '16oz bag', quantity: 1, disposition: 'used', date: '2026-10-29T18:43:49.764Z' },
  { itemName: 'Peanut Butter', category: 'condiments', unitOfMeasure: 'jar(s)', quantity: 1, disposition: 'used', date: '2026-10-29T18:44:05.369Z' },
  { itemName: 'Avocados', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-29T18:44:55.937Z' },
  { itemName: 'Kiwis', category: 'produce', unitOfMeasure: 'each', quantity: 2, disposition: 'used', date: '2026-10-29T18:45:03.911Z' },
  { itemName: 'Tangerine Juice', category: 'beverages', unitOfMeasure: 'oz', quantity: 16, disposition: 'used', date: '2026-10-29T18:45:15.609Z' },
  { itemName: 'Triscuits (Family Size)', category: 'snacks', unitOfMeasure: 'box', quantity: 1, disposition: 'used', date: '2026-10-29T18:45:21.307Z' },
  { itemName: 'Walnuts', category: 'snacks', unitOfMeasure: '8oz bag', quantity: 0.5, disposition: 'used', date: '2026-10-29T18:45:25.704Z' },
  { itemName: 'Butternut Squash', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-29T18:47:02.903Z' },
  { itemName: 'Butternut Squash', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'wasted', date: '2026-10-29T18:47:14.791Z' },
  { itemName: 'Kiwis', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-30T00:50:29.706Z' },
  { itemName: 'Cucumber', category: 'produce', unitOfMeasure: 'each', quantity: 0.16666666666666669, disposition: 'used', date: '2026-10-30T19:45:17.368Z' },
  { itemName: 'Pears', category: 'produce', unitOfMeasure: 'each', quantity: 1, disposition: 'used', date: '2026-10-30T21:07:32.420Z' },
  { itemName: 'String Beans', category: 'produce', unitOfMeasure: '1lb bag', quantity: 1, originalQuantity: 1, disposition: 'used', date: '2026-11-01T12:24:14.459Z' },
  { itemName: 'Pears', category: 'produce', unitOfMeasure: 'each', quantity: 1, originalQuantity: 2, disposition: 'used', date: '2026-11-01T12:24:22.644Z' },
  { itemName: 'Tangerine Juice', category: 'beverages', unitOfMeasure: 'oz', quantity: 16, originalQuantity: 32, disposition: 'used', date: '2026-11-01T12:24:44.881Z' },
  { itemName: 'Blackberries', category: 'produce', unitOfMeasure: 'oz', quantity: 6, originalQuantity: 6, disposition: 'used', date: '2026-11-01T23:27:36.572Z' },
  { itemName: 'Tangerine Juice', category: 'beverages', unitOfMeasure: 'oz', quantity: 32, originalQuantity: 32, disposition: 'used', date: '2026-11-01T23:50:35.038Z' },
];

const slug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function buildRestoredItems(anchor: Date = RESTORE_ANCHOR): GroceryItem[] {
  return BACKUP_ITEMS.map((b) => {
    const location = storageForCategory(b.category);
    return {
      id: `restored-item-${slug(b.name)}`,
      name: b.name,
      category: b.category,
      storageLocation: location,
      storageHistory: [{ eventType: 'added' as const, location, date: anchor }],
      // Reconstructed, hence 'estimated' rather than a printed-date type.
      effectiveExpirationDate: new Date(anchor.getTime() + b.shelfLifeDays * DAY_MS),
      expirationDateType: 'estimated' as const,
      isFreezable: b.isFreezable,
      thawCycleCount: 0,
      unitOfMeasure: b.unitOfMeasure,
      originalQuantity: b.originalQuantity,
      remainingQuantity: b.remainingQuantity,
      purchaseDate: anchor,
      dateAdded: anchor,
      inputMethod: 'manual' as const,
    };
  });
}

export function buildRestoredEvents(): DispositionEvent[] {
  return BACKUP_EVENTS.map((b, i) => {
    const base = {
      id: `restored-evt-${String(i).padStart(3, '0')}`,
      // Keyed by name so repeat disposals of the same product share an id,
      // which is what the Food Score's cumulative-waste tracking wants.
      itemId: `restored-item-${slug(b.itemName)}`,
      itemName: b.itemName,
      category: b.category,
      quantity: b.quantity,
      originalQuantity: b.originalQuantity ?? b.quantity,
      unitOfMeasure: b.unitOfMeasure,
      date: new Date(b.date),
      // Not captured by the export; false is the neutral choice and this
      // field feeds no current calculation.
      expiredAtTime: false,
    };
    return b.disposition === 'wasted'
      // wasteMethod was not in the export; 'trash' was the default in force.
      ? { ...base, disposition: 'wasted' as const, wasteMethod: 'trash' as WasteMethod }
      : { ...base, disposition: 'used' as const };
  });
}
