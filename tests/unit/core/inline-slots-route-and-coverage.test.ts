/**
 * Two inline slots on the way from the generated configuration to the runtime:
 * `routeStrategy` says when a route may run, and `subfieldCoverage` says whether
 * the page chose, which decides whether it hears about the 3.0 default.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
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
