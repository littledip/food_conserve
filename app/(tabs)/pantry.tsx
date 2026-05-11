import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from 'react-native';
import { useState, useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';
import { GroceryItem, ItemCategory, GroupedPantryItems } from '../../types/grocery';
import {
  useAllItems,
  useUpdateItem,
  useConsumeItem,
  useDisposeItem,
  useMoveItem,
  fractionalUseAmount,
} from '../../stores/pantryStore';

const CATEGORY_ORDER: ItemCategory[] = [
  'protein', 'produce', 'dairy', 'grains',
  'condiments', 'beverages', 'frozen', 'snacks', 'other',
];

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  protein: 'Protein',
  produce: 'Produce',
  dairy: 'Dairy',
  grains: 'Grains',
  condiments: 'Condiments',
  beverages: 'Beverages',
  frozen: 'Frozen',
  snacks: 'Snacks',
  other: 'Other',
};

const daysUntil = (d: Date) =>
  Math.ceil((d.getTime() - Date.now()) / 86400000);

const formatDays = (d: Date): string => {
  const n = daysUntil(d);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return `${n} days`;
};

function groupAndFilterItems(items: GroceryItem[], query: string): GroupedPantryItems[] {
  const filtered = query
    ? items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
    : items;

  const map = new Map<ItemCategory, GroceryItem[]>();
  for (const item of filtered) {
    if (!map.has(item.category)) map.set(item.category, []);
    map.get(item.category)!.push(item);
  }

  const groups: GroupedPantryItems[] = [];
  for (const cat of CATEGORY_ORDER) {
    const catItems = map.get(cat);
    if (!catItems) continue;
    const sorted = [...catItems].sort(
      (a, b) => a.effectiveExpirationDate.getTime() - b.effectiveExpirationDate.getTime()
    );
    const urgentCount = sorted.filter((i) => daysUntil(i.effectiveExpirationDate) <= 1).length;
    groups.push({ category: cat, items: sorted, urgentCount });
  }
  return groups;
}

function dotColor(item: GroceryItem): string {
  const d = daysUntil(item.effectiveExpirationDate);
  if (d <= 0) return COLORS.redDot;
  if (d <= 2) return COLORS.orange;
  return COLORS.midGreen;
}

