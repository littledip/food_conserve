import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/theme';
import { useResetPantry } from '../../stores/pantryStore';

type TimeRange = '3m' | '6m' | '1y';

const BREAKDOWN_BARS = [
  { label: 'Waste rate', value: 88, color: COLORS.midGreen },
  { label: 'Savings trend', value: 82, color: COLORS.midGreen },
  { label: 'Streak', value: 75, color: COLORS.midGreen },
  { label: 'Scan frequency', value: 70, color: COLORS.orange, valueColor: COLORS.orangeDark },
];

const MONTHLY_DATA: Record<TimeRange, { month: string; amount: number }[]> = {
  '3m': [
    { month: 'Feb', amount: 79 },
    { month: 'Mar', amount: 98 },
    { month: 'Apr', amount: 47 },
  ],
  '6m': [
    { month: 'Nov', amount: 61 },
    { month: 'Dec', amount: 74 },
    { month: 'Jan', amount: 88 },
    { month: 'Feb', amount: 79 },
    { month: 'Mar', amount: 98 },
    { month: 'Apr', amount: 47 },
  ],
  '1y': [
    { month: 'May', amount: 42 },
    { month: 'Jun', amount: 55 },
    { month: 'Jul', amount: 60 },
    { month: 'Aug', amount: 58 },
    { month: 'Sep', amount: 65 },
    { month: 'Oct', amount: 70 },
    { month: 'Nov', amount: 61 },
    { month: 'Dec', amount: 74 },
    { month: 'Jan', amount: 88 },
    { month: 'Feb', amount: 79 },
    { month: 'Mar', amount: 98 },
    { month: 'Apr', amount: 47 },
  ],
};

