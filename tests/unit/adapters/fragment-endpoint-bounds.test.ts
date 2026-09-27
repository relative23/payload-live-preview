/**
 * The shared fragment endpoint owns one portable request-body boundary for
 * every server adapter. These tests drive that real handler with byte streams
 * so declared lengths can never stand in for the bytes actually consumed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFragmentEndpointHandler,
  type FragmentEndpointOptions,
} from '@adapters/shared/fragment-endpoint';
import { FRAGMENT_PROTOCOL_VERSION, FRAGMENT_VERSION_HEADER } from '@/types/fragment-protocol';

const SITE = 'https://site.example.com';
const ENDPOINT = `${SITE}/payload/fragment`;
const encoder = new TextEncoder();
const render = vi.fn((_component: string, props: Record<string, unknown>) =>
  Promise.resolve(`<h1>${String(props['title'])}</h1>`),
);

type Limits = NonNullable<FragmentEndpointOptions<string>['limits']>;
type ReadResult = ReadableStreamReadResult<Uint8Array>;

function validJson(title = 'Hello'): string {
  return JSON.stringify({
    fragment: 'hero',
    route: '/page',
    search: '',
    revision: 1,
    fields: { title },
  });
}

function endpoint(limits: Limits = {}, overLimitBody?: 'cancel' | 'drain') {
  return createFragmentEndpointHandler(
    {
      registry: {
        hero: {
          component: 'Hero',
          props: ({ fields }) => ({ title: fields['title'] }),
        },
      },
      authorize: { type: 'verifier', verify: () => ({ subject: 'editor' }) },
      limits,
    },
    { render, rendererName: 'test', ...(overLimitBody === undefined ? {} : { overLimitBody }) },
  );
}

function textRequest(raw: string, headers: Record<string, string> = {}): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, ...headers },
    body: raw,
  });
}

interface ReaderRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly onCancel?: (reason: unknown) => void;
  readonly cancel?: (reason: unknown) => Promise<void>;
  readonly bodyUsed?: boolean;
  readonly locked?: boolean;
}

/** A Request-compatible byte body whose application reads and cancellation stay observable. */
function readerRequest(
  readImplementation: () => Promise<ReadResult>,
  options: ReaderRequestOptions = {},
) {
  const read = vi.fn(readImplementation);
  const releaseLock = vi.fn();
  const cancel = vi.fn((reason?: unknown) => {
    options.onCancel?.(reason);
    return options.cancel?.(reason) ?? Promise.resolve();
  });
  const reader = { read, cancel, releaseLock };
  const getReader = vi.fn(() => reader);
  const body = { getReader, cancel, locked: options.locked ?? false };
  const text = vi.fn(async () => {
    const decoder = new TextDecoder();
    let decoded = '';
    for (;;) {
      const result = await read();
      if (result.done) break;
      decoded += decoder.decode(result.value, { stream: true });
    }
    return decoded + decoder.decode();
  });
  const fallbackController = new AbortController();
  const request = {
    method: 'POST',
    url: ENDPOINT,
    headers: new Headers({
      'content-type': 'application/json',
      origin: SITE,
      ...options.headers,
    }),
    body,
    bodyUsed: options.bodyUsed ?? false,
    signal: options.signal ?? fallbackController.signal,
    text,
  } as unknown as Request;
  return { request, read, cancel, getReader, releaseLock, text };
}

function chunkedRequest(
  chunks: readonly Uint8Array[],
  options: Omit<ReaderRequestOptions, 'onCancel'> = {},
) {
  let index = 0;
  let cancelled = false;
  return readerRequest(
    () => {
      if (cancelled || index >= chunks.length) {
        return Promise.resolve({ done: true, value: undefined });
      }
      const value = chunks[index];
      index += 1;
      if (value === undefined) return Promise.resolve({ done: true, value: undefined });
      return Promise.resolve({ done: false, value });
    },
    { ...options, onCancel: () => (cancelled = true) },
  );
}

async function expectRefusal(
  pending: Promise<Response>,
  status: number,
  error: string,
): Promise<Response> {
  const response = await pending;
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get(FRAGMENT_VERSION_HEADER)).toBe(String(FRAGMENT_PROTOCOL_VERSION));
  expect(await response.json()).toEqual({ error });
  return response;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      resolvePromise?.(value);
    },
  };
}

