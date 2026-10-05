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
      'expo-font',
    ],
    extra: {
      // Read at metro/expo build time. Available to the app via
      // Constants.expoConfig.extra.anthropicApiKey. null when unset so the
      // feature can degrade gracefully (we'd show a "configure API key" hint).
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
      // Prototype toggle for the pantry chat backend — 'anthropic' (default)
      // or 'ollama', so Claude vs. a local model can be A/B tested on the
      // same build without a code change. See services/pantryChatBackend.ts.
      pantryChatBackend: process.env.PANTRY_CHAT_BACKEND ?? 'anthropic',
      // Base URL of an Ollama instance reachable from the phone (NOT
      // localhost — that resolves to the phone itself). A LAN hostname like
      // http://your-mac.local:11434 or a raw IP both work.
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? null,
      // Ollama model tag to use, e.g. "llama3.1:8b" — must be tagged with
      // "tools" capability (`ollama show <model>`) or tool calls won't work.
      ollamaModel: process.env.OLLAMA_MODEL ?? null,
    },
  },
};
