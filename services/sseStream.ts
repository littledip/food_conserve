// Minimal Server-Sent-Events line reader shared by the app's streaming
// Anthropic transports (receiptVisionApp.ts, pantryChatApp.ts). Not a general
// SSE library — just the "buffer bytes, split on newlines, JSON-parse each
// `data:` line" loop those two transports would otherwise each duplicate.
// Malformed JSON on a line is skipped; anything onEvent itself throws
// propagates to the caller (the reader lock is still released via finally).
export async function readSseEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (evt: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIndex: number;
      while ((nlIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nlIndex).trimEnd();
        buffer = buffer.slice(nlIndex + 1);
        // SSE frames are `event:`/`data:` line pairs; only the data carries JSON.
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        onEvent(parsed);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
