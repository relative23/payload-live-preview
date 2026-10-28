import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { RouteStrategy } from '@core/strategies';
import type { SubfieldCoverage } from '@core/subfield-coverage';
import type { FieldRenderer } from '@core/types';
import { createRouteStrategy } from '@fragment/route';

/**
 * A route-bound element on a path inside a field. The diff names top-level
 * fields (`layout`), the element names a path (`layout.1.note`), and both route
 * planners compared the two names as they were: measured on a site, a block
 * note marked `data-payload-strategy="route"` never refreshed the route, and a
 * `<head>` binding of `meta.title` cannot either. The path counts as changed
 * with its field; under `subfieldCoverage: 'declared'`, which keeps the previous
 * message, only when the value at the path changed.
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
function start(route: RouteStrategy, subfieldCoverage?: SubfieldCoverage): void {
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
    strategies: { route },
    ...(subfieldCoverage === undefined ? {} : { subfieldCoverage }),
  });
  runtime.start();
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
          `<!doctype html><html><head>${document.head.innerHTML}</head><body>${document.body.innerHTML}</body></html>`,
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
/** Post one message, then give a planned refresh the turn it starts in. */
async function send(data: Record<string, unknown>): Promise<void> {
  const edited = patched();
  post(data);
  await edited;
  await new Promise((resolve) => setTimeout(resolve, 20));
}
function layout(note: string, heading = 'Menu'): unknown[] {
  return [
    { id: 'a', blockType: 'intro', heading },
    { id: 'b', blockType: 'card', note },
  ];
}

const BLOCKS =
  '<h2 data-payload-field="layout.0.heading">Menu</h2>' +
  '<p data-payload-field="layout.1.note" data-payload-strategy="route">Saved note</p>';

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('a route binding on a path inside a field', () => {
  it('refreshes the route when the value at the path changes', async () => {
    document.body.innerHTML = BLOCKS;
    const { route, fetch } = servedRoute();
    start(route);
    await send({ layout: layout('Saved note') });
    fetch.mockClear();

    await send({ layout: layout('Typed note') });

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
    expect(document.querySelector('p')?.textContent).toBe('Typed note');
  });

  it('refreshes for a binding in <head> on a path inside a group', async () => {
    document.head.innerHTML = '<title data-payload-field="meta.title">Saved title</title>';
    document.body.innerHTML = '<h1 data-payload-field="title">Page</h1>';
    const { route, fetch } = servedRoute();
    start(route);
    await send({ title: 'Page', meta: { title: 'Saved title', description: 'D' } });
    fetch.mockClear();

    await send({ title: 'Page', meta: { title: 'Typed title', description: 'D' } });

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
  });

  it('refreshes for a route marker that depends on a path inside a field', async () => {
    document.body.innerHTML =
      '<h2 data-payload-field="layout.0.heading">Menu</h2>' +
      '<aside data-payload-strategy="route" data-payload-depends="layout.1.note">derived</aside>';
    const { route, fetch } = servedRoute();
    start(route);
    await send({ layout: layout('Saved note') });
    fetch.mockClear();

    await send({ layout: layout('Typed note') });

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
  });

  it('is found by the route-binding check when the planner answers no', async () => {
    document.body.innerHTML = BLOCKS;
    const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('refreshed');
    start({ plan: () => false, refresh });
    await send({ layout: layout('Saved note') });
    refresh.mockClear();

    await send({ layout: layout('Typed note') });

    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledOnce();
    });
  });
});

describe('an edit elsewhere in the same field', () => {
  it("leaves the route alone under 'declared', which compares the path", async () => {
    document.body.innerHTML = BLOCKS;
    const { route, fetch } = servedRoute();
    start(route, 'declared');
    await send({ layout: layout('Saved note') });
    fetch.mockClear();

    await send({ layout: layout('Saved note', 'Menu of the day') });

    expect(document.querySelector('h2')?.textContent).toBe('Menu of the day');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes under the default, which keeps no previous message to compare', async () => {
    document.body.innerHTML = BLOCKS;
    const { route, fetch } = servedRoute();
    start(route);
    await send({ layout: layout('Saved note') });
    fetch.mockClear();

    await send({ layout: layout('Saved note', 'Menu of the day') });

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
    });
  });
});