beforeEach(() => {
  render.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createFragmentEndpointHandler — request byte bounds', () => {
  it('refuses multibyte JSON whose UTF-16 length fits but whose UTF-8 bytes exceed the cap', async () => {
    const raw = validJson('€'.repeat(12));
    const bodyBytes = raw.length;
    expect(encoder.encode(raw).byteLength).toBeGreaterThan(bodyBytes);

    await expectRefusal(endpoint({ bodyBytes })(textRequest(raw)), 413, 'body');
    expect(render).not.toHaveBeenCalled();
  });

  it('accepts valid JSON at the exact UTF-8 byte boundary', async () => {
    const raw = validJson('Grenze €');
    const bodyBytes = encoder.encode(raw).byteLength;

    const response = await endpoint({ bodyBytes })(textRequest(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ html: '<h1>Grenze €</h1>', revision: 1 });
  });

  it('decodes a multibyte character split across chunks without replacement characters', async () => {
    const raw = validJson('A€B');
    const bytes = encoder.encode(raw);
    const euro = bytes.findIndex((byte) => byte === 0xe2);
    expect(euro).toBeGreaterThan(0);
    const streamed = chunkedRequest([
      bytes.slice(0, euro + 1),
      bytes.slice(euro + 1, euro + 2),
      bytes.slice(euro + 2),
    ]);

    const response = await endpoint({ bodyBytes: bytes.byteLength })(streamed.request);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ html: '<h1>A€B</h1>' });
  });

  it('measures the stream when content-length is missing, lower than reality, or invalid', async () => {
    const raw = validJson('€'.repeat(8));
    const bodyBytes = raw.length;
    expect(encoder.encode(raw).byteLength).toBeGreaterThan(bodyBytes);
    const declarations: readonly (string | undefined)[] = [
      undefined,
      '1',
      'not-a-number',
      '-1',
      '1.5',
      'Infinity',
    ];

    for (const declared of declarations) {
      const headers = declared === undefined ? {} : { 'content-length': declared };
      const response = await endpoint({ bodyBytes })(textRequest(raw, headers));
      const body: unknown = await response.json();
      expect({ declared, status: response.status, body }).toEqual({
        declared,
        status: 413,
        body: { error: 'body' },
      });
    }
  });

  it('refuses a valid over-limit content-length without acquiring or cancelling a reader', async () => {
    const streamed = chunkedRequest([encoder.encode(validJson())], {
      headers: { 'content-length': '000129' },
    });

    await expectRefusal(endpoint({ bodyBytes: 128 })(streamed.request), 413, 'body');
    expect(streamed.getReader).not.toHaveBeenCalled();
    expect(streamed.read).not.toHaveBeenCalled();
    expect(streamed.cancel).not.toHaveBeenCalled();
    expect(streamed.releaseLock).not.toHaveBeenCalled();
  });

  it('cancels after one oversized chunk without asking the reader for another chunk', async () => {
    const raw = validJson('x'.repeat(80));
    const streamed = chunkedRequest([encoder.encode(raw), encoder.encode('never read')]);

    await expectRefusal(endpoint({ bodyBytes: 32 })(streamed.request), 413, 'body');
    expect(streamed.read).toHaveBeenCalledTimes(1);
    expect(streamed.cancel).toHaveBeenCalledOnce();
    expect(streamed.releaseLock).toHaveBeenCalledOnce();
  });

  it('cancels many small chunks on the first byte past the cap', async () => {
    const chunks = Array.from(encoder.encode(validJson('x'.repeat(80))), (byte) =>
      Uint8Array.of(byte),
    );
    const streamed = chunkedRequest(chunks);

    await expectRefusal(endpoint({ bodyBytes: 32 })(streamed.request), 413, 'body');
    expect(streamed.read).toHaveBeenCalledTimes(33);
    expect(streamed.cancel).toHaveBeenCalledOnce();
    expect(streamed.releaseLock).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('cancel threw');
      },
    ],
    ['rejects', () => Promise.reject(new Error('cancel rejected'))],
  ] as const)('contains a reader cancellation that %s', async (_label, cancel) => {
    const streamed = readerRequest(
      () => Promise.resolve({ done: false, value: encoder.encode(validJson('too large')) }),
      { cancel },
    );

    await expectRefusal(endpoint({ bodyBytes: 8 })(streamed.request), 413, 'body');
    expect(streamed.cancel).toHaveBeenCalledWith('too-large');
    expect(streamed.releaseLock).toHaveBeenCalledOnce();
  });

  it('turns a reader failure into a bounded body refusal instead of rejecting', async () => {
    const broken = readerRequest(() => Promise.reject(new Error('socket reset')));

    await expectRefusal(endpoint({ bodyBytes: 128 })(broken.request), 400, 'body');
    expect(render).not.toHaveBeenCalled();
    expect(broken.releaseLock).toHaveBeenCalledOnce();
  });

  it('does not touch stream cancellation during an early declared-length refusal', async () => {
    const streamed = chunkedRequest([encoder.encode(validJson())], {
      headers: { 'content-length': '129' },
    });
    streamed.cancel.mockRejectedValueOnce(new Error('transport cancel rejected'));

    await expectRefusal(endpoint({ bodyBytes: 128 })(streamed.request), 413, 'body');
    expect(streamed.cancel).not.toHaveBeenCalled();
    expect(streamed.getReader).not.toHaveBeenCalled();
  });

  it('refuses a locked body without acquiring or cancelling its reader', async () => {
    const streamed = chunkedRequest([encoder.encode(validJson())], { locked: true });

    await expectRefusal(endpoint({ bodyBytes: 128 })(streamed.request), 400, 'body');
    expect(streamed.getReader).not.toHaveBeenCalled();
    expect(streamed.cancel).not.toHaveBeenCalled();
    expect(streamed.releaseLock).not.toHaveBeenCalled();
  });

  it('refuses and cancels a disturbed body before acquiring a reader', async () => {
    const streamed = chunkedRequest([encoder.encode(validJson())], { bodyUsed: true });

    await expectRefusal(endpoint({ bodyBytes: 128 })(streamed.request), 400, 'body');
    expect(streamed.getReader).not.toHaveBeenCalled();
    expect(streamed.cancel).toHaveBeenCalledWith('unreadable');
    expect(streamed.releaseLock).not.toHaveBeenCalled();
  });

  it('refuses and cancels a transport that throws while acquiring its reader', async () => {
    const streamed = chunkedRequest([encoder.encode(validJson())]);
    streamed.getReader.mockImplementation(() => {
      throw new Error('transport unavailable');
    });

    await expectRefusal(endpoint({ bodyBytes: 128 })(streamed.request), 400, 'body');
    expect(streamed.cancel).toHaveBeenCalledWith('unreadable');
    expect(streamed.read).not.toHaveBeenCalled();
    expect(streamed.releaseLock).not.toHaveBeenCalled();
  });

  it('refuses and cancels an already-aborted request before reading', async () => {
    const controller = new AbortController();
    controller.abort();
    const streamed = chunkedRequest([encoder.encode(validJson())], {
      signal: controller.signal,
    });

    await expectRefusal(endpoint({ bodyBytes: 128 })(streamed.request), 400, 'body');
    expect(streamed.read).not.toHaveBeenCalled();
    expect(streamed.cancel).toHaveBeenCalledOnce();
  });

  it('catches an abort that lands between preflight and listener registration', async () => {
    let aborted = false;
    const addEventListener = vi.fn(() => {
      // Model an abort whose event was dispatched just before the listener became active.
      aborted = true;
    });
    const removeEventListener = vi.fn();
    const signal = {
      get aborted() {
        return aborted;
      },
      addEventListener,
      removeEventListener,
    } as unknown as AbortSignal;
    const streamed = readerRequest(() => new Promise<ReadResult>(() => undefined), { signal });

    await expectRefusal(endpoint({ bodyBytes: 128 })(streamed.request), 400, 'body');
    expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(streamed.cancel).toHaveBeenCalledWith('unreadable');
    // The request lifetime now notices this race before acquiring a reader.
    expect(streamed.getReader).not.toHaveBeenCalled();
    expect(streamed.read).not.toHaveBeenCalled();
    expect(streamed.releaseLock).not.toHaveBeenCalled();
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('refuses and cancels when the request aborts during a pending read', async () => {
    const controller = new AbortController();
    const readStarted = deferred<undefined>();
    let call = 0;
    let finishRead: ((result: ReadResult) => void) | undefined;
    const streamed = readerRequest(
      () => {
        call += 1;
        if (call === 1) return Promise.resolve({ done: false, value: encoder.encode('{') });
        readStarted.resolve(undefined);
        return new Promise<ReadResult>((resolve, reject) => {
          finishRead = resolve;
          controller.signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      },
      {
        signal: controller.signal,
        onCancel: () => finishRead?.({ done: true, value: undefined }),
      },
    );

    const pending = endpoint({ bodyBytes: 128 })(streamed.request);
    await readStarted.promise;
    controller.abort();

    await expectRefusal(pending, 400, 'body');
    expect(streamed.cancel).toHaveBeenCalledOnce();
    expect(streamed.releaseLock).toHaveBeenCalledOnce();
  });

  it('times out a pending body read deterministically and cancels the reader', async () => {
    vi.useFakeTimers();
    let finishRead: ((result: ReadResult) => void) | undefined;
    const streamed = readerRequest(
      () =>
        new Promise<ReadResult>((resolve) => {
          finishRead = resolve;
        }),
      { onCancel: () => finishRead?.({ done: true, value: undefined }) },
    );
    const pending = endpoint({ bodyBytes: 128, timeoutMs: 25 })(streamed.request);

    await vi.advanceTimersByTimeAsync(26);
    const unsettled = Symbol('body read did not settle after its deadline');
    const result = await Promise.race([pending, Promise.resolve(unsettled)]);
    if (result === unsettled) throw new Error('body read did not settle after its deadline');

    await expectRefusal(Promise.resolve(result), 408, 'body');
    expect(streamed.cancel).toHaveBeenCalledOnce();
    expect(streamed.releaseLock).toHaveBeenCalledOnce();
  });

  it('uses one total body-read deadline instead of resetting it after each chunk', async () => {
    vi.useFakeTimers();
    const streamed = readerRequest(
      () =>
        new Promise<ReadResult>((resolve) => {
          setTimeout(() => resolve({ done: false, value: Uint8Array.of(0x20) }), 10);
        }),
    );
    const pending = endpoint({ bodyBytes: 128, timeoutMs: 25 })(streamed.request);

    await vi.advanceTimersByTimeAsync(26);

    await expectRefusal(pending, 408, 'body');
    expect(streamed.read).toHaveBeenCalledTimes(3);
    expect(streamed.cancel).toHaveBeenCalledWith('timed-out');
    expect(streamed.releaseLock).toHaveBeenCalledOnce();
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['zero', 0],
    ['fractional', 1.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ] as const)('rejects a %s bodyBytes configuration synchronously', (_label, bodyBytes) => {
    expect(() => endpoint({ bodyBytes })).toThrow(/bodyBytes/u);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['zero', 0],
    ['fractional', 1.5],
    ['timer overflow', 2_147_483_648],
  ] as const)('rejects a %s timeoutMs configuration synchronously', (_label, timeoutMs) => {
    expect(() => endpoint({ timeoutMs })).toThrow(/timeoutMs/u);
  });

  it('keeps invalid JSON under the byte cap distinct from an oversized body', async () => {
    const raw = '{"fragment":';
    const response = await endpoint({ bodyBytes: encoder.encode(raw).byteLength })(
      textRequest(raw),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'shape' });
  });
});

describe('createFragmentEndpointHandler — body edges', () => {
  it('keeps a drained over-limit body a 413 when the transport fails after the cap', async () => {
    let call = 0;
    const streamed = readerRequest(() => {
      call += 1;
      return call === 1
        ? Promise.resolve({ done: false, value: encoder.encode(validJson('x'.repeat(80))) })
        : Promise.reject(new Error('socket reset while draining'));
    });

    await expectRefusal(endpoint({ bodyBytes: 32 }, 'drain')(streamed.request), 413, 'body');
    expect(streamed.read).toHaveBeenCalledTimes(2);
    expect(render).not.toHaveBeenCalled();
  });

  it('refuses a transport chunk that is not bytes as an unreadable body', async () => {
    const streamed = chunkedRequest([validJson() as unknown as Uint8Array]);

    await expectRefusal(endpoint({ bodyBytes: 128 })(streamed.request), 400, 'body');
    expect(streamed.cancel).toHaveBeenCalledWith('unreadable');
    expect(streamed.releaseLock).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
  });

  it('lets a deadline that passes after a chunk resolved win over consuming that chunk', async () => {
    vi.useFakeTimers();
    const chunk: ReadResult = { done: false, value: encoder.encode(validJson()) };
    // The transport settles the read, then the deadline elapses before the
    // endpoint resumes with that result. The late chunk must not be consumed.
    const settledThenLate = {
      then(resolve: (result: ReadResult) => void) {
        resolve(chunk);
        void Promise.resolve().then(() => vi.advanceTimersByTime(25));
      },
    };
    const streamed = readerRequest(() => settledThenLate as unknown as Promise<ReadResult>);

    await expectRefusal(endpoint({ bodyBytes: 128, timeoutMs: 25 })(streamed.request), 408, 'body');
    expect(streamed.read).toHaveBeenCalledOnce();
    expect(streamed.cancel).toHaveBeenCalledWith('timed-out');
    expect(render).not.toHaveBeenCalled();
  });

  it('refuses a JSON request without a body as a malformed fragment request', async () => {
    const request = new Request(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE },
    });

    await expectRefusal(endpoint()(request), 400, 'shape');
    expect(render).not.toHaveBeenCalled();
  });

  it('refuses a request without a content type before reading its body', async () => {
    const request = new Request(ENDPOINT, { method: 'POST', headers: { origin: SITE } });

    await expectRefusal(endpoint()(request), 415, 'content-type');
    expect(render).not.toHaveBeenCalled();
  });

  it('measures the bytes when a zero-padded declared length is longer than the cap', async () => {
    const raw = validJson();

    const response = await endpoint({ bodyBytes: 128 })(
      textRequest(raw, { 'content-length': '0'.repeat(16) }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ html: '<h1>Hello</h1>' });
  });

  it('echoes the boundary key so keyed boundaries sharing one id stay distinct', async () => {
    const raw = JSON.stringify({ ...(JSON.parse(validJson()) as object), key: 'item-2' });

    const response = await endpoint()(textRequest(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ boundary: { id: 'hero', key: 'item-2' } });
  });
});
