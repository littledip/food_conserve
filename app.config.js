// Generated from the previous app.json. The conversion to JS lets us read
// build-time env vars (notably ANTHROPIC_API_KEY) and expose them through
// expo-constants.

require('dotenv/config');

module.exports = {
  expo: {
    name: 'food_conserve',
    slug: 'food_conserve',
    scheme: 'foodconserve',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-router',
      '@react-native-community/datetimepicker',
      'expo-asset',
    ],
    extra: {
      // Read at metro/expo build time. Available to the app via
      // Constants.expoConfig.extra.anthropicApiKey. null when unset so the
      // feature can degrade gracefully (we'd show a "configure API key" hint).
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    },
  },
};
