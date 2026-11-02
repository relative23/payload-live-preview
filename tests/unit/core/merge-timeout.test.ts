import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataMerger, type MergeResult } from '@core/data-merger';
import { DocumentSession } from '@adapters/shared/document-session';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { LivePreviewClient } from '@/client/index';
import { bootstrapInlineRuntime } from '@core/runtime';
import { buildBuiltinRenderers } from '@field-types/index';
import { INLINE_CONFIG_KEYS } from '@/types/inline-config';
import { parseFieldSchema } from '@schema/parser';
import { jsonResponse } from './data-merger-harness';

/**
 * The opt-in merge deadline. Without one a merge that never answers stays in
 * flight (merge-without-deadline.test.ts); with `timeoutMs` it is aborted and
 * reported as unavailable, and an answer that comes later changes nothing.
 */

const ADMIN = 'https://admin.example.com';
const SERVER = 'https://cms.example.com';
const TEN_MINUTES = 10 * 60_000;

/** A fetch that never settles, whatever its signal does, and remembers the signals. */
function hangingFetch(): { fetchFn: typeof fetch; signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  const fetchFn = ((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  return { fetchFn, signals };
}

function settledWith(promise: Promise<MergeResult>): { result: MergeResult | undefined } {
  const box: { result: MergeResult | undefined } = { result: undefined };
  void promise.then((result) => {
    box.result = result;
  });
  return box;
}

class IO implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DataMerger with timeoutMs', () => {
  it('aborts a merge that has not answered by the deadline and reports it unavailable', async () => {
    const { fetchFn, signals } = hangingFetch();
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, log, timeoutMs: 5_000 });
    const box = settledWith(
      merger.merge({ collectionSlug: 'pages', data: { id: '1', title: 'x' } }),
    );
    await vi.advanceTimersByTimeAsync(4_999);
    expect({ result: box.result, aborted: signals[0]?.aborted }).toEqual({
      result: undefined,
      aborted: false,
    });
    await vi.advanceTimersByTimeAsync(1);
    expect({ result: box.result, aborted: signals[0]?.aborted }).toEqual({
      result: { status: 'unavailable' },
      aborted: true,
    });
    expect(log).toHaveBeenCalledWith('merge timeout', 5_000);
  });

  it('names the deadline when the fetch rejects at the moment it is aborted', async () => {
    const fetchFn = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      })) as typeof fetch;
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, log, timeoutMs: 5_000 });
    const box = settledWith(
      merger.merge({ collectionSlug: 'pages', data: { id: '1', title: 'x' } }),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(box.result).toEqual({ status: 'unavailable' });
    expect(log).toHaveBeenCalledWith('merge timeout', 5_000);
    expect(log).not.toHaveBeenCalledWith('merge exception', expect.anything());
  });

  it('counts the body against the same deadline as the request', async () => {
    // The server answers after 3 s, and its JSON body never arrives.
    const signals: AbortSignal[] = [];
    const fetchFn = ((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            status: 200,
            json: () => new Promise<unknown>(() => undefined),
          } as unknown as Response);
        }, 3_000);
      });
    }) as typeof fetch;
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, timeoutMs: 5_000 });
    const box = settledWith(merger.merge({ collectionSlug: 'pages', data: { id: '1' } }));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(box.result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect({ result: box.result, aborted: signals[0]?.aborted }).toEqual({
      result: { status: 'unavailable' },
      aborted: true,
    });
  });

  it('bounds the Payload 2 population reads the same way', async () => {
    const { fetchFn, signals } = hangingFetch();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, timeoutMs: 5_000 });
    const schema = parseFieldSchema([
      { name: 'author', type: 'relationship', relationTo: 'authors' },
    ]);
    const box = settledWith(merger.merge({ schema, data: { author: 'A' } }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect({ result: box.result, aborted: signals[0]?.aborted }).toEqual({
      result: { status: 'unavailable' },
      aborted: true,
    });
  });

  it('merges an answer that comes in time and aborts nothing afterwards', async () => {
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return Promise.resolve(jsonResponse({ id: '1', title: 'Merged' }));
    });
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, timeoutMs: 5_000 });
    const result = await merger.merge({ collectionSlug: 'pages', data: { id: '1', title: 'x' } });
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    expect(result).toEqual({ status: 'merged', doc: { id: '1', title: 'Merged' } });
    expect(signals[0]?.aborted).toBe(false);
  });

  it('gives a newer merge its own deadline, which the older one cannot spend', async () => {
    const { fetchFn, signals } = hangingFetch();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, timeoutMs: 5_000 });
    const older = settledWith(merger.merge({ collectionSlug: 'pages', data: { id: '1' } }));
    await vi.advanceTimersByTimeAsync(3_000);
    const newer = settledWith(merger.merge({ collectionSlug: 'pages', data: { id: '1' } }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect({ older: older.result, newer: newer.result, aborted: signals[1]?.aborted }).toEqual({
      older: { status: 'superseded' },
      newer: undefined,
      aborted: false,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(newer.result).toEqual({ status: 'unavailable' });
  });

  it('sets no deadline for a timeoutMs that is not a positive finite number', async () => {
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { fetchFn, signals } = hangingFetch();
      const merger = new DataMerger({ serverURL: SERVER, fetchFn, timeoutMs });
      const box = settledWith(merger.merge({ collectionSlug: 'pages', data: { id: '1' } }));
      await vi.advanceTimersByTimeAsync(TEN_MINUTES);
      expect({ timeoutMs, result: box.result, aborted: signals[0]?.aborted }).toEqual({
        timeoutMs,
        result: undefined,
        aborted: false,
      });
      merger.destroy();
    }
  });
});

