/**
 * Exercise the current runtime and real fragment strategy, not a ported algorithm.
 * Only the HTTP peer is local and deterministic. Native Astro/React assertions
 * independently cover hydration and actual rendered revisions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { ISLAND_EVENT, type IslandUpdateDetail } from '@core/islands';
import { createFragmentStrategy } from '@fragment/index';
import type { FragmentRequestBody } from '@/types/fragment-protocol';

const origin = 'https://admin.example.com';
let runtime: LivePreviewRuntime | undefined;
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
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IO);
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
  vi.unstubAllGlobals();
});

describe('PHD-05 fragment completion and island delivery', () => {
  it.each([
    { fragments: false, hydrating: false },
    { fragments: false, hydrating: true },
    { fragments: true, hydrating: false },
    { fragments: true, hydrating: true },
  ])(
    'delivers once with fragments=$fragments and hydrationPending=$hydrating',
    async ({ fragments, hydrating }) => {
      document.body.innerHTML =
        '<main data-payload-owner="collection:articles:7">' +
        '<astro-island ' +
        (hydrating ? 'ssr' : '') +
        '></astro-island>' +
        (fragments
          ? '<section data-payload-fragment="catalog" data-payload-fragment-key="one"></section><section data-payload-fragment="catalog" data-payload-fragment-key="two"></section>'
          : '') +
        '</main>';
      const island = document.querySelector('astro-island')!;
      const received: IslandUpdateDetail[] = [];
      island.addEventListener(ISLAND_EVENT, (event) =>
        received.push((event as CustomEvent<IslandUpdateDetail>).detail),
      );
      const requests: FragmentRequestBody[] = [];
      const emitter = new EventEmitter();
      runtime = new LivePreviewRuntime({
        root: document.querySelector('main')!,
        renderers: {},
        emitter,
        debounceMs: 0,
        enableA11y: false,
        disableVisibilityGate: true,
        scopeBindingsByOwner: true,
        heartbeatMs: 600_000,
        originMatcher: (value) => value === origin,
        readyTargets: [origin],
        strategies: {
          fragment: createFragmentStrategy({
            endpoint: '/payload/fragment',
            fetch: (_url, init) => {
              if (typeof init?.body !== 'string') throw new Error('Expected JSON request');
              const body = JSON.parse(init.body) as FragmentRequestBody;
              requests.push(body);
              return Promise.resolve(
                new Response(
                  JSON.stringify({
                    html: '<h2>Unsaved revision</h2>',
                    boundary: { id: body.fragment, key: body.key },
                    revision: body.revision,
                    metadata: {
                      renderedAt: '2026-09-27T00:00:00.000Z',
                      renderer: 'local-http-peer',
                    },
                  }),
                  { headers: { 'content-type': 'application/json' } },
                ),
              );
            },
          }),
        },
      });
      runtime.start();
      window.dispatchEvent(
        new MessageEvent('message', {
          origin,
          data: {
            type: 'payload-live-preview',
            collectionSlug: 'articles',
            locale: 'de',
            data: { id: 7, title: 'Unsaved revision' },
          },
        }),
      );
      await expect.poll(() => runtime?.inspect().revisions.completed).toBe(1);
      expect(requests).toHaveLength(fragments ? 2 : 0);
      expect(document.querySelectorAll('section h2')).toHaveLength(fragments ? 2 : 0);
      if (hydrating) {
        expect(received).toHaveLength(0);
        // The real observer watches the SSR attribute; native tests delay the
        // actual compiled module instead of manufacturing a hydration event.
        island.removeAttribute('ssr');
      }
      await expect.poll(() => received.length).toBe(1);
      expect(received[0]).toMatchObject({
        revision: 1,
        locale: 'de',
        fields: { id: 7, title: 'Unsaved revision' },
      });
    },
  );
});
