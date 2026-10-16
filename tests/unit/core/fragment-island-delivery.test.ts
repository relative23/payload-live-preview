/**
 * Fragment work must not starve page-owned islands or duplicate their snapshot.
 * The real runtime and HTTP fragment strategy share controlled responses, so
 * delivery, fallback writes and revision completion are observed separately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { ISLAND_EVENT, type IslandUpdateDetail } from '@core/islands';
import type { FragmentStrategy } from '@core/strategies';
import { createFragmentStrategy } from '@fragment/index';
import type { FragmentRequestBody } from '@/types/fragment-protocol';

const ORIGIN = 'https://admin.example.com';
class IO implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
interface Pending {
  body: FragmentRequestBody;
  signal: AbortSignal | null | undefined;
  resolve: (response: Response) => void;
  reject: (reason: Error) => void;
}
let runtime: LivePreviewRuntime | undefined;
let emitter: EventEmitter;
let pending: Pending[];
let received: Map<string, IslandUpdateDetail[]>;
let patches: number;

function post(title: string, locale = 'de'): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: ORIGIN,
      data: {
        type: 'payload-live-preview',
        collectionSlug: 'articles',
        locale,
        data: { id: 7, title },
      },
    }),
  );
}
function start(
  options: { outside?: boolean; hydrating?: boolean; strategy?: FragmentStrategy } = {},
): LivePreviewRuntime {
  const marker = options.hydrating === true ? ' ssr' : '';
  document.body.innerHTML =
    '<main data-payload-owner="collection:articles:7">' +
    '<astro-island id="first"' +
    marker +
    '></astro-island>' +
    '<astro-island id="second"' +
    marker +
    '></astro-island>' +
    '<astro-island id="foreign" data-payload-owner="collection:articles:8"></astro-island>' +
    '<astro-island id="unowned" data-payload-owner=""></astro-island>' +
    '<section data-payload-fragment="catalog" data-payload-fragment-key="one" data-payload-depends="title"><h2 data-payload-field="title">saved</h2></section>' +
    '<section data-payload-fragment="catalog" data-payload-fragment-key="two" data-payload-depends="title"><h2 data-payload-field="title">saved</h2></section>' +
    (options.outside === true ? '<p data-payload-field="title">saved</p>' : '') +
    '</main>';
  for (const island of document.querySelectorAll('astro-island')) {
    const events: IslandUpdateDetail[] = [];
    received.set(island.id, events);
    island.addEventListener(ISLAND_EVENT, (event) => {
      events.push((event as CustomEvent<IslandUpdateDetail>).detail);
    });
  }
  runtime = new LivePreviewRuntime({
    root: document.querySelector('main')!,
    renderers: {
      text: {
        name: 'text',
        render: (target, value) => {
          target.element.textContent = String(value);
        },
      },
    },
    emitter,
    debounceMs: 0,
    enableA11y: false,
    autoBind: 'off',
    disableVisibilityGate: true,
    scopeBindingsByOwner: true,
    heartbeatMs: 600_000,
    originMatcher: (value) => value === ORIGIN,
    readyTargets: [ORIGIN],
    warn: () => {},
    strategies: {
      fragment:
        options.strategy ??
        createFragmentStrategy({
          endpoint: '/payload/fragment',
          fetch: (_url, init) => {
            if (typeof init?.body !== 'string') throw new Error('Expected JSON request');
            const body = JSON.parse(init.body) as FragmentRequestBody;
            return new Promise<Response>((resolve, reject) => {
              pending.push({ body, signal: init.signal, resolve, reject });
            });
          },
        }),
    },
  });
  runtime.start();
  return runtime;
}
function settle(requests: readonly Pending[], status = 200): void {
  for (const request of requests) {
    request.resolve(
      new Response(
        JSON.stringify({
          html:
            '<h2 data-payload-field="title">Server: ' +
            String(request.body.fields['title']) +
            '</h2>',
          boundary: { id: request.body.fragment, key: request.body.key },
          revision: request.body.revision,
          metadata: { renderedAt: '2026-09-27T00:00:00.000Z', renderer: 'local-http-peer' },
        }),
        { status, headers: { 'content-type': 'application/json' } },
      ),
    );
  }
}
async function finished(count = 1): Promise<void> {
  await expect.poll(() => runtime?.inspect().revisions.completed).toBe(count);
}
function titles(id = 'first'): unknown[] {
  return received.get(id)!.map((event) => event.fields['title']);
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IO);
  emitter = new EventEmitter();
  pending = [];
  received = new Map();
  patches = 0;
  emitter.on('afterUpdate', (event) => {
    if (event.source === 'patch') patches += event.updatedCount;
  });
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
  vi.unstubAllGlobals();
});

describe('fragment-only island handoff', () => {
  it.each([
    { outside: false, hydrating: false },
    { outside: false, hydrating: true },
    { outside: true, hydrating: false },
    { outside: true, hydrating: true },
  ])(
    'delivers before fragment settlement, outside=$outside, hydrating=$hydrating',
    async (options) => {
      const rt = start(options);
      post('unsaved');
      await expect.poll(() => pending.length).toBe(2);
      if (options.outside) {
        await expect.poll(() => document.querySelector('p')?.textContent).toBe('unsaved');
      }
      if (options.hydrating) {
        expect(titles()).toEqual([]);
        for (const island of document.querySelectorAll('astro-island[ssr]')) {
          island.removeAttribute('ssr');
        }
      }
      await expect.poll(() => titles()).toEqual(['unsaved']);
      expect(titles('second')).toEqual(['unsaved']);
      expect(titles('foreign')).toEqual([]);
      expect(titles('unowned')).toEqual([]);
      expect(received.get('first')![0]).toMatchObject({
        revision: 1,
        locale: 'de',
        fields: { id: 7 },
      });
      expect(rt.inspect().revisions.completed).toBe(0);
      settle(pending);
      await finished();
      expect([...document.querySelectorAll('h2')].map((node) => node.textContent)).toEqual([
        'Server: unsaved',
        'Server: unsaved',
      ]);
      expect(titles()).toEqual(['unsaved']);
      expect(titles('second')).toEqual(['unsaved']);
    },
  );

  it.each(['refused', 'rejected'] as const)(
    'does not duplicate a snapshot when a $0 fragment falls back to patch',
    async (outcome) => {
      start();
      post('fallback');
      await expect.poll(() => titles()).toEqual(['fallback']);
      expect(patches).toBe(0);
      if (outcome === 'refused') settle(pending, 403);
      else for (const request of pending) request.reject(new Error('offline'));
      await finished();
      await expect.poll(() => patches).toBe(2);
      expect([...document.querySelectorAll('h2')].map((node) => node.textContent)).toEqual([
        'fallback',
        'fallback',
      ]);
      expect(titles()).toEqual(['fallback']);
      expect(titles('second')).toEqual(['fallback']);
    },
  );

  it('does not duplicate a snapshot after a synchronous throwing strategy schedules fallback patches', async () => {
    start({
      strategy: {
        plan: (root) => [...root.querySelectorAll('[data-payload-fragment]')],
        render: () => {
          throw new Error('custom renderer failed');
        },
      },
    });
    post('synchronous fallback');
    await expect.poll(() => patches).toBe(2);
    await finished();
    expect(titles()).toEqual(['synchronous fallback']);
    expect(titles('second')).toEqual(['synchronous fallback']);
  });

  it('drops an older completion after a newer revision has already reached the islands', async () => {
    start();
    post('older');
    await expect.poll(() => titles()).toEqual(['older']);
    const old = [...pending];
    post('newer', 'fr');
    await expect.poll(() => titles()).toEqual(['older', 'newer']);
    expect(old.every((request) => request.signal?.aborted)).toBe(true);
    settle(pending.slice(2));
    await finished();
    settle(old);
    await expect.poll(() => runtime?.inspect().fragments.superseded).toBe(2);
    expect(titles()).toEqual(['older', 'newer']);
    expect(titles('second')).toEqual(['older', 'newer']);
    expect(received.get('second')![1]).toMatchObject({ revision: 2, locale: 'fr' });
    expect([...document.querySelectorAll('h2')].map((node) => node.textContent)).toEqual([
      'Server: newer',
      'Server: newer',
    ]);
  });

  it('stops the old fanout when the first island accepts a newer revision', async () => {
    start();
    document.getElementById('first')!.addEventListener(ISLAND_EVENT, (event) => {
      if ((event as CustomEvent<IslandUpdateDetail>).detail.fields['title'] === 'older') {
        post('newer');
      }
    });
    post('older');
    await expect.poll(() => titles('second')).toEqual(['newer']);
    expect(titles()).toEqual(['older', 'newer']);
    expect(pending.slice(0, 2).every((request) => request.signal?.aborted)).toBe(true);
    settle(pending);
    await finished();
    expect(titles('second')).toEqual(['newer']);
  });

  it.each(['destroy', 'suspend'] as const)(
    'stops fanout and pending fragments on reentrant $0',
    async (action) => {
      const rt = start();
      document.getElementById('first')!.addEventListener(ISLAND_EVENT, () => {
        rt[action]();
      });
      post('stop');
      await expect.poll(() => titles()).toEqual(['stop']);
      expect(titles('second')).toEqual([]);
      expect(pending.every((request) => request.signal?.aborted)).toBe(true);
      settle(pending);
      await expect.poll(() => rt.inspect().fragments.superseded).toBe(2);
      expect(titles('second')).toEqual([]);
      expect([...document.querySelectorAll('h2')].map((node) => node.textContent)).toEqual([
        'saved',
        'saved',
      ]);
    },
  );

  it('cancels before planning without notifying an island and permits the next revision', async () => {
    start();
    let cancelled = false;
    emitter.on('beforeUpdate', (event) => {
      if (event.data.fields['title'] === 'cancel') {
        event.cancel();
        cancelled = true;
      }
    });
    post('cancel');
    await expect.poll(() => cancelled).toBe(true);
    expect(pending).toEqual([]);
    expect(titles()).toEqual([]);
    // A later approved message proves the cancelled one left no queued work.
    post('approved');
    await expect.poll(() => titles()).toEqual(['approved']);
    expect(pending).toHaveLength(2);
    expect(pending.every((request) => request.body.revision === 2)).toBe(true);
    settle(pending);
    await finished();
    expect(titles('second')).toEqual(['approved']);
  });

  it('keeps the normal patch flush as the single delivery point when fragments fail later', async () => {
    start({ outside: true });
    post('mixed');
    await expect.poll(() => patches).toBe(1);
    expect(titles()).toEqual(['mixed']);
    settle(pending, 403);
    await expect.poll(() => patches).toBe(3);
    await finished();
    expect(titles()).toEqual(['mixed']);
    expect(titles('second')).toEqual(['mixed']);
  });

  it.each(['destroy', 'suspend'] as const)(
    'does not complete a revision when a throwing strategy reenters $0',
    async (action) => {
      const rt = start({
        strategy: {
          plan: (root) => [...root.querySelectorAll('[data-payload-fragment]')],
          render: () => {
            runtime![action]();
            throw new Error('stopped before handoff');
          },
        },
      });
      post('stopped in strategy');
      await expect.poll(() => rt.inspect().revisions.accepted).toBe(1);
      expect(rt.inspect().revisions.completed).toBe(0);
      expect(titles()).toEqual([]);
      expect(titles('second')).toEqual([]);
    },
  );
});