const PREFERENCES = [
  { label: 'Notifications', value: 'On' },
  { label: 'Default pantry view', value: 'By category' },
  { label: 'Units of measure', value: 'Imperial' },
];

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const [timeRange, setTimeRange] = useState<TimeRange>('6m');
  const resetPantry = useResetPantry();

  const confirmReset = () => {
    Alert.alert(
      'Reset pantry?',
      'This permanently deletes all items and history. Cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: resetPantry },
      ],
    );
  };

  const data = MONTHLY_DATA[timeRange];
  const maxAmount = Math.max(...data.map((d) => d.amount));
  const maxBarH = 40;
  const currentMonth = 'Apr';

  return (
    <View style={styles.root}>
      {/* Green header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        {/* Profile row */}
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>SH</Text>
          </View>
          <View>
            <Text style={styles.profileName}>Sarah H.</Text>
            <Text style={styles.profileSub}>Member since Jan 2026</Text>
          </View>
        </View>

        {/* Summary boxes */}
        <View style={styles.summaryRow}>
          <View style={[styles.summaryBox, { backgroundColor: COLORS.darkGreen }]}>
            <Text style={styles.summaryLabel}>Food score</Text>
            <Text style={styles.summaryValue}>84</Text>
            <Text style={styles.summarySub}>Top 12%</Text>
          </View>
          <View style={[styles.summaryBox, { backgroundColor: COLORS.orange }]}>
            <Text style={[styles.summaryLabel, { color: COLORS.streakSub }]}>Current streak</Text>
            <Text style={[styles.summaryValue, { color: COLORS.streakText }]}>14 days</Text>
            <Text style={[styles.summarySub, { color: COLORS.streakSub }]}>Best: 21 days</Text>
          </View>
        </View>
      </View>

      {/* Scrollable body */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Lifetime stats */}
        <SectionLabel>Lifetime stats</SectionLabel>
        <View style={styles.lifetimeGrid}>
          {[
            { label: 'Total saved', value: '$312', sub: 'Since Jan' },
            { label: 'Items tracked', value: '284', sub: '3 months' },
            { label: 'Waste avoided', value: '91%', sub: 'vs 68% avg' },
          ].map(({ label, value, sub }) => (
            <View key={label} style={styles.lifetimeCard}>
              <Text style={styles.lifetimeLabel}>{label}</Text>
              <Text style={styles.lifetimeValue}>{value}</Text>
              <Text style={styles.lifetimeSub}>{sub}</Text>
            </View>
          ))}
        </View>

        {/* Food score breakdown */}
        <SectionLabel>Food score breakdown</SectionLabel>
        <View style={styles.card}>
          {BREAKDOWN_BARS.map(({ label, value, color, valueColor }) => (
            <View key={label} style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>{label}</Text>
              <View style={styles.barBg}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${value}%` as any, backgroundColor: color },
                  ]}
                />
              </View>
              <Text style={[styles.breakdownValue, { color: valueColor ?? COLORS.darkGreen }]}>
                {value}
              </Text>
            </View>
          ))}
        </View>

        {/* Monthly savings */}
        <SectionLabel>Monthly savings</SectionLabel>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Saved per month</Text>

          {/* Time range chips */}
          <View style={styles.chipRow}>
            {(['3m', '6m', '1y'] as TimeRange[]).map((range) => (
              <TouchableOpacity
                key={range}
                style={[styles.chip, timeRange === range && styles.chipActive]}
                onPress={() => setTimeRange(range)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.chipText,
                    timeRange === range && styles.chipTextActive,
                  ]}
                >
                  {range === '3m' ? '3 mo' : range === '6m' ? '6 mo' : 'Year'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Bar chart */}
          <View style={styles.barChart}>
            {data.map(({ month, amount }) => {
              const barH = Math.round((amount / maxAmount) * maxBarH);
              const isCurrent = month === currentMonth;
              return (
                <View key={month} style={styles.barCol}>
                  <Text style={styles.barVal}>${amount}{isCurrent ? '*' : ''}</Text>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: barH,
                        backgroundColor: isCurrent ? COLORS.primaryGreen : COLORS.barLight,
                      },
                    ]}
                  />
                  <Text style={styles.barMonthLabel}>{month}</Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.chartFootnote}>* April in progress</Text>
        </View>

        {/* Preferences */}
        <SectionLabel>Preferences</SectionLabel>
        <View style={styles.settingsGroup}>
          {PREFERENCES.map(({ label, value }, idx) => (
            <TouchableOpacity
              key={label}
              style={[
                styles.settingsRow,
                idx < PREFERENCES.length - 1 && styles.settingsRowBorder,
              ]}
              activeOpacity={0.7}
            >
              <Text style={styles.settingsLabel}>{label}</Text>
              <View style={styles.settingsRight}>
                <Text style={styles.settingsValue}>{value}</Text>
                <Text style={styles.settingsArrow}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Data */}
        <SectionLabel>Data</SectionLabel>
        <View style={styles.settingsGroup}>
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={confirmReset}
            activeOpacity={0.7}
          >
            <Text style={styles.destructiveLabel}>Reset pantry</Text>
          </TouchableOpacity>
        </View>
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
    paddingBottom: 12,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.darkGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: COLORS.lightGreen,
    fontSize: 9,
    fontWeight: '500',
  },
  profileName: {
    color: '#EAF3DE',
    fontSize: 18,
    fontWeight: '500',
  },
  profileSub: {
    color: COLORS.tealSub,
    fontSize: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 5,
  },
  summaryBox: {
    flex: 1,
    borderRadius: 7,
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  summaryLabel: {
    color: COLORS.tealSub,
    fontSize: 10,
    marginBottom: 2,
  },
  summaryValue: {
    color: '#EAF3DE',
    fontSize: 19,
    fontWeight: '500',
  },
  summarySub: {
    color: COLORS.tealSub,
    fontSize: 9,
    marginTop: 1,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 8,
    paddingHorizontal: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 2,
  },
  lifetimeGrid: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 10,
  },
  lifetimeCard: {
    flex: 1,
    backgroundColor: COLORS.statCardBg,
    borderRadius: 6,
    padding: 6,
  },
  lifetimeLabel: {
    fontSize: 10,
    color: COLORS.primaryGreen,
    marginBottom: 2,
  },
  lifetimeValue: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.darkGreen,
  },
  lifetimeSub: {
    fontSize: 9,
    color: COLORS.midGreen,
    marginTop: 1,
  },
  card: {
    backgroundColor: COLORS.cardWhite,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 7,
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.darkGreen,
    marginBottom: 5,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 5,
  },
  breakdownLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    flex: 1,
  },
  barBg: {
    flex: 2,
    height: 4,
    backgroundColor: COLORS.subtleBorder,
    borderRadius: 2,
  },
  barFill: {
    height: 4,
    borderRadius: 2,
  },
  breakdownValue: {
    fontSize: 10,
    fontWeight: '500',
    minWidth: 20,
    textAlign: 'right',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 7,
  },
  chip: {
    backgroundColor: COLORS.background,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 5,
  },
  chipActive: {
    backgroundColor: COLORS.primaryGreen,
    borderColor: COLORS.primaryGreen,
  },
  chipText: {
    fontSize: 10,
    color: COLORS.textMuted,
  },
  chipTextActive: {
    color: '#EAF3DE',
  },
  barChart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    marginBottom: 3,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    justifyContent: 'flex-end',
  },
  barVal: {
    fontSize: 9,
    color: COLORS.darkGreen,
    fontWeight: '500',
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  barMonthLabel: {
    fontSize: 9,
    color: COLORS.textSecondary,
  },
  chartFootnote: {
    fontSize: 9,
    color: COLORS.textSecondary,
  },
  settingsGroup: {
    backgroundColor: COLORS.cardWhite,
    borderWidth: 0.5,
    borderColor: COLORS.borderColor,
    borderRadius: 7,
    overflow: 'hidden',
    marginBottom: 10,
  },
  settingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  settingsRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.subtleBorder,
  },
  settingsLabel: {
    fontSize: 11,
    color: COLORS.darkGreen,
  },
  destructiveLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.redDark,
  },
  settingsRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsValue: {
    fontSize: 10,
    color: COLORS.textSecondary,
    marginRight: 3,
  },
  settingsArrow: {
    fontSize: 12,
    color: COLORS.borderColor,
  },
});
