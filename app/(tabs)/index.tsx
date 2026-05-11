import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';
import { MOCK_STATS } from '../../constants/mockData';
import { GroceryItem } from '../../types/grocery';
import {
  useUrgentItems,
  useItemCount,
  useUpcomingWeek,
  useExpiringThisWeekCount,
  useDisposeItem,
  useMoveItem,
} from '../../stores/pantryStore';

const UPCOMING_LIST_MAX_HEIGHT = 220;

const daysUntil = (d: Date) =>
  Math.ceil((d.getTime() - Date.now()) / 86400000);

function UrgencyDot({ item }: { item: GroceryItem }) {
  const d = daysUntil(item.effectiveExpirationDate);
  const color = d <= 0 ? COLORS.redDot : COLORS.orange;
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function UrgencyLabel({ item }: { item: GroceryItem }) {
  const d = daysUntil(item.effectiveExpirationDate);
  const label = d <= 0 ? 'expires today' : 'expires tomorrow';
  const color = d <= 0 ? COLORS.redText : COLORS.orangeDark;
  return (
    <Text style={[styles.alertItemText, { color }]}>
      {item.name} — {label}
    </Text>
  );
}

function getTrashEmphasis(d: number): { name: 'trash' | 'trash-outline'; color: string } {
  if (d < 0) return { name: 'trash', color: COLORS.redDot };
  if (d === 0) return { name: 'trash-outline', color: COLORS.redText };
  return { name: 'trash-outline', color: COLORS.textSecondary };
}

function UpcomingRow({ item }: { item: GroceryItem }) {
  const d = daysUntil(item.effectiveExpirationDate);
  const dotColor = d <= 3 ? COLORS.orange : COLORS.midGreen;
  return (
    <View style={styles.upcomingRow}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.upcomingName} numberOfLines={1}>{item.name}</Text>
      <Text style={styles.upcomingDays}>{d} days</Text>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { foodScore, streak, savedThisMonth, projectedMonthEnd, daysElapsed, daysInMonth } = MOCK_STATS;

  const urgentItems = useUrgentItems();
  const totalItems = useItemCount();
  const expiringThisWeek = useExpiringThisWeekCount();
  const upcoming = useUpcomingWeek()
    .slice()
    .sort((a, b) => a.effectiveExpirationDate.getTime() - b.effectiveExpirationDate.getTime());
  const disposeItem = useDisposeItem();
  const moveItem = useMoveItem();

  return (
    <View style={styles.root}>
      {/* Green header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.greeting}>Good morning, Sarah</Text>
        <Text style={styles.title}>Your day at a glance</Text>

        {/* Score pill */}
        <View style={styles.scorePill}>
          <View>
            <Text style={styles.scoreLabel}>Food score</Text>
            <Text style={styles.scoreValue}>{foodScore}</Text>
            <Text style={styles.scoreSub}>Top 12% of households</Text>
          </View>
          <View style={styles.streakBadge}>
            <Text style={styles.streakNum}>{streak}</Text>
            <Text style={styles.streakLabel}>day streak</Text>
          </View>
        </View>
      </View>

      {/* Body */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Metric cards */}
        <View style={styles.metricRow}>
          {/* Savings card */}
          <View style={[styles.metricCard, { backgroundColor: COLORS.statCardBg }]}>
            <Text style={styles.metricLabelGreen}>Saved this month</Text>
            <Text style={styles.metricValueGreen}>${savedThisMonth}</Text>
            <Text style={styles.metricSubGreen}>{daysElapsed} of {daysInMonth} days</Text>
            <View style={styles.projPill}>
              <Text style={styles.projText}>on pace for ${projectedMonthEnd}</Text>
            </View>
          </View>

          {/* Pantry count card */}
          <View style={[styles.metricCard, { backgroundColor: COLORS.pantryCountBg }]}>
            <Text style={styles.metricLabelAmber}>Items in pantry</Text>
            <Text style={styles.metricValueAmber}>{totalItems}</Text>
            <Text style={styles.metricSubAmber}>{expiringThisWeek} expiring this week</Text>
          </View>
        </View>

        {/* Needs attention */}
        {urgentItems.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Needs attention</Text>
            <View style={styles.alertCard}>
              <Text style={styles.alertTitle}>
                {urgentItems.length} {urgentItems.length === 1 ? 'item' : 'items'} expiring today or tomorrow
              </Text>
              {urgentItems.map((item) => {
                const trash = getTrashEmphasis(daysUntil(item.effectiveExpirationDate));
                const showFreezeBadge = item.isFreezable && item.storageLocation !== 'freezer';
                return (
                  <View key={item.id}>
                    <View style={styles.alertRow}>
                      <UrgencyDot item={item} />
                      <View style={styles.alertLabelWrap}>
                        <UrgencyLabel item={item} />
                      </View>
                      <View style={styles.alertActions}>
                        <TouchableOpacity
                          onPress={() => disposeItem(item.id, 'used')}
                          activeOpacity={0.6}
                          hitSlop={6}
                          accessibilityLabel={`Mark ${item.name} as used`}
                        >
                          <Ionicons name="checkmark-circle-outline" size={22} color={COLORS.midGreen} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => disposeItem(item.id, 'wasted')}
                          activeOpacity={0.6}
                          hitSlop={6}
                          accessibilityLabel={`Mark ${item.name} as wasted`}
                        >
                          <Ionicons name={trash.name} size={22} color={trash.color} />
                        </TouchableOpacity>
                      </View>
                    </View>
                    {showFreezeBadge && (
                      <TouchableOpacity
                        style={styles.freezeActionBadge}
                        onPress={() => moveItem(item.id, 'freezer')}
                        activeOpacity={0.7}
                        accessibilityLabel={`Move ${item.name} to freezer`}
                      >
                        <Ionicons name="snow-outline" size={14} color={COLORS.freezeText} />
                        <Text style={styles.freezeActionText}>Freezable — move to freezer</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Expiring this week (excluding today/tomorrow) */}
        {upcoming.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Expiring this week</Text>
            <View style={styles.upcomingCard}>
              <ScrollView
                style={{ maxHeight: UPCOMING_LIST_MAX_HEIGHT }}
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {upcoming.map((item, idx) => (
                  <View
                    key={item.id}
                    style={idx === upcoming.length - 1 ? undefined : styles.upcomingDivider}
                  >
                    <UpcomingRow item={item} />
                  </View>
                ))}
              </ScrollView>
            </View>
          </>
        )}
      </ScrollView>
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
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  greeting: {
    color: COLORS.tealSub,
    fontSize: 11,
    marginBottom: 1,
  },
  title: {
    color: '#EAF3DE',
    fontSize: 20,
    fontWeight: '500',
    marginBottom: 8,
  },
  scorePill: {
    backgroundColor: COLORS.darkGreen,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreLabel: {
    color: COLORS.tealSub,
    fontSize: 11,
  },
  scoreValue: {
    color: '#EAF3DE',
    fontSize: 22,
    fontWeight: '500',
  },
  scoreSub: {
    color: COLORS.tealSub,
    fontSize: 10,
  },
  streakBadge: {
    backgroundColor: COLORS.orange,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  streakNum: {
    color: COLORS.streakText,
    fontSize: 18,
    fontWeight: '500',
  },
  streakLabel: {
    color: COLORS.streakSub,
    fontSize: 10,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 8,
    paddingHorizontal: 10,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 8,
  },
  metricCard: {
    flex: 1,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  metricLabelGreen: {
    color: COLORS.primaryGreen,
    fontSize: 11,
  },
  metricValueGreen: {
    color: COLORS.darkGreen,
    fontSize: 18,
    fontWeight: '500',
  },
  metricSubGreen: {
    color: COLORS.midGreen,
    fontSize: 10,
  },
  projPill: {
    backgroundColor: COLORS.lightGreen,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  projText: {
    color: COLORS.primaryGreen,
    fontSize: 10,
    fontWeight: '500',
  },
  metricLabelAmber: {
    color: COLORS.orangeDark,
    fontSize: 11,
  },
  metricValueAmber: {
    color: COLORS.streakSub,
    fontSize: 18,
    fontWeight: '500',
  },
  metricSubAmber: {
    color: COLORS.amberText,
    fontSize: 10,
  },
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 5,
    marginTop: 8,
  },
  alertCard: {
    backgroundColor: COLORS.alertCardBg,
    borderRadius: 7,
    padding: 8,
    paddingHorizontal: 8,
    borderWidth: 0.5,
    borderColor: COLORS.alertBorder,
  },
  alertTitle: {
    color: COLORS.redDark,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  alertLabelWrap: {
    flex: 1,
  },
  alertActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  freezeActionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.freezeBg,
    borderRadius: 4,
    paddingVertical: 3,
    paddingHorizontal: 6,
    alignSelf: 'flex-start',
    marginLeft: 9,
    marginTop: 2,
    marginBottom: 4,
  },
  freezeActionText: {
    color: COLORS.freezeText,
    fontSize: 11,
    fontWeight: '500',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  alertItemText: {
    fontSize: 11,
  },
  upcomingCard: {
    backgroundColor: COLORS.cardWhite,
    borderRadius: 7,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  upcomingDivider: {
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.subtleBorder,
  },
  upcomingName: {
    flex: 1,
    fontSize: 12,
    color: COLORS.darkGreen,
    fontWeight: '500',
  },
  upcomingDays: {
    fontSize: 11,
    color: COLORS.primaryGreen,
    fontWeight: '500',
  },
});
