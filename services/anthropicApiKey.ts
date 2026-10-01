import Constants from 'expo-constants';

// Shared across every RN transport that talks to Anthropic directly
// (receiptVisionApp.ts, pantryChatApp.ts) — resolves the API key baked into
// the app bundle via expo-constants (.env -> app.config.js). Throws a plain
// Error; callers wrap it in their own domain error type if they want one.
export function getAnthropicApiKey(): string {
  const key = Constants.expoConfig?.extra?.anthropicApiKey;
  if (typeof key !== 'string' || !key) {
    throw new Error(
      'ANTHROPIC_API_KEY is not configured. Add it to .env (see .env.example) and restart the dev server.',
    );
  }
  return key;
}
