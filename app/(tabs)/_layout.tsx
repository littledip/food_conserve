import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(focused: boolean, active: IoniconName, inactive: IoniconName) {
  // tabBarIcon's `color` is typed as ColorValue (not just string) as of the
  // SDK 57 / react-navigation types — Ionicons already accepts ColorValue,
  // so widen here rather than narrowing what we pass to it.
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={focused ? active : inactive} size={size} color={color} />
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.tabActive,
        tabBarInactiveTintColor: COLORS.tabInactive,
        tabBarStyle: {
          backgroundColor: COLORS.cardWhite,
          borderTopColor: COLORS.borderColor,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color, size }) =>
            tabIcon(focused, 'grid', 'grid-outline')({ color, size }),
        }}
      />
      <Tabs.Screen
        name="pantry"
        options={{
          title: 'Pantry',
          tabBarIcon: ({ focused, color, size }) =>
            tabIcon(
              focused,
              'file-tray-stacked',
              'file-tray-stacked-outline'
            )({ color, size }),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ focused, color, size }) =>
            tabIcon(
              focused,
              'information-circle',
              'information-circle-outline'
            )({ color, size }),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused, color, size }) =>
            tabIcon(focused, 'person', 'person-outline')({ color, size }),
        }}
      />
    </Tabs>
  );
}
