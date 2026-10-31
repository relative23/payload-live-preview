/**
 * Two inline slots on the way from the generated configuration to the runtime:
 * `routeStrategy` says when a route may run, and `subfieldCoverage` says whether
 * the page chose, which decides whether it hears about the 3.0 default.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { bootstrapInlineRuntime } from '@core/runtime';
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
          disableVisibilityGate: true,
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
});

describe('the subfieldCoverage slot', () => {
  const warned = (spy: MockInstance<typeof console.warn>): string[] =>
    spy.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('LP0204'));

  it('leaves the choice open when empty, and LP0204 says so', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = start({});
    await send({ hero: { title: 'T', kicker: 'x' } });
    expect(warned(spy)).toHaveLength(1);
    stop();
  });

  it('counts as a choice when set', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stop = start({ subfieldCoverage: 'descendant' });
    await send({ hero: { title: 'T', kicker: 'x' } });
    expect(warned(spy)).toEqual([]);
    stop();
  });
});