function ItemRow({ item, onPress }: { item: GroceryItem; onPress: () => void }) {
  const d = daysUntil(item.effectiveExpirationDate);
  const isUrgent = d <= 1;
  const label = formatDays(item.effectiveExpirationDate);

  return (
    <TouchableOpacity
      style={[
        styles.itemRow,
        isUrgent
          ? { backgroundColor: COLORS.itemBgUrgent, borderColor: COLORS.itemBorderUrgent }
          : { backgroundColor: COLORS.itemBgNormal, borderColor: COLORS.itemBorderOk },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.itemInner}>
        <View style={[styles.itemDot, { backgroundColor: dotColor(item) }]} />
        <Text style={styles.itemName}>{item.name}</Text>
        <Text
          style={[
            styles.itemDays,
            { color: isUrgent ? COLORS.redText : COLORS.primaryGreen },
          ]}
        >
          {label}
        </Text>
      </View>
      {isUrgent && item.isFreezable && (
        <View style={styles.freezeBadge}>
          <Text style={styles.freezeText}>Freezable — save it today</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function CategoryGroup({
  group,
  isExpanded,
  onToggle,
  onSelectItem,
}: {
  group: GroupedPantryItems;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectItem: (itemId: string) => void;
}) {
  const urgentItems = group.items.filter((i) => daysUntil(i.effectiveExpirationDate) <= 2);
  const freshItems = group.items.filter((i) => daysUntil(i.effectiveExpirationDate) > 2);

  return (
    <View style={styles.groupContainer}>
      {/* Category header */}
      <TouchableOpacity
        style={[styles.groupHeader, isExpanded && styles.groupHeaderOpen]}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <View style={styles.groupHeaderLeft}>
          <Text style={styles.groupName}>{CATEGORY_LABELS[group.category]}</Text>
          {group.urgentCount > 0 && (
            <View style={styles.urgentBadge}>
              <Text style={styles.urgentBadgeText}>{group.urgentCount} urgent</Text>
            </View>
          )}
        </View>
        <Text style={styles.groupCount}>
          {group.items.length} items {isExpanded ? '▲' : '▼'}
        </Text>
      </TouchableOpacity>

      {/* Collapsed preview */}
      {!isExpanded && (
        <View style={styles.previewRow}>
          {urgentItems.length > 0 && (
            <>
              <View style={[styles.previewDot, { backgroundColor: COLORS.orange }]} />
              <Text style={styles.previewText}>
                {urgentItems.map((i) => i.name).join(', ')}
              </Text>
            </>
          )}
          {freshItems.length > 0 && (
            <>
              <View
                style={[
                  styles.previewDot,
                  { backgroundColor: COLORS.midGreen, marginLeft: urgentItems.length > 0 ? 4 : 0 },
                ]}
              />
              <Text style={styles.previewText}>
                {freshItems.map((i) => i.name).join(', ')}
              </Text>
            </>
          )}
        </View>
      )}

      {/* Expanded items */}
      {isExpanded && (
        <View style={styles.itemsContainer}>
          {group.items.map((item, idx) => (
            <View key={item.id} style={idx === group.items.length - 1 ? undefined : { marginBottom: 3 }}>
              <ItemRow item={item} onPress={() => onSelectItem(item.id)} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const VALID_CATEGORIES = new Set<ItemCategory>([
  'protein', 'produce', 'dairy', 'grains',
  'condiments', 'beverages', 'frozen', 'snacks', 'other',
]);

const RECATEGORIZE_OPTIONS: ItemCategory[] = [
  'protein', 'produce', 'dairy', 'grains',
  'condiments', 'beverages', 'frozen', 'snacks',
];

export default function PantryScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ expand?: string }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<ItemCategory | null>('protein');
  const [filterVisible, setFilterVisible] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState('');

  const items = useAllItems();
  const updateItem = useUpdateItem();
  const consumeItem = useConsumeItem();
  const disposeItem = useDisposeItem();
  const moveItem = useMoveItem();
  const groups = groupAndFilterItems(items, searchQuery);
  const selectedItem = selectedItemId ? items.find((i) => i.id === selectedItemId) ?? null : null;

  const closeSheet = () => {
    setSelectedItemId(null);
    setCustomAmount('');
  };

  const useAll = () => {
    if (selectedItemId) disposeItem(selectedItemId, 'used');
    closeSheet();
  };

  const useFraction = (denom: number) => {
    if (!selectedItem) return;
    consumeItem(selectedItem.id, fractionalUseAmount(selectedItem, denom));
    closeSheet();
  };

  const applyCustom = () => {
    if (!selectedItem) return;
    const parsed = parseFloat(customAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (parsed >= selectedItem.remainingQuantity) {
      disposeItem(selectedItem.id, 'used');
    } else {
      consumeItem(selectedItem.id, parsed);
    }
    closeSheet();
  };

  const wasteAll = () => {
    if (selectedItemId) disposeItem(selectedItemId, 'wasted');
    closeSheet();
  };

  const freeze = () => {
    if (selectedItemId) moveItem(selectedItemId, 'freezer');
    closeSheet();
  };

  useEffect(() => {
    if (params.expand && VALID_CATEGORIES.has(params.expand as ItemCategory)) {
      setExpandedCategory(params.expand as ItemCategory);
    }
  }, [params.expand]);

  const toggleCategory = (cat: ItemCategory) => {
    setExpandedCategory((prev) => (prev === cat ? null : cat));
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Text style={styles.title}>Pantry</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search items..."
            placeholderTextColor={COLORS.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity
            style={styles.filterButton}
            onPress={() => setFilterVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="options-outline" size={14} color={COLORS.textMuted} />
            <Text style={styles.filterText}>Filter</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Category list */}
      <ScrollView
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {groups.map((group) => (
          <CategoryGroup
            key={group.category}
            group={group}
            isExpanded={expandedCategory === group.category}
            onToggle={() => toggleCategory(group.category)}
            onSelectItem={setSelectedItemId}
          />
        ))}
      </ScrollView>

      {/* Filter panel */}
      <Modal
        visible={filterVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFilterVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setFilterVisible(false)}
        />
        <View style={[styles.filterPanel, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.filterTitle}>Filter</Text>

          <Text style={styles.filterSectionLabel}>Expiring window</Text>
          <View style={styles.chipRow}>
            {['All items', 'Today', 'This week', 'This month'].map((opt) => (
              <TouchableOpacity key={opt} style={styles.filterChip}>
                <Text style={styles.filterChipText}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.filterSectionLabel}>Storage location</Text>
          <View style={styles.chipRow}>
            {['All', 'Fridge', 'Freezer', 'Pantry'].map((opt) => (
              <TouchableOpacity key={opt} style={styles.filterChip}>
                <Text style={styles.filterChipText}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.filterSectionLabel}>Category</Text>
          <View style={styles.chipRow}>
            {['All', 'Produce', 'Protein', 'Dairy', 'Grains'].map((opt) => (
              <TouchableOpacity key={opt} style={styles.filterChip}>
                <Text style={styles.filterChipText}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={styles.applyButton}
            onPress={() => setFilterVisible(false)}
          >
            <Text style={styles.applyButtonText}>Show {items.length} items</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Item detail sheet */}
      <Modal
        visible={selectedItem !== null}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeSheet}
        />
        {selectedItem && (
          <View style={[styles.detailSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.detailHeader}>{selectedItem.name}</Text>
            <Text style={styles.detailMeta}>
              {selectedItem.remainingQuantity} of {selectedItem.originalQuantity} {selectedItem.unitOfMeasure} remaining
            </Text>

            <Text style={styles.detailSectionLabel}>Mark as used</Text>
            <View style={styles.presetRow}>
              <TouchableOpacity style={styles.presetButton} onPress={useAll} activeOpacity={0.7}>
                <Text style={styles.presetButtonText}>Used all</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.presetButton} onPress={() => useFraction(2)} activeOpacity={0.7}>
                <Text style={styles.presetButtonText}>Used half</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.presetButton} onPress={() => useFraction(3)} activeOpacity={0.7}>
                <Text style={styles.presetButtonText}>Used a third</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.customRow}>
              <TextInput
                style={styles.customInput}
                value={customAmount}
                onChangeText={setCustomAmount}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={COLORS.textSecondary}
              />
              <Text style={styles.customUnit}>{selectedItem.unitOfMeasure}</Text>
              <TouchableOpacity
                style={[styles.applyCustomButton, !customAmount && styles.applyCustomDisabled]}
                onPress={applyCustom}
                activeOpacity={0.7}
                disabled={!customAmount}
              >
                <Text style={styles.applyCustomText}>Apply</Text>
              </TouchableOpacity>
            </View>

            {selectedItem.isFreezable && selectedItem.storageLocation !== 'freezer' && (
              <TouchableOpacity
                style={styles.freezeButton}
                onPress={freeze}
                activeOpacity={0.7}
              >
                <Ionicons name="snow-outline" size={16} color={COLORS.freezeText} />
                <Text style={styles.freezeButtonText}>Move to freezer</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.wastedButton}
              onPress={wasteAll}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={16} color={COLORS.redDark} />
              <Text style={styles.wastedButtonText}>Threw it out</Text>
            </TouchableOpacity>

            {selectedItem.category === 'other' && (
              <>
                <Text style={styles.detailSectionLabel}>Move to category</Text>
                {RECATEGORIZE_OPTIONS.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={styles.pickerOption}
                    activeOpacity={0.7}
                    onPress={() => {
                      updateItem(selectedItem.id, { category: cat });
                      setExpandedCategory(cat);
                      closeSheet();
                    }}
                  >
                    <Text style={styles.pickerOptionText}>{CATEGORY_LABELS[cat]}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    backgroundColor: COLORS.primaryGreen,
    paddingHorizontal: 10,
    paddingBottom: 14,
  },
  title: {
    color: '#EAF3DE',
    fontSize: 20,
    fontWeight: '500',
    marginBottom: 6,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 4,
  },
  searchInput: {
    flex: 1,
    backgroundColor: COLORS.cardWhite,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 5,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 13,
    color: COLORS.darkGreen,
  },
  filterButton: {
    backgroundColor: COLORS.cardWhite,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 5,
    paddingVertical: 4,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  filterText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  listContent: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    paddingTop: 2,
  },
  groupContainer: {
    marginBottom: 6,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: COLORS.cardWhite,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  groupHeaderOpen: {
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.statCardBg,
  },
  groupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  groupName: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.darkGreen,
  },
  urgentBadge: {
    backgroundColor: COLORS.urgentBadgeBg,
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  urgentBadgeText: {
    color: COLORS.urgentText,
    fontSize: 10,
  },
  groupCount: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 8,
    paddingBottom: 5,
  },
  previewDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  previewText: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  itemsContainer: {
    padding: 4,
    paddingHorizontal: 6,
    paddingBottom: 5,
  },
  itemRow: {
    borderWidth: 0.5,
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  itemInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  itemName: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.darkGreen,
    flex: 1,
  },
  itemDays: {
    fontSize: 10,
    fontWeight: '500',
  },
  freezeBadge: {
    backgroundColor: COLORS.freezeBg,
    paddingVertical: 1,
    paddingHorizontal: 4,
    borderRadius: 3,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  freezeText: {
    color: COLORS.freezeText,
    fontSize: 10,
  },
  detailSheet: {
    backgroundColor: COLORS.cardWhite,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 16,
  },
  detailHeader: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.darkGreen,
  },
  detailMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
    marginBottom: 12,
  },
  detailSectionLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 6,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 6,
  },
  presetButton: {
    flex: 1,
    backgroundColor: COLORS.statCardBg,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  presetButtonText: {
    color: COLORS.primaryGreen,
    fontSize: 12,
    fontWeight: '500',
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  customInput: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13,
    color: COLORS.darkGreen,
  },
  customUnit: {
    fontSize: 12,
    color: COLORS.textSecondary,
    minWidth: 32,
  },
  applyCustomButton: {
    backgroundColor: COLORS.primaryGreen,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  applyCustomDisabled: {
    backgroundColor: COLORS.borderColor,
  },
  applyCustomText: {
    color: '#EAF3DE',
    fontSize: 12,
    fontWeight: '500',
  },
  freezeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.freezeBg,
    borderWidth: 0.5,
    borderColor: COLORS.freezeText,
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 12,
  },
  freezeButtonText: {
    color: COLORS.freezeText,
    fontSize: 13,
    fontWeight: '500',
  },
  wastedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.alertCardBg,
    borderWidth: 0.5,
    borderColor: COLORS.alertBorder,
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 8,
  },
  wastedButtonText: {
    color: COLORS.redDark,
    fontSize: 13,
    fontWeight: '500',
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
  pickerOptionText: {
    fontSize: 14,
    color: COLORS.darkGreen,
  },
  // Filter modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  filterPanel: {
    backgroundColor: COLORS.cardWhite,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 16,
  },
  filterTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.darkGreen,
    marginBottom: 12,
  },
  filterSectionLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterChip: {
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: COLORS.background,
  },
  filterChipText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  applyButton: {
    backgroundColor: COLORS.primaryGreen,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  applyButtonText: {
    color: '#EAF3DE',
    fontSize: 14,
    fontWeight: '500',
  },
});
