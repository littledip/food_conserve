import {
  View,
  Text,
  Image,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useState, useEffect, useReducer, useRef } from 'react';
import { parseReceiptFromUri } from '../../services/receiptVisionApp';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, Camera } from 'expo-camera';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { COLORS } from '../../constants/theme';
import {
  ExpirationDateType,
  StorageLocation,
  ItemCategory,
  GroceryItem,
  ParsedReceipt,
} from '../../types/grocery';
import {
  useAddItem,
  useSetBarcodeCategoryOverride,
  getBarcodeCategoryOverride,
} from '../../stores/pantryStore';

type ScanMode = 'barcode' | 'photo' | 'receipt' | 'manual';

// Anthropic vision works best with the long edge <= 1568px and enforces a 10MB
// base64 hard cap. Raw camera captures are far larger on both axes, so we
// downscale the longer edge before sending. Re-encoding as JPEG also keeps the
// payload small regardless of the source format.
const VISION_LONG_EDGE_PX = 1568;

async function resizeForVision(uri: string, width: number, height: number): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  const longest = Math.max(width, height);
  if (longest > VISION_LONG_EDGE_PX) {
    // resize() preserves aspect ratio when only one dimension is given; constrain
    // whichever edge is longer (receipts shot in portrait are taller than wide).
    context.resize(width >= height ? { width: VISION_LONG_EDGE_PX } : { height: VISION_LONG_EDGE_PX });
  }
  const ref = await context.renderAsync();
  const result = await ref.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  return result.uri;
}

// Receipt-scan state machine (sibling to the barcode ScanFlow). 1.3 lands
// idle → captured → parsing → review/error; the review-list UI is 1.4 and
// bulk-add is 1.5, so for now `review` just shows a parsed summary.
type ReceiptFlow =
  | { status: 'idle' }
  | { status: 'captured'; uri: string }
  | { status: 'parsing'; uri: string }
  | { status: 'review'; receipt: ParsedReceipt }
  | { status: 'error'; uri: string; message: string };

type ReceiptAction =
  | { type: 'captured'; uri: string }
  | { type: 'parse_start' }
  | { type: 'parse_success'; receipt: ParsedReceipt }
  | { type: 'parse_error'; message: string }
  | { type: 'reset' };

function receiptReducer(state: ReceiptFlow, action: ReceiptAction): ReceiptFlow {
  switch (action.type) {
    case 'captured':
      return { status: 'captured', uri: action.uri };
    case 'parse_start':
      // Valid from captured or a prior error (retry) — both carry the image uri.
      return state.status === 'captured' || state.status === 'error'
        ? { status: 'parsing', uri: state.uri }
        : state;
    case 'parse_success':
      return { status: 'review', receipt: action.receipt };
    case 'parse_error':
      return state.status === 'parsing'
        ? { status: 'error', uri: state.uri, message: action.message }
        : state;
    case 'reset':
      return { status: 'idle' };
  }
}

// A single editable row in the receipt review list. Richer than ParsedReceiptItem:
// it carries the derived storage location and a concrete expiration Date the user
// can override before the haul lands in the pantry.
type ReviewItem = {
  id: string;
  name: string;
  category: ItemCategory;
  storageLocation: StorageLocation;
  expirationDate: Date;
  quantity: number;
  unitOfMeasure: string;
  unitCost: number | null;
  totalCost: number | null;
};

