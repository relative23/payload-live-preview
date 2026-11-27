import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataMerger } from '@core/merge/data-merger';
import { createDocumentSession } from '@adapters/shared/document-session';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/session/lifecycle';
import { buildBuiltinRenderers } from '@field-types/index';

/**
 * A Payload 3 merge request that never answers. Since 3.0 the hook and the
 * runtime give their merger a deadline of ten seconds (ADR 0007, row 27):
 * these cases hold what each shows one millisecond before it and at it, and
 * that `0` keeps the wait 2.x had, here held for ten simulated minutes. The
 * merger itself has no deadline of its own.
 */

const ADMIN = 'https://admin.example.com';
const SERVER = 'https://cms.example.com';
const TEN_MINUTES = 10 * 60_000;
const DEADLINE = 10_000;

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

/** A fetch that never settles and remembers the signals it was given. */
function hangingFetch(): { fetchFn: typeof fetch; signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  const fetchFn = ((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return new Promise<Response>(() => {});
  }) as typeof fetch;
  return { fetchFn, signals };
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a merge request that never answers', () => {
  it('leaves DataMerger.merge() unsettled after ten minutes, and nothing aborts it', async () => {
    const { fetchFn, signals } = hangingFetch();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    let settled = false;
    void merger.merge({ collectionSlug: 'pages', data: { id: '1', title: 'x' } }).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    expect({ settled, requests: signals.length, aborted: signals[0]?.aborted }).toEqual({
      settled: false,
      requests: 1,
      aborted: false,
    });
    merger.destroy();
  });

  /** A hook session on its first document, with one update whose merge hangs. */
  function hookSession(timeoutMs?: number) {
    const { fetchFn } = hangingFetch();
    const session = createDocumentSession(
      { id: '1', title: 'From the server' },
      {
        document: 'any',
        serverURL: SERVER,
        allowedOrigins: [ADMIN],
        eventSourcePolicy: 'any',
        fetchFn,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
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
    const shown = () => {
      const { isLoading, status, revision, data, error } = session.getSnapshot();
      return { isLoading, status, revision, title: data.title, error: error?.message };
    };
    return { shown, stop };
  }
  const LOADING = {
    isLoading: true,
    status: 'idle',
    revision: 0,
    title: 'From the server',
    error: undefined,
  };

  it("ends the hook session's wait at ten seconds without being told to, on its first document", async () => {
    const { shown, stop } = hookSession();
    await vi.advanceTimersByTimeAsync(DEADLINE - 1);
    expect(shown()).toEqual(LOADING);
    await vi.advanceTimersByTimeAsync(1);
    expect(shown()).toEqual({
      isLoading: false,
      status: 'unavailable',
      revision: 0,
      title: 'From the server',
      error: 'live preview: the server did not answer within 10000 ms',
    });
    stop();
  });

  it('keeps the hook session loading under `timeoutMs: 0`, without an error', async () => {
    const { shown, stop } = hookSession(0);
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    expect(shown()).toEqual(LOADING);
    stop();
  });

  /** A DOM runtime with one update whose merge hangs. */
  function domRuntime(timeoutMs?: number) {
    document.body.innerHTML = `
      <h1 data-payload-field="title">From the server</h1>
      <span data-payload-field="author" data-payload-type="relationship">Ada</span>`;
    const { fetchFn } = hangingFetch();
    const emitter = new EventEmitter();
    const states: string[] = [];
    emitter.on('revisionDisplay', (display: { state: string }) => {
      states.push(display.state);
    });
    const runtime = new LivePreviewRuntime({
      eventSourcePolicy: 'any',
      renderers: buildBuiltinRenderers(),
      originMatcher: (origin) => origin === ADMIN,
      readyTargets: [ADMIN],
      emitter,
      debounceMs: 0,
      heartbeatMs: 0,
      enableVisibilityGate: false,
      enableA11y: false,
      warn: () => {},
      dataMerge: { serverURL: SERVER, fetchFn, ...(timeoutMs === undefined ? {} : { timeoutMs }) },
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
    const shown = () => {
      const { revisions } = runtime.inspect();
      return {
        title: document.querySelector('h1')?.textContent,
        author: document.querySelector('span')?.textContent,
        reported: [...states],
        accepted: revisions.accepted,
        completed: revisions.completed,
        display: revisions.display?.state,
        shortfalls: revisions.display?.shortfalls,
      };
    };
    return { runtime, shown };
  }
  const PENDING = {
    title: 'From the server',
    author: 'Ada',
    reported: [],
    accepted: 1,
    completed: 0,
    display: 'pending',
    shortfalls: [],
  };

  it('writes the raw values into the DOM once ten seconds are over, and says the merge fell short', async () => {
    const { runtime, shown } = domRuntime();
    await vi.advanceTimersByTimeAsync(DEADLINE - 1);
    expect(shown()).toEqual(PENDING);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(shown()).toEqual({
      title: 'Typed',
      author: '7',
      reported: ['partial'],
      accepted: 1,
      completed: 1,
      display: 'partial',
      shortfalls: [{ kind: 'merge' }],
    });
    runtime.destroy();
  });

  it('leaves the DOM runtime on a pending revision with its text unwritten under `timeoutMs: 0`', async () => {
    const { runtime, shown } = domRuntime(0);
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    expect(shown()).toEqual(PENDING);
    runtime.destroy();
  });
});