describe('a hook session with timeoutMs', () => {
  it('reports the update unavailable, keeps its document and names the deadline', async () => {
    const { fetchFn } = hangingFetch();
    const session = new DocumentSession(
      { id: '1', title: 'From the server' },
      {
        serverURL: SERVER,
        allowedOrigins: [ADMIN],
        eventSourcePolicy: 'any',
        fetchFn,
        timeoutMs: 5_000,
      },
    );
    const stop = session.subscribe(() => {});
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ADMIN,
        source: window.parent,
        data: {
          type: 'payload-live-preview',
          collectionSlug: 'pages',
          data: { id: '1', title: 'Typed' },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    const { isLoading, status, revision, data, error } = session.getSnapshot();
    expect({ isLoading, status, revision, title: data.title, error: error?.message }).toEqual({
      isLoading: false,
      status: 'unavailable',
      revision: 0,
      title: 'From the server',
      error: 'live preview: the server did not answer within 5000 ms',
    });
    stop();
  });
});

describe('the DOM runtime with a merge deadline', () => {
  /** What the runtime shows after one update with a relation, an hour after it arrived. */
  async function settledAfter(dataMerge: { fetchFn: typeof fetch; timeoutMs?: number }) {
    document.body.innerHTML = `
      <h1 data-payload-field="title">From the server</h1>
      <span data-payload-field="author" data-payload-type="relationship">Ada</span>`;
    const runtime = new LivePreviewRuntime({
      renderers: buildBuiltinRenderers(),
      originMatcher: (origin) => origin === ADMIN,
      readyTargets: [ADMIN],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
      warn: () => undefined,
      dataMerge: { serverURL: SERVER, ...dataMerge },
    });
    runtime.start();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ADMIN,
        data: {
          type: 'payload-live-preview',
          collectionSlug: 'pages',
          data: { id: '1', title: 'Typed', author: 7 },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(4_999);
    const before = document.querySelector('h1')?.textContent;
    await vi.advanceTimersByTimeAsync(3_600_000);
    const { revisions } = runtime.inspect();
    const settled = {
      title: document.querySelector('h1')?.textContent,
      completed: revisions.completed,
      active: revisions.active,
      display: revisions.display?.state,
    };
    runtime.destroy();
    return { before, settled };
  }

  it('ends where a merge the server refused ends, once the deadline passes', async () => {
    const refused = await settledAfter({
      fetchFn: () => Promise.resolve(jsonResponse({}, 500)),
    });
    const timedOut = await settledAfter({ fetchFn: hangingFetch().fetchFn, timeoutMs: 5_000 });
    expect(timedOut.before).toBe('From the server');
    expect(timedOut.settled).toEqual(refused.settled);
  });
});

describe('mergeTimeoutMs on the way to the merger', () => {
  const message = (): MessageEvent =>
    new MessageEvent('message', {
      origin: ADMIN,
      data: {
        type: 'payload-live-preview',
        collectionSlug: 'pages',
        data: { id: '1', title: 'Typed', author: 7 },
      },
    });

  beforeEach(() => {
    document.body.innerHTML = `
      <h1 data-payload-field="title">From the server</h1>
      <span data-payload-field="author" data-payload-type="relationship">Ada</span>`;
    // Both start only in a preview context, and a popup's opener is the simplest one to give.
    Object.defineProperty(window, 'opener', { value: {}, configurable: true, writable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true });
  });

  it('reaches the merger from LivePreviewClient', async () => {
    const { fetchFn, signals } = hangingFetch();
    const client = new LivePreviewClient({
      allowedOrigins: [ADMIN],
      serverURL: SERVER,
      mergeDepth: 1,
      mergeTimeoutMs: 5_000,
      mergeFetch: fetchFn,
      eventSourcePolicy: 'any',
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    client.start();
    window.dispatchEvent(message());
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    await client.destroy();
  });

  it('reaches the merger from slot 27 of the inline script', async () => {
    const { fetchFn, signals } = hangingFetch();
    vi.stubGlobal('fetch', fetchFn);
    const given: Partial<Record<(typeof INLINE_CONFIG_KEYS)[number], unknown>> = {
      allowedOrigins: [ADMIN],
      serverURL: SERVER,
      mergeDepth: 1,
      mergeTimeoutMs: 5_000,
      eventSourcePolicy: 'any',
      debounceMs: 0,
      disableVisibilityGate: true,
    };
    vi.stubGlobal(
      '__LIVE_PREVIEW_CONFIG__',
      INLINE_CONFIG_KEYS.map((key) => given[key]),
    );
    const api = bootstrapInlineRuntime();
    window.dispatchEvent(message());
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    api?.destroy();
    delete (window as { __livePreview?: unknown }).__livePreview;
    vi.unstubAllGlobals();
  });
});
