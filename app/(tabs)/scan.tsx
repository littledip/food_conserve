import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useState, useEffect, useReducer } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, Camera } from 'expo-camera';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { COLORS } from '../../constants/theme';
import {
  ExpirationDateType,
  StorageLocation,
  ItemCategory,
  GroceryItem,
} from '../../types/grocery';
import { useAddItem } from '../../stores/pantryStore';

type ScanMode = 'barcode' | 'photo' | 'manual';

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

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const addItem = useAddItem();

  const [scanMode, setScanMode] = useState<ScanMode>('barcode');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [flow, dispatch] = useReducer(scanReducer, { status: 'idle' });
  const isScanning = flow.status === 'idle';

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
        const rawCategory = p.categories_tags?.[0];
        const cleanedCategory = typeof rawCategory === 'string' ? rawCategory.replace(/^en:/, '') : undefined;
        dispatch({
          type: 'lookup_success',
          item: {
            name: sanitize(p.product_name) ?? 'Unknown item',
            brand: sanitize(p.brands) ?? '',
            category: sanitize(cleanedCategory) ?? 'other',
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

  function handleModeChange(mode: ScanMode) {
    setScanMode(mode);
    if (mode === 'barcode') resetScan();
  }

  function handleCancel() {
    setItemName('');
    setSelectedCategory('other');
    setExpirationDate(null);
    setStore('');
    setScanMode('barcode');
    resetScan();
  }

  // Camera area overlay (shared between CameraView and placeholder)
  const cameraOverlay = (
    <>
      <Text style={styles.cameraLabel}>
        {scanMode === 'manual' ? 'MANUAL ENTRY' : 'POINT AT BARCODE'}
      </Text>
      {scanMode !== 'manual' && (
        <View style={styles.scanFrame}>
          <Corner style={styles.cornerTL} />
          <Corner style={styles.cornerTR} />
          <Corner style={styles.cornerBL} />
          <Corner style={styles.cornerBR} />
          <View style={styles.scanLine} />
        </View>
      )}
      {scanMode !== 'manual' && (
        <Text style={styles.scanHint}>Hold steady — scanning automatically</Text>
      )}
    </>
  );

  // Sheet body
  let sheetBody: React.ReactNode;

  if (scanMode === 'manual') {
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
          </View>

          {selectedCategory === 'other' && (
            <PickerField label="Category" value={categoryLabel} onPress={() => setShowCategoryPicker(true)} />
          )}
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
          <Text style={styles.btnSecondaryText}>Scan another</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnPrimary, !expirationDate && styles.btnPrimaryDisabled]}
          activeOpacity={0.7}
          onPress={() => {
            if (!expirationDate) return;
            const chosenCategory = selectedCategory;
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
      {/* Camera area */}
      {scanMode === 'barcode' && hasPermission === true ? (
        <CameraView
          style={[styles.cameraArea, { paddingTop: insets.top }]}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
          onBarcodeScanned={isScanning ? handleBarcodeScan : undefined}
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
        onRequestClose={() => setShowUnitPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowUnitPicker(false)}
        />
        <View style={[styles.pickerPanel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.pickerPanelTitle}>Unit of measure</Text>
          {UNIT_OPTIONS.map((u) => (
            <TouchableOpacity
              key={u}
              style={[styles.pickerOption, unit === u && styles.pickerOptionActive]}
              activeOpacity={0.7}
              onPress={() => {
                setUnit(u);
                setShowUnitPicker(false);
              }}
            >
              <Text style={[styles.pickerOptionText, unit === u && styles.pickerOptionTextActive]}>{u}</Text>
              {unit === u && <Text style={styles.pickerOptionCheck}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      <Modal
        visible={showCategoryPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCategoryPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowCategoryPicker(false)}
        />
        <View style={[styles.pickerPanel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.pickerPanelTitle}>Category</Text>
          {CATEGORY_OPTIONS.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              style={[styles.pickerOption, selectedCategory === value && styles.pickerOptionActive]}
              activeOpacity={0.7}
              onPress={() => {
                setSelectedCategory(value);
                setShowCategoryPicker(false);
              }}
            >
              <Text style={[styles.pickerOptionText, selectedCategory === value && styles.pickerOptionTextActive]}>
                {label}
              </Text>
              {selectedCategory === value && <Text style={styles.pickerOptionCheck}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      <Modal
        visible={showLocationPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLocationPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowLocationPicker(false)}
        />
        <View style={[styles.pickerPanel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.pickerPanelTitle}>Storage location</Text>
          {LOCATION_OPTIONS.map((loc) => {
            const label = loc.charAt(0).toUpperCase() + loc.slice(1);
            return (
              <TouchableOpacity
                key={loc}
                style={[styles.pickerOption, storageLocation === loc && styles.pickerOptionActive]}
                activeOpacity={0.7}
                onPress={() => {
                  setStorageLocation(loc);
                  setShowLocationPicker(false);
                }}
              >
                <Text style={[styles.pickerOptionText, storageLocation === loc && styles.pickerOptionTextActive]}>
                  {label}
                </Text>
                {storageLocation === loc && <Text style={styles.pickerOptionCheck}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>

      {showDatePicker && (
        <DateTimePicker
          value={expirationDate ?? new Date()}
          mode="date"
          display="spinner"
          minimumDate={new Date()}
          onChange={(_, date) => {
            setShowDatePicker(false);
            if (date) setExpirationDate(date);
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
