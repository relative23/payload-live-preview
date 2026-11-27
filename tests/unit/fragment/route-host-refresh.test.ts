/**
 * The route strategy when the host lends it its own refresh: no request and
 * no morph of its own, and a refresh that returns no promise named once
 * (LP0810, ADR 0028). Moved out of route.test.ts, which reached its limit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRouteStrategy } from '@fragment/index';
import type { RouteContext } from '@core/strategies/strategies';
import { registerRouteRefresh, type RouteRefresh } from '@core/strategies/route-refresh';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const logs: string[] = [];

function context(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    revision: 3,
    receivedAt: 1,
    signal: new AbortController().signal,
    isCurrent: () => true,
    log: (code, detail) => {
      logs.push(`${code} ${detail}`);
    },
    ...overrides,
  };
}

function html(body: string): Response {
  return new Response(
    `<!doctype html><html><head><title>Fresh</title></head><body>${body}</body></html>`,
    {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  );
}

const BASE = {
  location: { href: 'https://site.example.com/' },
  window: { scrollX: 0, scrollY: 0, scrollTo: () => {} },
  minIntervalMs: 0,
};

/**
 * LP-6: on a page whose DOM belongs to a reconciler, morphing fresh HTML into
 * it is working against the framework — once observed as `removeChild` on
 * `null` inside React's commit phase. A host that lends the runtime its own
 * refresh gets that instead, and the HTML request disappears with the morph.
 */
describe('refresh — a host that owns its own DOM', () => {
  afterEach(() => {
    (window as unknown as Record<string, unknown>)['__livePreviewRouteRefresh'] = undefined;
  });

  it('runs the registered refresh, waits for it, and makes no request of its own', async () => {
    const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(html('<p>fetched</p>')));
    document.body.innerHTML = '<p data-testid="layout">old</p>';
    let settle = (): void => {};
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = () => {
            document.querySelector('[data-testid="layout"]')!.textContent = 'router render';
            resolve();
          };
        }),
    );
    registerRouteRefresh(refresh);
    const strategy = createRouteStrategy({ ...BASE, fetch: fetchFn });
    const pending = strategy.refresh(context());
    await Promise.resolve();
    // Nothing has been reported yet: the runtime re-applies the revision on the
    // fresh markup, so it may not hear "refreshed" before the markup is there.
    expect(document.querySelector('[data-testid="layout"]')?.textContent).toBe('old');
    settle();
    expect(await pending).toBe('partial');
    expect(document.querySelector('[data-testid="layout"]')?.textContent).toBe('router render');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reports a registered refresh that throws as LP0801 and does not fall back to a fetch', async () => {
    logs.length = 0;
    const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(html('<p>fetched</p>')));
    registerRouteRefresh(() => {
      throw new Error('router exploded');
    });
    const strategy = createRouteStrategy({ ...BASE, fetch: fetchFn });
    expect(await strategy.refresh(context())).toBe('failed');
    expect(logs.at(-1)).toBe('LP0801 router exploded');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches again once the registration is undone', async () => {
    const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(html('<p>fetched</p>')));
    document.body.innerHTML = '<p data-testid="layout">old</p>';
    const undo = registerRouteRefresh(() => Promise.resolve());
    undo();
    const strategy = createRouteStrategy({ ...BASE, fetch: fetchFn });
    expect(await strategy.refresh(context())).toBe('partial');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('counts a refresh that returns no promise as failed, and says so once as LP0810 (H15, row 23)', async () => {
    logs.length = 0;
    const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(html('<p>fetched</p>')));
    // Next's router.refresh() starts a transition and returns nothing: the
    // commit lands later. The type refuses such a function since 3.0; this is
    // what a JavaScript caller can still register.
    const hostRefresh = vi.fn(() => undefined);
    registerRouteRefresh(hostRefresh as unknown as RouteRefresh);
    const strategy = createRouteStrategy({ ...BASE, fetch: fetchFn });

    const said = [
      'LP0810 route refresh returned no promise, so its commit cannot be waited for; ' +
        'counted as failed (see LivePreviewRouteRefresh)',
    ];
    const lines = (): string[] => logs.filter((line) => line.startsWith('LP0810'));

    // Until 3.0 both were `partial`: taken as committed when the call returned.
    expect(await strategy.refresh(context())).toBe('failed');
    // Said with the first refresh that could not be waited for, and not again.
    expect(lines()).toEqual(said);
    expect(await strategy.refresh(context())).toBe('failed');
    expect(lines()).toEqual(said);

    expect(hostRefresh).toHaveBeenCalledTimes(2);
    // The host owns the route: its failure is not answered with a fetch and a morph over its DOM.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('stays quiet for a refresh that returns a promise', async () => {
    logs.length = 0;
    registerRouteRefresh(() => Promise.resolve());
    const strategy = createRouteStrategy(BASE);

    expect(await strategy.refresh(context())).toBe('partial');
    expect(logs.filter((line) => line.startsWith('LP0810'))).toEqual([]);
  });
});