// Default storage by category (user overrides per row). Mirrors the spec:
// produce/protein/dairy → fridge, frozen → freezer, everything else → pantry.
function storageForCategory(category: ItemCategory): StorageLocation {
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

// Turn a parsed receipt into editable review rows, applying the per-item
// defaults: derived storage location and expiration = today + shelfLifeDays
// (expirationDateType becomes 'estimated' when these land in the pantry).
function buildReviewItems(receipt: ParsedReceipt): ReviewItem[] {
  const stamp = Date.now();
  return receipt.items.map((it, i) => {
    const exp = new Date();
    exp.setHours(0, 0, 0, 0);
    exp.setDate(exp.getDate() + it.shelfLifeDays);
    return {
      id: `${stamp}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      name: it.name,
      category: it.category,
      storageLocation: storageForCategory(it.category),
      expirationDate: exp,
      quantity: it.quantity,
      unitOfMeasure: it.unitOfMeasure,
      unitCost: it.unitCost,
      totalCost: it.totalCost,
    };
  });
}

type ScannedResult = {
  name: string;
  brand: string;
  category: string;
  barcode: string;
};

type ScanFlow =
  | { status: 'idle' }
  | { status: 'loading'; barcode: string }
  | { status: 'result'; item: ScannedResult }
  | { status: 'error'; message: string };

type ScanAction =
  | { type: 'lookup_start'; barcode: string }
  | { type: 'lookup_success'; item: ScannedResult }
  | { type: 'lookup_error'; message: string }
  | { type: 'reset' };

function scanReducer(_state: ScanFlow, action: ScanAction): ScanFlow {
  switch (action.type) {
    case 'lookup_start':
      return { status: 'loading', barcode: action.barcode };
    case 'lookup_success':
      return { status: 'result', item: action.item };
    case 'lookup_error':
      return { status: 'error', message: action.message };
    case 'reset':
      return { status: 'idle' };
  }
}

const SCAN_MODES: { key: ScanMode; label: string }[] = [
  { key: 'barcode', label: 'Barcode' },
  { key: 'photo', label: 'Photo' },
  { key: 'receipt', label: 'Receipt' },
  { key: 'manual', label: 'Manual' },
];

const EXP_TYPE_OPTIONS: { value: ExpirationDateType; label: string }[] = [
  { value: 'best_by', label: 'Best by' },
  { value: 'use_by', label: 'Use by' },
  { value: 'sell_by', label: 'Sell by' },
  { value: 'freeze_by', label: 'Freeze by' },
  { value: 'freeze_or_use_by', label: 'Freeze or use by' },
  { value: 'estimated', label: 'Estimated' },
];

const CATEGORY_OPTIONS: { value: ItemCategory; label: string }[] = [
  { value: 'produce', label: 'Produce' },
  { value: 'protein', label: 'Protein' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'grains', label: 'Grains' },
  { value: 'condiments', label: 'Condiments' },
  { value: 'beverages', label: 'Beverages' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'snacks', label: 'Snacks' },
  { value: 'other', label: 'Other' },
];

const LOCATION_OPTIONS: StorageLocation[] = ['fridge', 'freezer', 'pantry'];
const UNIT_OPTIONS = ['lbs', 'oz', 'kg', 'units', 'ml', 'cups'];

function Corner({ style }: { style: object }) {
  return <View style={[styles.corner, style]} />;
}

function PickerField({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity style={styles.fieldSelect} activeOpacity={0.7} onPress={onPress}>
        <Text style={styles.fieldSelectText}>{value}</Text>
        <Text style={styles.fieldSelectChevron}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

type ReviewField = 'category' | 'location' | 'date' | 'unit';

// One editable row in the receipt review list. Name and quantity are
// uncontrolled (commit on blur via onEndEditing) so typing never re-renders the
// whole list; the chips open the shared picker modals targeting this row's id.
function ReviewRow({
  item,
  onRename,
  onChangeQty,
  onEdit,
  onRemove,
}: {
  item: ReviewItem;
  onRename: (id: string, name: string) => void;
  onChangeQty: (id: string, raw: string) => void;
  onEdit: (id: string, field: ReviewField) => void;
  onRemove: (id: string) => void;
}) {
  const catLabel = CATEGORY_OPTIONS.find((o) => o.value === item.category)?.label ?? 'Other';
  const locLabel = item.storageLocation.charAt(0).toUpperCase() + item.storageLocation.slice(1);
  const dateLabel = item.expirationDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const priceLabel =
    item.totalCost != null ? `$${item.totalCost.toFixed(2)}`
    : item.unitCost != null ? `$${item.unitCost.toFixed(2)}`
    : '—';

  return (
    <View style={styles.reviewRow}>
      <View style={styles.reviewRowTop}>
        <TextInput
          style={styles.reviewNameInput}
          defaultValue={item.name}
          onEndEditing={(e) => onRename(item.id, e.nativeEvent.text)}
          placeholder="Item name"
          placeholderTextColor={COLORS.textSecondary}
        />
        <TouchableOpacity
          style={styles.reviewRemove}
          onPress={() => onRemove(item.id)}
          hitSlop={8}
          activeOpacity={0.6}
          accessibilityLabel={`Remove ${item.name}`}
        >
          <Text style={styles.reviewRemoveText}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.reviewChipRow}>
        <TouchableOpacity style={styles.reviewChip} onPress={() => onEdit(item.id, 'category')} activeOpacity={0.7}>
          <Text style={styles.reviewChipText}>{catLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.reviewChip} onPress={() => onEdit(item.id, 'location')} activeOpacity={0.7}>
          <Text style={styles.reviewChipText}>{locLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.reviewChip} onPress={() => onEdit(item.id, 'date')} activeOpacity={0.7}>
          <Text style={styles.reviewChipText}>{dateLabel}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.reviewChipRow}>
        <TextInput
          style={styles.reviewQtyInput}
          defaultValue={String(item.quantity)}
          keyboardType="decimal-pad"
          onEndEditing={(e) => onChangeQty(item.id, e.nativeEvent.text)}
        />
        <TouchableOpacity style={styles.reviewChip} onPress={() => onEdit(item.id, 'unit')} activeOpacity={0.7}>
          <Text style={styles.reviewChipText}>{item.unitOfMeasure}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <Text style={styles.reviewPrice}>{priceLabel}</Text>
      </View>
    </View>
  );
}

function buildItem(args: {
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
    purchaseDate: now,
    dateAdded: now,
    store: args.store || undefined,
    inputMethod: args.inputMethod,
  };
}

const sanitize = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t || t.toLowerCase() === 'undefined' || t.toLowerCase() === 'null') return undefined;
  return t;
};

const OFF_CATEGORY_KEYWORDS: Array<[ItemCategory, RegExp]> = [
  ['frozen',     /\bfrozen\b/],
  ['dairy',      /\b(dairies|dairy|milks?|cheeses?|yogh?urts?|butter|creams?|kefir)\b/],
  ['protein',    /\b(meats?|poultry|chicken|beef|pork|lamb|turkey|fish|fishes|seafood|salmon|tuna|shrimps?|sausages?|bacon|hams?|eggs?|tofu|tempeh|legumes?|beans?|lentils?|chickpeas?)\b/],
  ['produce',    /\b(fruits?|vegetables?|salads?|herbs?|berries|citrus|leafy)\b/],
  ['grains',     /\b(cereals?|breads?|pastas?|rices?|flours?|grains?|noodles?|oats?|wheat|barley|quinoa|tortillas?|pitas?|crackers?)\b/],
  ['beverages',  /\b(beverages?|waters?|juices?|sodas?|coffees?|teas?|drinks?|smoothies?|wines?|beers?|spirits?|cocktails?)\b/],
  ['snacks',     /\b(snacks?|biscuits?|cookies?|chocolates?|candies|candy|sweets?|chips?|crisps?|nuts?|popcorn)\b/],
  ['condiments', /\b(condiments?|sauces?|dressings?|spreads?|salt|vinegars?|oils?|spices?|seasonings?|honey|jams?|jellies|jelly|syrups?|mustard|ketchup|mayonnaise|mayo)\b/],
];

// Generic OFF parents that would otherwise misfire keyword matches (e.g. the
// "beverages" suffix in "plant-based-foods-and-beverages").
const OFF_SKIP_TAGS = new Set([
  'plant-based-foods-and-beverages',
  'plant-based-foods',
  'foods',
  'fresh-foods',
  'beverages-and-meals',
]);

function mapOffCategory(tags: unknown): ItemCategory {
  if (!Array.isArray(tags)) return 'other';
  // OFF orders categories_tags general → specific; reverse so the most specific tag wins.
  const normalized = tags
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.replace(/^en:/, '').toLowerCase())
    .reverse();
  for (const tag of normalized) {
    if (OFF_SKIP_TAGS.has(tag)) continue;
    for (const [cat, re] of OFF_CATEGORY_KEYWORDS) {
      if (re.test(tag)) return cat;
    }
  }
  return 'other';
}

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const addItem = useAddItem();
  const setBarcodeCategoryOverride = useSetBarcodeCategoryOverride();
  const isFocused = useIsFocused();

  const [scanMode, setScanMode] = useState<ScanMode>('barcode');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [flow, dispatch] = useReducer(scanReducer, { status: 'idle' });
  const isScanning = flow.status === 'idle';

  const cameraRef = useRef<CameraView>(null);
  const [receiptFlow, receiptDispatch] = useReducer(receiptReducer, { status: 'idle' });
  // Seconds elapsed during a parse — a 40-item receipt takes ~45s, so show a
  // live counter rather than an opaque spinner.
  const [parseElapsed, setParseElapsed] = useState(0);

  // Editable review-list state, populated when a parse succeeds. The shared
  // picker modals below route their selection to `editingReviewId` when set.
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewStore, setReviewStore] = useState('');
  const [reviewPurchaseDate, setReviewPurchaseDate] = useState<string | null>(null);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const editingReviewItem = editingReviewId
    ? reviewItems.find((i) => i.id === editingReviewId) ?? null
    : null;

  // Shared form fields
  const [expirationDate, setExpirationDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [expirationType, setExpirationType] = useState<ExpirationDateType>('best_by');
  const [storageLocation, setStorageLocation] = useState<StorageLocation>('fridge');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('units');
  const [store, setStore] = useState('');

  const [showExpTypePicker, setShowExpTypePicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showUnitPicker, setShowUnitPicker] = useState(false);

  const [itemName, setItemName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory>('other');

  // The shared picker modals highlight the active option from the review row
  // being edited when there is one, otherwise from the shared form state.
  const activeCategory = editingReviewItem ? editingReviewItem.category : selectedCategory;
  const activeLocation = editingReviewItem ? editingReviewItem.storageLocation : storageLocation;
  const activeUnit = editingReviewItem ? editingReviewItem.unitOfMeasure : unit;

  const expirationLabel = EXP_TYPE_OPTIONS.find((o) => o.value === expirationType)?.label ?? 'Best by';
  const locationLabel = storageLocation.charAt(0).toUpperCase() + storageLocation.slice(1);
  const categoryLabel = CATEGORY_OPTIONS.find((o) => o.value === selectedCategory)?.label ?? 'Other';

  useEffect(() => {
    Camera.requestCameraPermissionsAsync().then(({ status }) => {
      setHasPermission(status === 'granted');
    });
  }, []);

  async function handleBarcodeScan({ data }: { data: string }) {
    dispatch({ type: 'lookup_start', barcode: data });
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${data}.json`);
      const json = await res.json();
      if (json.status === 1) {
        const p = json.product;
        const tags: unknown[] = Array.isArray(p.categories_tags) ? p.categories_tags : [];
        const mostSpecific = tags[tags.length - 1];
        const displayCategory = typeof mostSpecific === 'string'
          ? mostSpecific.replace(/^en:/, '').replace(/-/g, ' ')
          : undefined;
        // User-set overrides win over the OFF-derived mapping.
        const override = getBarcodeCategoryOverride(data);
        const finalCategory = override ?? mapOffCategory(tags);
        setSelectedCategory(finalCategory);
        dispatch({
          type: 'lookup_success',
          item: {
            name: sanitize(p.product_name) ?? 'Unknown item',
            brand: sanitize(p.brands) ?? '',
            category: sanitize(displayCategory) ?? 'other',
            barcode: data,
          },
        });
      } else {
        dispatch({ type: 'lookup_error', message: 'Item not found in database. Try manual entry.' });
      }
    } catch {
      dispatch({ type: 'lookup_error', message: 'Could not connect. Check your connection and try again.' });
    }
  }

  function resetScan() {
    dispatch({ type: 'reset' });
    setExpirationDate(null);
    setSelectedCategory('other');
  }

  // Tick a 1-second elapsed counter while a receipt parse is in flight.
  useEffect(() => {
    if (receiptFlow.status !== 'parsing') {
      setParseElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const id = setInterval(() => {
      setParseElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [receiptFlow.status]);

  function renameReviewItem(id: string, name: string) {
    const trimmed = name.trim();
    setReviewItems((prev) => prev.map((it) => (it.id === id ? { ...it, name: trimmed || it.name } : it)));
  }
  function setReviewItemQty(id: string, raw: string) {
    const qty = parseFloat(raw);
    const safe = Number.isFinite(qty) && qty > 0 ? qty : 1;
    setReviewItems((prev) => prev.map((it) => (it.id === id ? { ...it, quantity: safe } : it)));
  }
  function removeReviewItem(id: string) {
    setReviewItems((prev) => prev.filter((it) => it.id !== id));
  }
  // Open a shared picker modal targeting a specific review row.
  function openReviewPicker(id: string, field: ReviewField) {
    setEditingReviewId(id);
    if (field === 'category') setShowCategoryPicker(true);
    else if (field === 'location') setShowLocationPicker(true);
    else if (field === 'unit') setShowUnitPicker(true);
    else setShowDatePicker(true);
  }
  // Apply a picker selection to the row being edited, then clear the target.
  function applyReviewEdit(patch: Partial<ReviewItem>) {
    if (!editingReviewId) return;
    const id = editingReviewId;
    setReviewItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setEditingReviewId(null);
  }

  async function handleCapture() {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      if (!photo?.uri) {
        Alert.alert('Capture failed', 'No image was returned by the camera.');
        return;
      }
      // Resize while we still have the source dimensions; the preview and the
      // parse then both use the already-shrunk image.
      const resized = await resizeForVision(photo.uri, photo.width, photo.height);
      receiptDispatch({ type: 'captured', uri: resized });
    } catch (e) {
      console.error('[receipt] capture failed:', e);
      Alert.alert('Capture failed', e instanceof Error ? e.message : String(e));
    }
  }

  async function handleParseReceipt(uri: string) {
    receiptDispatch({ type: 'parse_start' });
    const startedAt = Date.now();
    try {
      const receipt = await parseReceiptFromUri(uri);
      console.log(`[receipt] parsed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      console.log(JSON.stringify(receipt, null, 2));
      // Seed the editable list before flipping to review, so the first review
      // render already has the rows/store (uncontrolled inputs latch on mount).
      setReviewItems(buildReviewItems(receipt));
      setReviewStore(receipt.store ?? '');
      setReviewPurchaseDate(receipt.purchaseDate ?? null);
      receiptDispatch({ type: 'parse_success', receipt });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[receipt] parse failed:', e);
      receiptDispatch({ type: 'parse_error', message: msg });
    }
  }

  function handleModeChange(mode: ScanMode) {
    setScanMode(mode);
    if (mode === 'barcode') resetScan();
    receiptDispatch({ type: 'reset' });
    setEditingReviewId(null);
  }

  function handleCancel() {
    setItemName('');
    setSelectedCategory('other');
    setExpirationDate(null);
    setStore('');
    setScanMode('barcode');
    resetScan();
    receiptDispatch({ type: 'reset' });
    setEditingReviewId(null);
  }

  // Camera area overlay (shared between CameraView and placeholder)
  const cameraOverlay = (
    <>
      <Text style={styles.cameraLabel}>
        {scanMode === 'manual'
          ? 'MANUAL ENTRY'
          : scanMode === 'receipt'
            ? 'FRAME THE RECEIPT'
            : 'POINT AT BARCODE'}
      </Text>
      {scanMode !== 'manual' && scanMode !== 'receipt' && (
        <View style={styles.scanFrame}>
          <Corner style={styles.cornerTL} />
          <Corner style={styles.cornerTR} />
          <Corner style={styles.cornerBL} />
          <Corner style={styles.cornerBR} />
          <View style={styles.scanLine} />
        </View>
      )}
      {scanMode !== 'manual' && scanMode !== 'receipt' && (
        <Text style={styles.scanHint}>Hold steady — scanning automatically</Text>
      )}
      {scanMode === 'receipt' && receiptFlow.status === 'idle' && (
        <>
          <Text style={styles.scanHint}>Fit the whole receipt in frame</Text>
          <TouchableOpacity
            style={styles.shutterButton}
            onPress={handleCapture}
            activeOpacity={0.7}
            accessibilityLabel="Capture receipt"
          >
            <View style={styles.shutterInner} />
          </TouchableOpacity>
        </>
      )}
    </>
  );

  // Sheet body
  let sheetBody: React.ReactNode;

  if (scanMode === 'receipt') {
    if (receiptFlow.status === 'idle') {
      sheetBody = (
        <View style={styles.centeredPrompt}>
          <Text style={styles.promptText}>
            Frame the whole receipt and tap the shutter above to capture.
          </Text>
        </View>
      );
    } else if (receiptFlow.status === 'captured') {
      sheetBody = (
        <>
          <Text style={styles.sheetTitle}>Use this photo?</Text>
          <Image source={{ uri: receiptFlow.uri }} style={styles.receiptPreview} resizeMode="contain" />
          <View style={styles.receiptButtonRow}>
            <TouchableOpacity
              style={[styles.btnSecondary, styles.receiptButton]}
              onPress={() => receiptDispatch({ type: 'reset' })}
              activeOpacity={0.7}
            >
              <Text style={styles.btnSecondaryText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, styles.receiptButton]}
              onPress={() => handleParseReceipt(receiptFlow.uri)}
              activeOpacity={0.7}
            >
              <Text style={styles.btnPrimaryText}>Use photo</Text>
            </TouchableOpacity>
          </View>
        </>
      );
    } else if (receiptFlow.status === 'parsing') {
      sheetBody = (
        <View style={styles.centeredPrompt}>
          <Image
            source={{ uri: receiptFlow.uri }}
            style={[styles.receiptPreview, { opacity: 0.25 }]}
            resizeMode="contain"
          />
          <ActivityIndicator color={COLORS.primaryGreen} size="small" style={{ marginTop: 16 }} />
          <Text style={[styles.promptText, { marginTop: 8 }]}>Reading your receipt… {parseElapsed}s</Text>
        </View>
      );
    } else if (receiptFlow.status === 'error') {
      sheetBody = (
        <View style={styles.centeredPrompt}>
          <Text style={styles.errorText}>{receiptFlow.message}</Text>
          <View style={styles.receiptButtonRow}>
            <TouchableOpacity
              style={[styles.btnSecondary, styles.receiptButton]}
              onPress={() => receiptDispatch({ type: 'reset' })}
              activeOpacity={0.7}
            >
              <Text style={styles.btnSecondaryText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, styles.receiptButton]}
              onPress={() => handleParseReceipt(receiptFlow.uri)}
              activeOpacity={0.7}
            >
              <Text style={styles.btnPrimaryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    } else {
      // review — editable list. Bulk-add to the pantry lands in 1.5; here the
      // rows are fully editable and edits persist in local state.
      const itemCount = reviewItems.length;
      sheetBody = (
        <>
          <View style={styles.reviewHeader}>
            <TextInput
              style={styles.reviewStoreInput}
              defaultValue={reviewStore}
              onEndEditing={(e) => setReviewStore(e.nativeEvent.text.trim())}
              placeholder="Store name"
              placeholderTextColor={COLORS.textSecondary}
            />
            <Text style={styles.reviewHeaderSub}>
              {reviewPurchaseDate ?? 'date not found'} · {itemCount} item{itemCount === 1 ? '' : 's'}
            </Text>
          </View>

          {reviewItems.map((it) => (
            <ReviewRow
              key={it.id}
              item={it}
              onRename={renameReviewItem}
              onChangeQty={setReviewItemQty}
              onEdit={openReviewPicker}
              onRemove={removeReviewItem}
            />
          ))}

          {itemCount === 0 && (
            <Text style={[styles.promptText, { marginTop: 24 }]}>
              No items left. Start over to scan another receipt.
            </Text>
          )}

          <TouchableOpacity
            style={[styles.btnSecondary, { marginTop: 16, alignSelf: 'center', paddingHorizontal: 24 }]}
            onPress={() => receiptDispatch({ type: 'reset' })}
            activeOpacity={0.7}
          >
            <Text style={styles.btnSecondaryText}>Start over</Text>
          </TouchableOpacity>
        </>
      );
    }
  } else if (scanMode === 'manual') {
    sheetBody = (
      <>
        <Text style={styles.sheetTitle}>Add item manually</Text>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={[styles.storeInput, { flex: 1, textAlign: 'left', marginLeft: 8 }]}
            value={itemName}
            onChangeText={setItemName}
            placeholder="Item name"
            placeholderTextColor={COLORS.textSecondary}
            autoFocus
          />
        </View>
        <PickerField label="Category" value={categoryLabel} onPress={() => setShowCategoryPicker(true)} />
        <PickerField label="Expiration type" value={expirationLabel} onPress={() => setShowExpTypePicker(true)} />
        <TouchableOpacity
          style={[styles.fieldRow, !expirationType && { opacity: 0.4 }]}
          onPress={expirationType ? () => setShowDatePicker(true) : undefined}
          activeOpacity={expirationType ? 0.7 : 1}
        >
          <Text style={styles.fieldLabel}>Expiration date</Text>
          <Text style={expirationDate ? styles.dateValue : styles.datePlaceholder}>
            {expirationDate
              ? expirationDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'Tap to set'}
          </Text>
        </TouchableOpacity>
        <PickerField label="Storage location" value={locationLabel} onPress={() => setShowLocationPicker(true)} />
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Quantity</Text>
          <View style={styles.qtyWrap}>
            <TextInput
              style={styles.qtyInput}
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
            />
            <TouchableOpacity style={styles.fieldSelect} activeOpacity={0.7} onPress={() => setShowUnitPicker(true)}>
              <Text style={styles.fieldSelectText}>{unit}</Text>
              <Text style={styles.fieldSelectChevron}>›</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.fieldRow, styles.fieldRowLast]}>
          <Text style={styles.fieldLabel}>Store</Text>
          <TextInput
            style={styles.storeInput}
            value={store}
            onChangeText={setStore}
            placeholder="Store name"
            placeholderTextColor={COLORS.textSecondary}
          />
        </View>
      </>
    );
  } else if (flow.status === 'idle') {
    sheetBody = (
      <View style={styles.centeredPrompt}>
        <Text style={styles.promptText}>Point your camera at a barcode</Text>
      </View>
    );
  } else if (flow.status === 'loading') {
    sheetBody = (
      <View style={styles.centeredPrompt}>
        <ActivityIndicator color={COLORS.primaryGreen} size="small" />
        <Text style={[styles.promptText, { marginTop: 8 }]}>Looking up item…</Text>
      </View>
    );
  } else if (flow.status === 'error') {
    sheetBody = (
      <View style={styles.centeredPrompt}>
        <Text style={styles.errorText}>{flow.message}</Text>
        <TouchableOpacity
          style={[styles.btnSecondary, { marginTop: 14, paddingHorizontal: 24, alignSelf: 'center' }]}
          onPress={resetScan}
          activeOpacity={0.7}
        >
          <Text style={styles.btnSecondaryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  } else {
    // result
    const scannedItem = flow.item;
    const sub = [
      scannedItem.brand,
      scannedItem.category,
      scannedItem.barcode ? `UPC ${scannedItem.barcode}` : null,
    ].filter(Boolean).join(' · ');

    sheetBody = (
      <>
        <Text style={styles.sheetTitle}>Item recognized</Text>
        <View style={styles.resultCard}>
          <View style={styles.resultHeader}>
            <View style={styles.resultIcon} />
            <View style={{ flex: 1 }}>
              <Text style={styles.resultName}>{scannedItem.name}</Text>
              <Text style={styles.resultSub} numberOfLines={1}>{sub}</Text>
            </View>
            <TouchableOpacity
              style={styles.resultCloseButton}
              onPress={resetScan}
              activeOpacity={0.6}
              accessibilityLabel="Clear scanned item"
              hitSlop={8}
            >
              <Text style={styles.resultCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          <PickerField label="Category" value={categoryLabel} onPress={() => setShowCategoryPicker(true)} />
          <PickerField label="Expiration type" value={expirationLabel} onPress={() => setShowExpTypePicker(true)} />
          <TouchableOpacity
            style={[styles.fieldRow, !expirationType && { opacity: 0.4 }]}
            onPress={expirationType ? () => setShowDatePicker(true) : undefined}
            activeOpacity={expirationType ? 0.7 : 1}
          >
            <Text style={styles.fieldLabel}>Expiration date</Text>
            <Text style={expirationDate ? styles.dateValue : styles.datePlaceholder}>
              {expirationDate
                ? expirationDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'Tap to set'}
            </Text>
          </TouchableOpacity>
          <PickerField label="Storage location" value={locationLabel} onPress={() => setShowLocationPicker(true)} />

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Quantity</Text>
            <View style={styles.qtyWrap}>
              <TextInput
                style={styles.qtyInput}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="decimal-pad"
              />
              <TouchableOpacity style={styles.fieldSelect} activeOpacity={0.7}>
                <Text style={styles.fieldSelectText}>{unit}</Text>
                <Text style={styles.fieldSelectChevron}>›</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.fieldRow, styles.fieldRowLast]}>
            <Text style={styles.fieldLabel}>Store</Text>
            <TextInput
              style={styles.storeInput}
              value={store}
              onChangeText={setStore}
              placeholder="Store name"
              placeholderTextColor={COLORS.textSecondary}
            />
          </View>
        </View>
      </>
    );
  }

  // Action footer
  let actionFooter: React.ReactNode = null;
  if (scanMode === 'manual') {
    actionFooter = (
      <View style={styles.actionFooter}>
        <TouchableOpacity style={styles.btnSecondary} onPress={handleCancel} activeOpacity={0.7}>
          <Text style={styles.btnSecondaryText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnPrimary, (!itemName.trim() || !expirationDate) && styles.btnPrimaryDisabled]}
          activeOpacity={0.7}
          onPress={() => {
            if (!itemName.trim() || !expirationDate) return;
            addItem(buildItem({
              name: itemName.trim(),
              category: selectedCategory,
              expirationDate,
              expirationType,
              storageLocation,
              quantity: parseFloat(quantity) || 1,
              unit,
              store,
              inputMethod: 'manual',
            }));
            handleCancel();
            router.push({ pathname: '/(tabs)/pantry', params: { expand: selectedCategory } });
          }}
        >
          <Text style={styles.btnPrimaryText}>Add to pantry</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (flow.status === 'result') {
    const scannedItem = flow.item;
    actionFooter = (
      <View style={styles.actionFooter}>
        <TouchableOpacity style={styles.btnSecondary} onPress={resetScan} activeOpacity={0.7}>
          <Text style={styles.btnSecondaryText}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnPrimary, !expirationDate && styles.btnPrimaryDisabled]}
          activeOpacity={0.7}
          onPress={() => {
            if (!expirationDate) return;
            const chosenCategory = selectedCategory;
            if (scannedItem.barcode) {
              setBarcodeCategoryOverride(scannedItem.barcode, chosenCategory);
            }
            addItem(buildItem({
              name: scannedItem.name,
              category: chosenCategory,
              barcode: scannedItem.barcode,
              expirationDate,
              expirationType,
              storageLocation,
              quantity: parseFloat(quantity) || 1,
              unit,
              store,
              inputMethod: 'barcode',
            }));
            resetScan();
            router.push({ pathname: '/(tabs)/pantry', params: { expand: chosenCategory } });
          }}
        >
          <Text style={styles.btnPrimaryText}>Add to pantry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Camera area — CameraView is mounted only when this tab is focused so the
          native camera session is acquired fresh on every navigation. Avoids the
          stale-session bug where returning to the tab leaves the scanner dead. */}
      {(scanMode === 'barcode' || scanMode === 'receipt') && hasPermission === true && isFocused ? (
        <CameraView
          ref={cameraRef}
          style={[styles.cameraArea, { paddingTop: insets.top }]}
          facing="back"
          barcodeScannerSettings={
            scanMode === 'barcode' ? { barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] } : undefined
          }
          onBarcodeScanned={scanMode === 'barcode' && isScanning ? handleBarcodeScan : undefined}
        >
          {cameraOverlay}
        </CameraView>
      ) : (
        <View style={[styles.cameraArea, { paddingTop: insets.top }]}>
          {hasPermission === false ? (
            <Text style={styles.permissionText}>
              Camera access required.{'\n'}Enable in iOS Settings.
            </Text>
          ) : (
            cameraOverlay
          )}
        </View>
      )}

      {/* Mode bar */}
      <View style={styles.modeBar}>
        {SCAN_MODES.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[styles.modeChip, scanMode === key && styles.modeChipActive]}
            onPress={() => handleModeChange(key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.modeChipText, scanMode === key && styles.modeChipTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Bottom sheet */}
      <ScrollView
        style={styles.sheet}
        contentContainerStyle={styles.sheetContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.sheetHandle} />
        {sheetBody}
      </ScrollView>

      {actionFooter}

      <Modal
        visible={showExpTypePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowExpTypePicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowExpTypePicker(false)}
        />
        <View style={[styles.pickerPanel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.pickerPanelTitle}>Expiration type</Text>
          {EXP_TYPE_OPTIONS.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              style={[
                styles.pickerOption,
                expirationType === value && styles.pickerOptionActive,
              ]}
              activeOpacity={0.7}
              onPress={() => {
                setExpirationType(value);
                setShowExpTypePicker(false);
              }}
            >
              <Text style={[
                styles.pickerOptionText,
                expirationType === value && styles.pickerOptionTextActive,
              ]}>
                {label}
              </Text>
              {expirationType === value && (
                <Text style={styles.pickerOptionCheck}>✓</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      <Modal
        visible={showUnitPicker}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowUnitPicker(false); setEditingReviewId(null); }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => { setShowUnitPicker(false); setEditingReviewId(null); }}
        />
        <View style={[styles.pickerPanel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.pickerPanelTitle}>Unit of measure</Text>
          {UNIT_OPTIONS.map((u) => (
            <TouchableOpacity
              key={u}
              style={[styles.pickerOption, activeUnit === u && styles.pickerOptionActive]}
              activeOpacity={0.7}
              onPress={() => {
                if (editingReviewId) applyReviewEdit({ unitOfMeasure: u });
                else setUnit(u);
                setShowUnitPicker(false);
              }}
            >
              <Text style={[styles.pickerOptionText, activeUnit === u && styles.pickerOptionTextActive]}>{u}</Text>
              {activeUnit === u && <Text style={styles.pickerOptionCheck}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      <Modal
        visible={showCategoryPicker}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowCategoryPicker(false); setEditingReviewId(null); }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => { setShowCategoryPicker(false); setEditingReviewId(null); }}
        />
        <View style={[styles.pickerPanel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.pickerPanelTitle}>Category</Text>
          {CATEGORY_OPTIONS.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              style={[styles.pickerOption, activeCategory === value && styles.pickerOptionActive]}
              activeOpacity={0.7}
              onPress={() => {
                if (editingReviewId) applyReviewEdit({ category: value });
                else setSelectedCategory(value);
                setShowCategoryPicker(false);
              }}
            >
              <Text style={[styles.pickerOptionText, activeCategory === value && styles.pickerOptionTextActive]}>
                {label}
              </Text>
              {activeCategory === value && <Text style={styles.pickerOptionCheck}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      <Modal
        visible={showLocationPicker}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowLocationPicker(false); setEditingReviewId(null); }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => { setShowLocationPicker(false); setEditingReviewId(null); }}
        />
        <View style={[styles.pickerPanel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.pickerPanelTitle}>Storage location</Text>
          {LOCATION_OPTIONS.map((loc) => {
            const label = loc.charAt(0).toUpperCase() + loc.slice(1);
            return (
              <TouchableOpacity
                key={loc}
                style={[styles.pickerOption, activeLocation === loc && styles.pickerOptionActive]}
                activeOpacity={0.7}
                onPress={() => {
                  if (editingReviewId) applyReviewEdit({ storageLocation: loc });
                  else setStorageLocation(loc);
                  setShowLocationPicker(false);
                }}
              >
                <Text style={[styles.pickerOptionText, activeLocation === loc && styles.pickerOptionTextActive]}>
                  {label}
                </Text>
                {activeLocation === loc && <Text style={styles.pickerOptionCheck}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>

      {showDatePicker && (
        <DateTimePicker
          value={editingReviewItem?.expirationDate ?? expirationDate ?? new Date()}
          mode="date"
          display="spinner"
          minimumDate={new Date()}
          onChange={(_, date) => {
            setShowDatePicker(false);
            if (date) {
              if (editingReviewId) applyReviewEdit({ expirationDate: date });
              else setExpirationDate(date);
            } else {
              setEditingReviewId(null);
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1A1A1A',
  },
  // Camera
  cameraArea: {
    backgroundColor: '#2A2A2A',
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  permissionText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  scanFrame: {
    width: 160,
    height: 160,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#EAF3DE',
    borderWidth: 3,
  },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  scanLine: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 1.5,
    backgroundColor: '#97C459',
    top: '50%',
    opacity: 0.8,
  },
  scanHint: {
    marginTop: 14,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
  },
  // Mode bar
  modeBar: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 16,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  modeChip: {
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 16,
  },
  modeChipActive: {
    backgroundColor: COLORS.primaryGreen,
    borderColor: COLORS.primaryGreen,
  },
  modeChipText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  modeChipTextActive: {
    color: '#EAF3DE',
  },
  // Bottom sheet
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    flex: 1,
  },
  sheetContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: COLORS.borderColor,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.darkGreen,
    marginBottom: 12,
  },
  // Idle / loading / error states
  centeredPrompt: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  promptText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 13,
    color: COLORS.redText,
    textAlign: 'center',
    lineHeight: 20,
  },
  // Result card
  resultCard: {
    backgroundColor: COLORS.cardWhite,
    borderWidth: 0.5,
    borderColor: COLORS.itemBorderUrgent,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.statCardBg,
  },
  resultIcon: {
    width: 36,
    height: 36,
    backgroundColor: COLORS.statCardBg,
    borderRadius: 8,
    flexShrink: 0,
  },
  resultName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.darkGreen,
  },
  resultCloseButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  resultCloseText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
    lineHeight: 14,
  },
  shutterButton: {
    marginTop: 4,
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#EAF3DE',
  },
  receiptPreview: {
    width: '100%',
    height: 280,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginTop: 12,
  },
  receiptButtonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  receiptButton: {
    flex: 1,
  },
  // Receipt review list
  reviewHeader: {
    marginBottom: 4,
  },
  reviewStoreInput: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGreen,
    paddingVertical: 4,
  },
  reviewHeaderSub: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  reviewRow: {
    backgroundColor: COLORS.cardWhite,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    padding: 10,
    marginTop: 10,
    gap: 8,
  },
  reviewRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reviewNameInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.darkGreen,
    paddingVertical: 2,
  },
  reviewRemove: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  reviewRemoveText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
    lineHeight: 14,
  },
  reviewChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reviewChip: {
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: COLORS.background,
  },
  reviewChipText: {
    fontSize: 12,
    color: COLORS.darkGreen,
  },
  reviewQtyInput: {
    minWidth: 44,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontSize: 12,
    color: COLORS.darkGreen,
    textAlign: 'center',
    backgroundColor: COLORS.background,
  },
  reviewPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.darkGreen,
  },
  resultSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  confRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.statCardBg,
  },
  confLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    flexShrink: 0,
  },
  confBarBg: {
    flex: 1,
    height: 4,
    backgroundColor: COLORS.borderColor,
    borderRadius: 2,
  },
  confBarFill: {
    height: 4,
    backgroundColor: COLORS.midGreen,
    borderRadius: 2,
  },
  confPct: {
    fontSize: 11,
    color: COLORS.primaryGreen,
    fontWeight: '500',
    flexShrink: 0,
  },
  // Field rows
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.subtleBorder,
    gap: 8,
  },
  fieldRowStacked: {
    alignItems: 'flex-start',
  },
  fieldRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  fieldLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    flexShrink: 0,
  },
  fieldRightStacked: {
    alignItems: 'flex-end',
    gap: 2,
  },
  fieldSelect: {
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  fieldSelectText: {
    fontSize: 12,
    color: COLORS.darkGreen,
  },
  fieldSelectChevron: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  qtyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  qtyInput: {
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontSize: 12,
    color: COLORS.darkGreen,
    width: 44,
    textAlign: 'right',
  },
  storeInput: {
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontSize: 12,
    color: COLORS.darkGreen,
    width: 110,
    textAlign: 'right',
  },
  // Action footer
  actionFooter: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.background,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.borderColor,
  },
  btnSecondary: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 10,
    padding: 10,
    backgroundColor: COLORS.cardWhite,
    alignItems: 'center',
  },
  btnSecondaryText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  btnPrimary: {
    flex: 2,
    backgroundColor: COLORS.primaryGreen,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  btnPrimaryDisabled: {
    backgroundColor: COLORS.borderColor,
  },
  btnPrimaryText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#EAF3DE',
  },
  dateValue: {
    fontSize: 12,
    color: COLORS.darkGreen,
    fontWeight: '500',
  },
  datePlaceholder: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  // Expiration type picker modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  pickerPanel: {
    backgroundColor: COLORS.cardWhite,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 16,
  },
  pickerPanelTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.subtleBorder,
  },
  pickerOptionActive: {
    // no background change, just text + check
  },
  pickerOptionText: {
    fontSize: 14,
    color: COLORS.darkGreen,
  },
  pickerOptionTextActive: {
    color: COLORS.primaryGreen,
    fontWeight: '500',
  },
  pickerOptionCheck: {
    fontSize: 14,
    color: COLORS.primaryGreen,
    fontWeight: '500',
  },
});
