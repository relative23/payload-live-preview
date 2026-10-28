import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataMerger } from '@core/data-merger';
import { DocumentSession } from '@adapters/shared/document-session';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { buildBuiltinRenderers } from '@field-types/index';

/**
 * A Payload 3 merge request that never answers, held for ten simulated
 * minutes. Fragment renders and route refreshes have deadlines of their own;
 * the REST merge has none, and docs/options.md says so. These cases pin what
 * each consumer of DataMerger shows by then, so a deadline added later changes
 * them on purpose.
 */

const ADMIN = 'https://admin.example.com';
const SERVER = 'https://cms.example.com';
const TEN_MINUTES = 10 * 60_000;

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

  it('keeps the hook session loading, on its first document and without an error', async () => {
    const { fetchFn } = hangingFetch();
    const session = new DocumentSession(
      { id: '1', title: 'From the server' },
      { serverURL: SERVER, allowedOrigins: [ADMIN], eventSourcePolicy: 'any', fetchFn },
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
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    const { isLoading, status, revision, data, error } = session.getSnapshot();
    expect({ isLoading, status, revision, title: data.title, error }).toEqual({
      isLoading: true,
      status: 'idle',
      revision: 0,
      title: 'From the server',
      error: undefined,
    });
    stop();
  });

  it('leaves the DOM runtime on a pending revision with its text unwritten', async () => {
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
      renderers: buildBuiltinRenderers(),
      originMatcher: (origin) => origin === ADMIN,
      readyTargets: [ADMIN],
      emitter,
      debounceMs: 0,
      heartbeatMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
      warn: () => {},
      dataMerge: { serverURL: SERVER, fetchFn },
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
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    const { revisions } = runtime.inspect();
    expect({
      title: document.querySelector('h1')?.textContent,
      reported: states,
      accepted: revisions.accepted,
      completed: revisions.completed,
      active: revisions.active,
      display: revisions.display?.state,
    }).toEqual({
      title: 'From the server',
      reported: [],
      accepted: 1,
      completed: 0,
      active: 1,
      display: 'pending',
    });
    runtime.destroy();
  });
});
