import { fetch } from 'expo/fetch';
import Constants from 'expo-constants';
import {
  PantryChatError,
  isAbortError,
  PANTRY_CHAT_SYSTEM_PROMPT,
  PANTRY_TOOLS,
  type AssistantContentBlock,
  type PantryChatMessage,
  type PantrySnapshot,
  type TextBlock,
  type ToolUseBlock,
} from './pantryChat';
import { readSseEvents } from './sseStream';

// Prototype transport for driving the pantry chat agent loop against a local
// Ollama instance instead of Anthropic — same canonical PantryChatMessage[] /
// AssistantContentBlock[] shapes as pantryChatApp.ts, so pantryChatExecutor.ts
// doesn't need to know which backend it's talking to (see
// pantryChatBackend.ts for the toggle). Internals differ because the wire
// format differs: Ollama's /v1/chat/completions is OpenAI-compatible
// (role-based messages, `tool_calls` on assistant messages, a `tool` role
// for results) rather than Anthropic's content-block-based messages — but it
// streams standard SSE, so the existing readSseEvents reader is reused as-is.

function getOllamaBaseUrl(): string {
  const url = Constants.expoConfig?.extra?.ollamaBaseUrl;
  if (typeof url !== 'string' || !url) {
    throw new PantryChatError(
      'OLLAMA_BASE_URL is not configured. Add it to .env (see .env.example) and restart the dev server.',
    );
  }
  return url.replace(/\/+$/, '');
}

function getOllamaModel(): string {
  const model = Constants.expoConfig?.extra?.ollamaModel;
  if (typeof model !== 'string' || !model) {
    throw new PantryChatError(
      'OLLAMA_MODEL is not configured. Add it to .env (see .env.example) and restart the dev server.',
    );
  }
  return model;
}

// Anthropic's tool schemas (name/description/input_schema) map directly onto
// OpenAI-style function tools (name/description/parameters) — same JSON
// Schema shape, just a different wrapper and field name.
function toOpenAiTools(): unknown[] {
  return PANTRY_TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

// Translates our canonical content-block messages into OpenAI-style chat
// messages: a tool_result block becomes a `role: 'tool'` message, and
// tool_use blocks on an assistant message become its `tool_calls` array
// (arguments JSON-stringified, per the OpenAI wire format).
function toOpenAiMessages(snapshot: PantrySnapshot, messages: PantryChatMessage[]): unknown[] {
  const out: unknown[] = [
    { role: 'system', content: PANTRY_CHAT_SYSTEM_PROMPT },
    { role: 'system', content: `CURRENT_PANTRY:\n${JSON.stringify(snapshot)}` },
  ];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = msg.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      if (text) out.push({ role: 'user', content: text });

      for (const block of msg.content) {
        if (block.type !== 'tool_result') continue;
        out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content });
      }
    } else {
      const text = msg.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const toolUses = msg.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');

      const assistantMsg: Record<string, unknown> = { role: 'assistant', content: text || null };
      if (toolUses.length > 0) {
        assistantMsg.tool_calls = toolUses.map((tu) => ({
          id: tu.id,
          type: 'function',
          function: { name: tu.name, arguments: JSON.stringify(tu.input) },
        }));
      }
      out.push(assistantMsg);
    }
  }

  return out;
}

export interface SendOllamaChatTurnOptions {
  onTextDelta?: (delta: string) => void;
  // Lets the caller cancel an in-flight request/stream (user-tapped Stop, or
  // a client-side timeout) — a hung or runaway local-model generation has no
  // other way to be interrupted.
  signal?: AbortSignal;
}

export interface SendOllamaChatTurnResult {
  blocks: AssistantContentBlock[];
  stopReason: string | null;
}

// Mirrors pantryChatBlocks.ts's per-index accumulation, adapted to OpenAI's
// streaming shape: each chunk's choices[0].delta.tool_calls is an array of
// deltas keyed by `index`, with `id`/`function.name` arriving once and
// `function.arguments` streamed as incremental JSON-string fragments.
type ToolCallAccumulator = { id: string; name: string; argsJson: string };

export async function sendOllamaChatTurn(
  messages: PantryChatMessage[],
  snapshot: PantrySnapshot,
  options: SendOllamaChatTurnOptions = {},
): Promise<SendOllamaChatTurnResult> {
  const baseUrl = getOllamaBaseUrl();
  const model = getOllamaModel();

  const requestBody = {
    model,
    stream: true,
    temperature: 0.3,
    // Without a cap, a model that doesn't emit a clean stop token (or loses
    // track of the conversation) can run unbounded — seen in practice as a
    // single turn decoding 7000+ tokens with no sign of stopping. Matches the
    // Anthropic transport's max_tokens.
    max_tokens: 4096,
    tools: toOpenAiTools(),
    messages: toOpenAiMessages(snapshot, messages),
  };

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: options.signal,
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new PantryChatError('Ollama chat request failed to send', e);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new PantryChatError(`Ollama chat API returned ${res.status}: ${detail.slice(0, 300)}`);
  }
  if (!res.body) {
    throw new PantryChatError('Ollama chat response had no body to stream');
  }

  const toolCallsByIndex = new Map<number, ToolCallAccumulator>();
  let text = '';
  let finishReason: string | null = null;

  await readSseEvents(res.body, (raw) => {
    const evt = raw as {
      choices?: Array<{
        delta?: {
          content?: string;
          tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string | null;
      }>;
    };
    const choice = evt.choices?.[0];
    if (!choice) return;

    if (choice.delta?.content) {
      text += choice.delta.content;
      options.onTextDelta?.(choice.delta.content);
    }

    for (const tc of choice.delta?.tool_calls ?? []) {
      const acc = toolCallsByIndex.get(tc.index) ?? { id: '', name: '', argsJson: '' };
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (tc.function?.arguments) acc.argsJson += tc.function.arguments;
      toolCallsByIndex.set(tc.index, acc);
    }

    if (choice.finish_reason) finishReason = choice.finish_reason;
  });

  const blocks: AssistantContentBlock[] = [];
  if (text) blocks.push({ type: 'text', text });

  for (const index of [...toolCallsByIndex.keys()].sort((a, b) => a - b)) {
    const acc = toolCallsByIndex.get(index)!;
    let input: unknown = {};
    if (acc.argsJson) {
      try {
        input = JSON.parse(acc.argsJson);
      } catch (e) {
        throw new PantryChatError(`Ollama tool call arguments were not valid JSON: ${acc.argsJson.slice(0, 300)}`, e);
      }
    }
    blocks.push({ type: 'tool_use', id: acc.id || `ollama-tool-${index}`, name: acc.name, input });
  }

  return { blocks, stopReason: finishReason === 'length' ? 'max_tokens' : finishReason };
}
