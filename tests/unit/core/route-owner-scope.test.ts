import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { RoutePlanContext, RouteStrategy } from '@core/strategies';
import type { FieldRenderer } from '@core/types';
import { createRouteStrategy } from '@fragment/route';

/**
 * Owner scoping and the route (PHD-02). With `scopeBindingsByOwner` an update
 * reaches only what the document it names owns, but the route planner and the
 * route-binding check saw the whole page: a route marker or a route binding
 * another document owns asked for a refresh of this document's edit, one more
 * GET of the route that changed nothing the editor could see.
 */

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
const TRUSTED = 'https://admin.example.com';
let emitter: EventEmitter;
let runtime: LivePreviewRuntime | undefined;
const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    target.element.textContent = String(value);
  },
};
const OWN =
  '<section data-payload-owner="global:home"><h1 data-payload-field="title">Saved</h1></section>';

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', data, globalSlug: 'home' },
      origin: TRUSTED,
    }),
  );
}
function patched(): Promise<void> {
  return new Promise((resolve) => {
    const listener = (event: { source?: unknown }): void => {
      if (event.source !== 'patch') return;
      emitter.off('afterUpdate', listener);
      resolve();
    };
    emitter.on('afterUpdate', listener);
  });
}
function start(route: RouteStrategy, scopeBindingsByOwner: boolean): LivePreviewRuntime {
  runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: () => {},
    log: () => {},
    scopeBindingsByOwner,
    strategies: { route },
  });
  runtime.start();
  return runtime;
}
/** The package's route strategy against a server that renders the page as it is. */
function servedRoute(): { route: RouteStrategy; fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      text: () =>
        Promise.resolve(
          `<!doctype html><html><head><title>Page</title></head><body>${document.body.innerHTML}</body></html>`,
        ),
    } as unknown as Response),
  );
  const route = createRouteStrategy({
    fetch,
    minIntervalMs: 0,
    window: { scrollX: 0, scrollY: 0, scrollTo: () => {} },
  });
  return { route, fetch };
}
/**
 * One message that changes `title`, as the first one after connecting may: it
 * can carry unsaved values, so it plans a refresh like any later one.
 */
async function editTitle(): Promise<void> {
  const edited = patched();
  post({ title: 'Unsaved' });
  await edited;
  // A refresh, if one was planned, starts in the same turn as the patch.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
  document.body.innerHTML = '';
});

describe('the default route planner under owner scoping', () => {
  it('refreshes for a route marker the edited document owns', async () => {
    document.body.innerHTML =
      OWN +
      '<section data-payload-owner="global:home"><aside data-payload-strategy="route" data-payload-depends="title">own</aside></section>';
    const { route, fetch } = servedRoute();
    start(route, true);
    await editTitle();
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
  });

  it('does not refresh for a route marker another document owns', async () => {
    document.body.innerHTML =
      OWN +
      '<section data-payload-owner="global:other"><aside data-payload-strategy="route" data-payload-depends="title">foreign</aside></section>';
    const { route, fetch } = servedRoute();
    start(route, true);
    await editTitle();
    expect(document.querySelector('h1')?.textContent).toBe('Unsaved');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not refresh for an unowned route marker', async () => {
    // A binding without an owner is never updated while scoping is on.
    document.body.innerHTML =
      OWN + '<aside data-payload-strategy="route" data-payload-depends="title">unowned</aside>';
    const { route, fetch } = servedRoute();
    start(route, true);
    await editTitle();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('still refreshes for a marker anywhere while scoping is off', async () => {
    document.body.innerHTML =
      OWN +
      '<section data-payload-owner="global:other"><aside data-payload-strategy="route" data-payload-depends="title">foreign</aside></section>';
    const { route, fetch } = servedRoute();
    start(route, false);
    await editTitle();
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
  });
});

describe('a route binding under owner scoping', () => {
  it('does not refresh for a route binding another document owns', async () => {
    // A planner that answers no by itself: only the route-binding check is left.
    document.body.innerHTML =
      OWN +
      '<section data-payload-owner="global:other"><span data-payload-field="title" data-payload-strategy="route">foreign</span></section>';
    const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('refreshed');
    start({ plan: () => false, refresh }, true);
    await editTitle();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes for a route binding the edited document owns', async () => {
    document.body.innerHTML =
      OWN +
      '<section data-payload-owner="global:home"><span data-payload-field="title" data-payload-strategy="route">own</span></section>';
    const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('refreshed');
    start({ plan: () => false, refresh }, true);
    await editTitle();
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledOnce();
    });
  });
});

describe('a custom route planner', () => {
  it('is told which elements are in the update scope', async () => {
    document.body.innerHTML =
      OWN +
      '<section data-payload-owner="global:other"><aside id="foreign">x</aside></section><aside id="unowned">y</aside>';
    const contexts: RoutePlanContext[] = [];
    const plan = vi.fn(
      (_root: ParentNode, _changed: ReadonlySet<string>, context?: RoutePlanContext) => {
        if (context !== undefined) contexts.push(context);
        return false;
      },
    );
    start({ plan, refresh: vi.fn<RouteStrategy['refresh']>() }, true);
    await editTitle();
    const [context] = contexts;
    expect(context?.inScope(document.querySelector('h1')!)).toBe(true);
    expect(context?.inScope(document.getElementById('foreign')!)).toBe(false);
    expect(context?.inScope(document.getElementById('unowned')!)).toBe(false);
  });

  it('is told every element is in scope while scoping is off', async () => {
    document.body.innerHTML =
      OWN + '<section data-payload-owner="global:other"><aside id="foreign">x</aside></section>';
    const contexts: RoutePlanContext[] = [];
    const plan = vi.fn(
      (_root: ParentNode, _changed: ReadonlySet<string>, context?: RoutePlanContext) => {
        if (context !== undefined) contexts.push(context);
        return false;
      },
    );
    start({ plan, refresh: vi.fn<RouteStrategy['refresh']>() }, false);
    await editTitle();
    expect(contexts[0]?.inScope(document.getElementById('foreign')!)).toBe(true);
  });
});
