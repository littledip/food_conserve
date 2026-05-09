import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';

const SPLASH_DURATION_MS = 3000;

function Splash() {
  return (
    <View style={styles.splash}>
      <Text style={styles.splashText}>Conserve My Food</Text>
    </View>
  );
}

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), SPLASH_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

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
