import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { resolveStrategy, type RouteStrategy } from '@core/strategies';
import type { FieldRenderer } from '@core/types';

/**
 * The route strategy in the core (roadmap 1.7.0): a binding in `<head>` or
 * one marked `data-payload-strategy="route"` asks for the whole route; the
 * runtime refreshes once per revision through the strategy, rescans, and
 * re-applies the revision on the fresh markup. A failed refresh patches
 * instead; without a strategy the elements are patched as before.
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
const logs: string[] = [];
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
function afterUpdates(sources: readonly string[]): Promise<void> {
  return new Promise((resolve) => {
    const seen = new Set<string>();
    emitter.on('afterUpdate', (event) => {
      seen.add(String(event.source));
      if (sources.every((source) => seen.has(source))) resolve();
    });
  });
}
function start(route?: RouteStrategy): LivePreviewRuntime {
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
    log: (...args) => {
      logs.push(args.map(String).join(' '));
    },
    ...(route === undefined ? {} : { strategies: { route } }),
  });
  runtime.start();
  return runtime;
}
/** A strategy that "re-renders" the route by rewriting the layout element. */
function fakeRoute(outcome: 'refreshed' | 'failed' = 'refreshed'): RouteStrategy & {
  refreshes: number;
} {
  const strategy = {
    refreshes: 0,
    plan: (root: ParentNode, changed: ReadonlySet<string>) =>
      changed.has('title') && root.querySelector('head [data-payload-field="title"]') !== null,
    refresh: () => {
      strategy.refreshes += 1;
      if (outcome === 'refreshed') {
        document.querySelector('[data-testid="layout"]')!.textContent =
          'server render #' + String(strategy.refreshes);
        document.title = 'Saved title';
      }
      return Promise.resolve(outcome);
    },
  };
  return strategy;
}

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  logs.length = 0;
  document.head.innerHTML = '<title data-payload-field="title">Saved title</title>';
  document.body.innerHTML =
    '<p data-testid="layout">server render #0</p><h1 data-payload-field="title">Saved title</h1><p data-payload-field="footer">Old</p>';
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
  document.head.innerHTML = '';
});

describe('resolveStrategy', () => {
  it('honours the explicit attribute, then fragment boundaries, then head, then patch', () => {
    document.body.innerHTML =
      '<p id="a" data-payload-strategy="route"></p><section data-payload-fragment="x"><p id="b"></p></section><p id="c"></p><p id="d" data-payload-strategy="magic"></p>';
    expect(resolveStrategy(document.getElementById('a')!)).toBe('route');
    expect(resolveStrategy(document.getElementById('b')!)).toBe('fragment');
    expect(resolveStrategy(document.getElementById('c')!)).toBe('patch');
    expect(resolveStrategy(document.getElementById('d')!)).toBeUndefined();
    expect(resolveStrategy(document.querySelector('head title')!)).toBe('route');
  });
});

describe('route strategy', () => {
  it('refreshes the route once for a revision that touches a head binding, then re-applies it', async () => {
    const route = fakeRoute();
    const rt = start(route);
    const done = afterUpdates(['route', 'patch']);
    post({ title: 'Unsaved title', footer: 'New footer' });
    await done;
    expect(route.refreshes).toBe(1);
    expect(document.querySelector('[data-testid="layout"]')?.textContent).toBe('server render #1');
    // The unsaved state went back on top of the fresh markup, head included.
    expect(document.title).toBe('Unsaved title');
    expect(document.querySelector('h1')?.textContent).toBe('Unsaved title');
    expect(document.querySelector('[data-payload-field="footer"]')?.textContent).toBe('New footer');
    expect(rt.inspect().route).toMatchObject({
      handler: true,
      refreshes: 1,
      failed: 0,
      loopStopped: 0,
    });
  });

  it('does not refresh for a revision that touches no route-bound field', async () => {
    const route = fakeRoute();
    start(route);
    const done = afterUpdates(['patch']);
    post({ footer: 'Only the footer' });
    await done;
    expect(route.refreshes).toBe(0);
  });

  it('patches the route-bound elements when the refresh fails', async () => {
    const route = fakeRoute('failed');
    const rt = start(route);
    const done = afterUpdates(['patch']);
    post({ title: 'Patched anyway' });
    await done;
    expect(document.title).toBe('Patched anyway');
    expect(rt.inspect().route).toMatchObject({ refreshes: 0, failed: 1 });
  });

  it('patches head bindings as before when no route strategy is configured', async () => {
    const rt = start();
    const done = afterUpdates(['patch']);
    post({ title: 'Plain patch' });
    await done;
    expect(document.title).toBe('Plain patch');
    expect(rt.inspect().route.handler).toBe(false);
  });

  it('a newer revision supersedes a refresh in flight; only the newest is applied', async () => {
    const seen: string[] = [];
    const route: RouteStrategy = {
      plan: (_root, changed) => changed.has('title'),
      refresh: (context) => {
        seen.push(String(context.revision));
        // The first revision's refresh never answers; the second is instant.
        if (seen.length === 1) return new Promise(() => {});
        return Promise.resolve('refreshed');
      },
    };
    const rt = start(route);
    post({ title: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const done = afterUpdates(['route', 'patch']);
    post({ title: 'second' });
    await done;
    expect(seen).toHaveLength(2);
    expect(document.title).toBe('second');
    expect(rt.inspect().revisions.superseded).toBe(1);
    expect(rt.inspect().route.refreshes).toBe(1);
    expect(logs.some((line) => line.includes('LP0805'))).toBe(false);
  });
});
