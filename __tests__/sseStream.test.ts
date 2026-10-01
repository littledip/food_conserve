import { readSseEvents } from '../services/sseStream';

function makeFakeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    getReader() {
      return {
        async read() {
          if (index >= chunks.length) return { done: true, value: undefined };
          const value = encoder.encode(chunks[index]);
          index += 1;
          return { done: false, value };
        },
        releaseLock() {},
      };
    },
  } as unknown as ReadableStream<Uint8Array>;
}

describe('readSseEvents', () => {
  it('parses data lines into JSON events, skipping non-data lines', async () => {
    const stream = makeFakeStream([
      'event: message_start\n',
      'data: {"type":"a","index":0}\n\n',
      'data: {"type":"b","index":1}\n\n',
    ]);
    const events: unknown[] = [];
    await readSseEvents(stream, (e) => events.push(e));
    expect(events).toEqual([
      { type: 'a', index: 0 },
      { type: 'b', index: 1 },
    ]);
  });

  it('reassembles a data line split across chunk boundaries', async () => {
    const stream = makeFakeStream(['data: {"type":"a",', '"index":0}\n\n']);
    const events: unknown[] = [];
    await readSseEvents(stream, (e) => events.push(e));
    expect(events).toEqual([{ type: 'a', index: 0 }]);
  });

  it('skips malformed JSON on a data line without throwing', async () => {
    const stream = makeFakeStream(['data: not json\n', 'data: {"type":"ok"}\n\n']);
    const events: unknown[] = [];
    await readSseEvents(stream, (e) => events.push(e));
    expect(events).toEqual([{ type: 'ok' }]);
  });

  it('propagates an error thrown from onEvent and still releases the reader lock', async () => {
    let released = false;
    const encoder = new TextEncoder();
    const stream = {
      getReader() {
        let index = 0;
        const chunks = ['data: {"type":"boom"}\n\n'];
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            const value = encoder.encode(chunks[index]);
            index += 1;
            return { done: false, value };
          },
          releaseLock() {
            released = true;
          },
        };
      },
    } as unknown as ReadableStream<Uint8Array>;

    await expect(
      readSseEvents(stream, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(released).toBe(true);
  });
});
