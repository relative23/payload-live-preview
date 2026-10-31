import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataMerger, type MergeResult } from '@core/data-merger';
import { DocumentSession } from '@adapters/shared/document-session';
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

beforeEach(() => {
  vi.useFakeTimers();
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
