/**
 * Two inline slots on the way from the generated configuration to the runtime:
 * `routeStrategy` says when a route may run, and `subfieldCoverage` says whether
 * the page chose, which decides whether it hears about the 3.0 default.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { markHydrated } from '@core/hydration/hydration-manual';
import { bootstrapInlineRuntime } from '@core/session/runtime';
import { registerRouteRefresh } from '@core/strategies/route-refresh';
import { INLINE_CONFIG_KEYS } from '@/types/inline-config';
import { IO } from './lifecycle-startup-harness';

const ADMIN = 'https://admin.example.com';

function start(given: Partial<Record<(typeof INLINE_CONFIG_KEYS)[number], unknown>>): () => void {
  vi.stubGlobal(
    '__LIVE_PREVIEW_CONFIG__',
    INLINE_CONFIG_KEYS.map(
      (key) =>
        ({
          allowedOrigins: [ADMIN],
          eventSourcePolicy: 'any',
          debounceMs: 0,
          enableVisibilityGate: false,
          ...given,
        })[key as string],
    ),
  );
  const api = bootstrapInlineRuntime();
  return () => {
    api?.destroy();
    delete (window as { __livePreview?: unknown }).__livePreview;
  };
}

async function send(data: Record<string, unknown>): Promise<void> {
  window.dispatchEvent(
    new MessageEvent('message', { origin: ADMIN, data: { type: 'payload-live-preview', data } }),
  );
  await vi.advanceTimersByTimeAsync(1_200);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IntersectionObserver', IO);
  document.body.innerHTML = '<h1 data-payload-field="hero.title">T</h1>';
  // The runtime starts only in a preview context, and a popup's opener is the simplest to give.
  Object.defineProperty(window, 'opener', { value: {}, configurable: true, writable: true });
});
afterEach(() => {
  Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the routeStrategy slot', () => {
  function withRoutePrelude(): { refreshes: () => number } {
    let refreshes = 0;
    vi.stubGlobal('__LIVE_PREVIEW_ROUTE__', {
      createRouteStrategy: () => ({
        plan: () => false,
        refresh: () => {
          refreshes += 1;
          return Promise.resolve('partial');
        },
      }),
    });
    return { refreshes: () => refreshes };
  }

  it.each([
    ['after-save', 0],
    [true, 1],
    [undefined, 1],
  ])('with %s renders the route %i time(s) for an unbound edit', async (slot, expected) => {
    const route = withRoutePrelude();
    const stop = start({ routeStrategy: slot });
    await send({ hero: { title: 'T' }, subtitle: 'a' });
    await send({ hero: { title: 'T' }, subtitle: 'b' });
    expect(route.refreshes()).toBe(expected);
    stop();
  });

  it("with 'router' renders the route after the save, and only where the page lent a refresh", async () => {
    const saved = async (): Promise<void> => {
      window.dispatchEvent(
        new MessageEvent('message', { origin: ADMIN, data: { type: 'payload-document-event' } }),
      );
      await vi.advanceTimersByTimeAsync(1_200);
    };
    const route = withRoutePrelude();
    const stop = start({ routeStrategy: 'router' });
    await send({ hero: { title: 'T' }, subtitle: 'a' });
    await send({ hero: { title: 'T' }, subtitle: 'b' });
    await saved();
    expect(route.refreshes()).toBe(0);

    const lent = registerRouteRefresh(() => Promise.resolve());
    await send({ hero: { title: 'T' }, subtitle: 'c' });
    expect(route.refreshes()).toBe(0);
    await saved();
    expect(route.refreshes()).toBe(1);
    lent();
    stop();
  });
});

/**
 * ADR 0007, row 47: a page a framework hydrates belongs to that framework's
 * router. Whichever value asked for a route strategy, its route is rendered
 * through the refresh the page lent and through nothing else: the strategy's
 * own fetch and morph would write into DOM the framework's reconciler owns.
 */
describe('the route of a page a framework hydrates', () => {
  let refreshes = 0;
  beforeEach(() => {
    refreshes = 0;
    vi.stubGlobal('__LIVE_PREVIEW_ROUTE__', {
      createRouteStrategy: () => ({
        plan: () => false,
        refresh: () => {
          refreshes += 1;
          return Promise.resolve('partial');
        },
      }),
    });
  });
  // No framework commits in these cases; the cap of the hydration wait starts the runtime.
  const committed = (): Promise<unknown> => vi.advanceTimersByTimeAsync(5_100);
  const saved = async (): Promise<void> => {
    window.dispatchEvent(
      new MessageEvent('message', { origin: ADMIN, data: { type: 'payload-document-event' } }),
    );
    await vi.advanceTimersByTimeAsync(1_200);
  };

  it.each(['react', 'vue', 'sveltekit'])(
    'with `true` and %s, an unbound edit reaches the route through a lent refresh alone',
    async (hydration) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const stop = start({ routeStrategy: true, hydration });
      await committed();
      // The first update is what the page shows; the second is the edit.
      await send({ hero: { title: 'T' }, subtitle: 'a' });
      await send({ hero: { title: 'T' }, subtitle: 'b' });
      expect(refreshes).toBe(0);
      expect(
        warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('LP0808')),
      ).toEqual([expect.stringContaining('the page lent no route refresh')]);

      const lent = registerRouteRefresh(() => Promise.resolve());
      await send({ hero: { title: 'T' }, subtitle: 'c' });
      expect(refreshes).toBe(1);
      lent();
      stop();
    },
  );

  it("with `'after-save'` it waits for the save as before, and for the lent refresh as well", async () => {
    const stop = start({ routeStrategy: 'after-save', hydration: 'react' });
    await committed();
    await send({ hero: { title: 'T' }, subtitle: 'a' });
    await send({ hero: { title: 'T' }, subtitle: 'b' });
    await saved();
    expect(refreshes).toBe(0);

    const lent = registerRouteRefresh(() => Promise.resolve());
    await send({ hero: { title: 'T' }, subtitle: 'c' });
    expect(refreshes).toBe(0);
    await saved();
    expect(refreshes).toBe(1);
    lent();
    stop();
  });

  it("leaves `hydration: 'manual'` to the strategy: the page named no framework that owns its DOM", async () => {
    const stop = start({ routeStrategy: true, hydration: 'manual' });
    markHydrated();
    await send({ hero: { title: 'T' }, subtitle: 'a' });
    await send({ hero: { title: 'T' }, subtitle: 'b' });
    expect(refreshes).toBe(1);
    stop();
  });
});

describe('the subfieldCoverage slot', () => {
  // The page binds `hero.title`; `hero.kicker` is the sibling no binding names.
  const named = (spy: MockInstance<typeof console.warn>): string[] =>
    spy.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('hero.kicker'));

  it('is the declared rule when empty: the uncovered sibling is named (ADR 0007, row 17)', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = start({});
    await send({ hero: { title: 'T', kicker: 'x' } });
    expect(named(spy)).toHaveLength(1);
    expect(named(spy)[0]).toContain('LP0203: field "hero.kicker" has a value and no');
    stop();
  });

  it("carries `'descendant'`, where the bound title covers its group", async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = start({ subfieldCoverage: 'descendant' });
    await send({ hero: { title: 'T', kicker: 'x' } });
    expect(named(spy)).toEqual([]);
    stop();
  });
});
