import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { useHasHydrated } from '../stores/pantryStore';

const SPLASH_DURATION_MS = 3000;

function Splash() {
  return (
    <View style={styles.splash}>
      <Text style={styles.splashText}>Conserve My Food</Text>
    </View>
  );
}

export default function RootLayout() {
  const [minTimerElapsed, setMinTimerElapsed] = useState(false);
  const hasHydrated = useHasHydrated();

  useEffect(() => {
    const t = setTimeout(() => setMinTimerElapsed(true), SPLASH_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  const showSplash = !minTimerElapsed || !hasHydrated;

  return (
    <SafeAreaProvider>
      {showSplash ? <Splash /> : <Stack screenOptions={{ headerShown: false }} />}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: COLORS.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashText: {
    color: '#000000',
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
