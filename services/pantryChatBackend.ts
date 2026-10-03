import Constants from 'expo-constants';
import { buildPantryChatRequestBody, type AssistantContentBlock, type PantryChatMessage, type PantrySnapshot } from './pantryChat';
import { sendPantryChatTurn } from './pantryChatApp';
import { sendOllamaChatTurn } from './pantryChatOllamaApp';

// Single switch point between chat backends, so pantryChatExecutor.ts stays
// backend-agnostic. Toggle via PANTRY_CHAT_BACKEND in .env (see
// .env.example) — 'anthropic' (default) or 'ollama', for A/B-testing Claude
// against a local model without a code change.

export type ChatBackend = 'anthropic' | 'ollama';

export function getChatBackend(): ChatBackend {
  return Constants.expoConfig?.extra?.pantryChatBackend === 'ollama' ? 'ollama' : 'anthropic';
}

export interface SendChatTurnOptions {
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface SendChatTurnResult {
  blocks: AssistantContentBlock[];
  stopReason: string | null;
}

export async function sendChatTurn(
  messages: PantryChatMessage[],
  snapshot: PantrySnapshot,
  options: SendChatTurnOptions = {},
): Promise<SendChatTurnResult> {
  if (getChatBackend() === 'ollama') {
    return sendOllamaChatTurn(messages, snapshot, options);
  }
  const body = buildPantryChatRequestBody(messages, snapshot);
  return sendPantryChatTurn(body, options);
}
