import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FragmentStrategy, RouteContext, RouteOutcome, RouteStrategy } from '@core/strategies';
import type { FieldRenderer } from '@core/types';
import { fragmentStrategyFrom, type FragmentHandler, type StrategyRequest } from '@fragment/index';

/**
 * Server work a newer revision cuts short, or outlives. The diff that plans a
 * revision's route refresh or fragment render compares it with the previous
 * message, so a newer message that repeats the older one's values, or changes
 * only a patched field, plans none of it (PHD-07). A boundary render carries
 * the older revision's fields, so the newer one renders it again. A route
 * refresh renders the server's view of the route and carries no revision, so
 * it runs on and lands for the newer one. In WebKit the mock admin's re-send
 * every ~502 ms kept landing inside the App Router refresh, and a refresh that
 * the next revision had to repeat was paced into the same spot a second later.
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
let log: Mock<(...args: unknown[]) => void>;
/** Each throw after a refresh returned that the runtime caught instead of leaving it unhandled. */
const routeFailures = (): number =>
  log.mock.calls.filter(([message]) => message === 'route refresh failed:').length;
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
function afterUpdate(source: string): Promise<void> {
  return new Promise((resolve) => {
    const listener = (event: { source?: unknown }): void => {
      if (event.source !== source) return;
      emitter.off('afterUpdate', listener);
      resolve();
    };
    emitter.on('afterUpdate', listener);
  });
}
type RuntimeOptions = ConstructorParameters<typeof LivePreviewRuntime>[0];
function start(
  strategies: RuntimeOptions['strategies'],
  autoBind: RuntimeOptions['autoBind'] = 'off',
): LivePreviewRuntime {
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
    log,
    autoBind,
    onUnboundChange: 'route',
    ...(strategies === undefined ? {} : { strategies }),
  });
  runtime.start();
  return runtime;
}
const layout = (): string | null | undefined =>
  document.querySelector('[data-testid="layout"]')?.textContent;

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  log = vi.fn<(...args: unknown[]) => void>();
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
  document.body.innerHTML = '';
});

describe('a route refresh a newer revision outlives', () => {
  /**
   * Each refresh holds until the test releases it, then renders the route from
   * the saved document, like a server: the heading is a new element, as after
   * a router refresh; a refusal renders nothing. `abortable` answers `superseded` on abort, like the fetch
   * path; `host` finishes its render anyway, like a router refresh that has no
   * abort, and reports what `isCurrent` says then; `deaf` reports `answer`
   * without asking, like a strategy that never looks.
   */
  function heldRoute(
    mode: 'abortable' | 'host' | 'deaf',
    answer: RouteOutcome = 'partial',
  ): RouteStrategy & {
    calls: number[];
    release: (call: number) => void;
  } {
    const releases: (() => void)[] = [];
    const strategy = {
      calls: [] as number[],
      release: (call: number) => {
        releases[call]?.();
      },
      plan: () => false,
      refresh: (context: RouteContext): Promise<RouteOutcome> => {
        strategy.calls.push(context.revision);
        const call = strategy.calls.length;
        return new Promise((resolve) => {
          if (mode === 'abortable') {
            context.signal.addEventListener('abort', () => {
              resolve('superseded');
            });
          }
          releases.push(() => {
            if (answer === 'refreshed' || answer === 'partial') {
              document.querySelector('[data-testid="layout"]')!.textContent =
                'server render #' + String(call);
              const heading = document.createElement('h1');
              heading.setAttribute('data-payload-field', 'title');
              heading.textContent = 'Saved';
              document.querySelector('h1')!.replaceWith(heading);
            }
            resolve(mode === 'deaf' || context.isCurrent() ? answer : 'superseded');
          });
        });
      },
    };
    return strategy;
  }

  async function connectAndEdit(
    route: RouteStrategy & { calls: number[] },
    fragment?: FragmentStrategy,
  ): Promise<LivePreviewRuntime> {
    document.body.innerHTML =
      '<p data-testid="layout">server render #0</p><h1 data-payload-field="title">Saved</h1>';
    const rt = start(fragment === undefined ? { route } : { route, fragment });
    const connected = afterUpdate('patch');
    post({ title: 'Saved' });
    await connected;
    // `headline` is bound nowhere: only a route refresh can show it.
    post({ title: 'Saved', headline: 'unsaved' });
    await vi.waitFor(() => {
      expect(route.calls).toHaveLength(1);
    });
    return rt;
  }

  /** The newer revision has been planned: it was accepted and ran to its terminal state. */
  async function settled(rt: LivePreviewRuntime, accepted: number): Promise<void> {
    await vi.waitFor(() => {
      expect(rt.inspect().revisions).toMatchObject({ accepted, completed: accepted - 1 });
    });
  }

  /** The newer revision is accepted and held in `beforeUpdate`, its fields unresolved. */
  async function resolving(
    rt: LivePreviewRuntime,
    data: Record<string, unknown>,
  ): Promise<() => void> {
    let open = (): void => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    emitter.on('beforeUpdate', () => gate);
    post(data);
    await vi.waitFor(() => {
      expect(rt.inspect().revisions.accepted).toBe(3);
    });
    return open;
  }

  it('lands for a newer revision that repeats the same values', async () => {
    const route = heldRoute('abortable');
    const rt = await connectAndEdit(route);
    const landed: { revision: number | undefined; durationMs: number }[] = [];
    emitter.on('afterUpdate', (event) => {
      if (event.source === 'route') {
        landed.push({ revision: event.revision, durationMs: event.durationMs });
      }
    });
    post({ title: 'Saved', headline: 'unsaved' });
    await settled(rt, 3);
    route.release(0);
    await vi.waitFor(() => {
      expect(rt.inspect().route.refreshes).toBe(1);
    });
    expect(route.calls).toEqual([2]);
    expect(landed.map((event) => event.revision)).toEqual([3]);
    // Measured from the revision it landed for, not from the epoch.
    expect(landed[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(landed[0]?.durationMs).toBeLessThan(60_000);
    expect(layout()).toBe('server render #1');
    expect(rt.inspect().route).toMatchObject({ refreshes: 1, partial: 1, refused: 0 });
    expect(routeFailures()).toBe(0);
  });

  it('re-applies a newer revision that changed only a patched field onto the fresh route', async () => {
    const route = heldRoute('host');
    const rt = await connectAndEdit(route);
    post({ title: 'Typed after the toggle', headline: 'unsaved' });
    await settled(rt, 3);
    expect(document.querySelector('h1')?.textContent).toBe('Typed after the toggle');
    route.release(0);
    await vi.waitFor(() => {
      expect(rt.inspect().route.refreshes).toBe(1);
    });
    expect(document.querySelector('h1')?.textContent).toBe('Typed after the toggle');
    expect(route.calls).toEqual([2]);
    expect(routeFailures()).toBe(0);
  });

  it('lands for a newer revision still resolving its fields, which then applies itself', async () => {
    const route = heldRoute('abortable');
    const rt = await connectAndEdit(route);
    const open = await resolving(rt, { title: 'Typed while resolving', headline: 'unsaved' });
    route.release(0);
    await vi.waitFor(() => {
      expect(rt.inspect().route.refreshes).toBe(1);
    });
    // Nothing of the newer revision is on the page before its own apply, and
    // re-applying data it does not have yet threw nothing.
    expect(document.querySelector('h1')?.textContent).toBe('Saved');
    expect(routeFailures()).toBe(0);
    open();
    await vi.waitFor(() => {
      expect(document.querySelector('h1')?.textContent).toBe('Typed while resolving');
    });
    expect(route.calls).toEqual([2]);
  });

  it('re-applies nothing for a newer revision still resolving when the refresh was refused', async () => {
    const route = heldRoute('host', 'refused');
    const rt = await connectAndEdit(route);
    const open = await resolving(rt, { title: 'Typed while refused', headline: 'unsaved' });
    route.release(0);
    await vi.waitFor(() => {
      expect(rt.inspect().route.refused).toBe(1);
    });
    expect(routeFailures()).toBe(0);
    open();
    await vi.waitFor(() => {
      expect(document.querySelector('h1')?.textContent).toBe('Typed while refused');
    });
  });

  it('restores no guesses for a newer revision still resolving its fields', async () => {
    document.body.innerHTML =
      '<p data-testid="layout">server render #0</p><h1 data-payload-field="title">Saved</h1>' +
      '<p>A kicker only a guess binds</p>';
    const route = heldRoute('abortable');
    const rt = start({ route }, 'unique');
    const connected = afterUpdate('patch');
    post({ title: 'Saved', kicker: 'A kicker only a guess binds' });
    await connected;
    expect(rt.inspect().bindings.guessed.map((guess) => guess.field)).toEqual(['kicker']);
    post({ title: 'Saved', kicker: 'A kicker only a guess binds', headline: 'unsaved' });
    await vi.waitFor(() => {
      expect(route.calls).toHaveLength(1);
    });
    const open = await resolving(rt, {
      title: 'Saved',
      kicker: 'A kicker only a guess binds',
      headline: 'unsaved',
    });
    route.release(0);
    await vi.waitFor(() => {
      expect(rt.inspect().route.refreshes).toBe(1);
    });
    expect(routeFailures()).toBe(0);
    open();
  });

  it('is replaced by a newer revision that asks for a refresh of its own', async () => {
    const route = heldRoute('deaf');
    const rt = await connectAndEdit(route);
    post({ title: 'Saved', headline: 'changed again' });
    await vi.waitFor(() => {
      expect(route.calls).toEqual([2, 3]);
    });
    route.release(1);
    await vi.waitFor(() => {
      expect(rt.inspect().route.refreshes).toBe(1);
    });
    // The replaced refresh still finishes its host render and even says it
    // rendered, but it was aborted, so it lands for nobody.
    route.release(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(rt.inspect().route).toMatchObject({ refreshes: 1, partial: 1, failed: 0 });
  });

  it('does not land after a navigation committed', async () => {
    const route = heldRoute('deaf');
    const rt = await connectAndEdit(route);
    rt.navigationCommit();
    route.release(0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(rt.inspect().route.refreshes).toBe(0);
  });

  it('logs a throw while re-applying onto the fresh route instead of leaving it unhandled', async () => {
    const route = heldRoute('host');
    const base = fragmentStrategyFrom(() => Promise.resolve({ status: 'rendered', html: '' }));
    let armed = false;
    const fragment: FragmentStrategy = {
      ...base,
      plan: (root, changed) => {
        if (armed) throw new Error('plan exploded');
        return base.plan(root, changed);
      },
    };
    const rt = await connectAndEdit(route, fragment);
    armed = true;
    route.release(0);
    await vi.waitFor(() => {
      expect(routeFailures()).toBe(1);
    });
    expect(rt.inspect().route.refreshes).toBe(1);
  });

  it('logs a throw after the trailing run of a refused refresh as well', async () => {
    document.body.innerHTML =
      '<p data-testid="layout">server render #0</p><h1 data-payload-field="title">Saved</h1>';
    const refresh = vi
      .fn<RouteStrategy['refresh']>()
      .mockImplementationOnce((context) => {
        context.retryAfter?.(1);
        return Promise.resolve('refused');
      })
      .mockResolvedValue('partial');
    const base = fragmentStrategyFrom(() => Promise.resolve({ status: 'rendered', html: '' }));
    let armed = false;
    const fragment: FragmentStrategy = {
      ...base,
      plan: (root, changed) => {
        if (armed) throw new Error('plan exploded');
        return base.plan(root, changed);
      },
    };
    const rt = start({ route: { plan: () => false, refresh }, fragment });
    const connected = afterUpdate('patch');
    post({ title: 'Saved' });
    await connected;
    armed = true;
    post({ title: 'Saved', headline: 'unsaved' });
    // The refusal re-applies what the page has, and so does the trailing run.
    await vi.waitFor(() => {
      expect(routeFailures()).toBe(2);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(rt.inspect().route).toMatchObject({ refused: 1, refreshes: 1 });
  });

  it('owes nothing after a refresh that finished before the newer revision', async () => {
    document.body.innerHTML =
      '<p data-testid="layout">server render #0</p><h1 data-payload-field="title">Saved</h1>';
    const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('partial');
    const rt = start({ route: { plan: () => false, refresh } });
    const connected = afterUpdate('patch');
    post({ title: 'Saved' });
    await connected;
    const refreshed = afterUpdate('route');
    post({ title: 'Saved', headline: 'unsaved' });
    await refreshed;
    const patched = afterUpdate('patch');
    post({ title: 'Typed later', headline: 'unsaved' });
    await patched;
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(rt.inspect().route).toMatchObject({ refreshes: 1 });
  });
});

describe('a fragment render a newer revision cuts short', () => {
  const PAGE =
    '<section data-payload-fragment="hero" data-payload-depends="tagline"><p>Old tagline</p></section>' +
    '<p data-payload-field="footer">Old footer</p>';

  /** The second request, the edit's render, answers only once a newer revision aborted it. */
  function heldSecondRender(requests: StrategyRequest[]): FragmentHandler {
    return (request) => {
      requests.push(request);
      if (requests.length === 2) {
        return new Promise((resolve) => {
          request.signal.addEventListener('abort', () => {
            resolve({ status: 'rendered', html: '<p>Too late</p>' });
          });
        });
      }
      return Promise.resolve({
        status: 'rendered',
        html: `<p>${String(request.fields['tagline'])}</p>`,
      });
    };
  }

  async function connectAndEditTagline(requests: StrategyRequest[]): Promise<LivePreviewRuntime> {
    document.body.innerHTML = PAGE;
    const rt = start({ fragment: fragmentStrategyFrom(heldSecondRender(requests)) });
    const connected = afterUpdate('fragment');
    post({ tagline: 'Old tagline', footer: 'Old footer' });
    await connected;
    post({ tagline: 'Unsaved tagline', footer: 'Old footer' });
    await vi.waitFor(() => {
      expect(requests).toHaveLength(2);
    });
    return rt;
  }

  it('renders the boundary for a newer revision that changes only a field outside it', async () => {
    const requests: StrategyRequest[] = [];
    const rt = await connectAndEditTagline(requests);
    post({ tagline: 'Unsaved tagline', footer: 'Typed footer' });
    await vi.waitFor(() => {
      expect(document.querySelector('section p')?.textContent).toBe('Unsaved tagline');
    });
    expect(requests[1]?.signal.aborted).toBe(true);
    expect(document.querySelector('[data-payload-field="footer"]')?.textContent).toBe(
      'Typed footer',
    );
    expect(rt.inspect().fragments).toMatchObject({ superseded: 1 });
    // The render that settled the debt started, so the next revision owes nothing.
    const patched = afterUpdate('patch');
    post({ tagline: 'Unsaved tagline', footer: 'Typed again' });
    await patched;
    expect(requests).toHaveLength(3);
  });

  it('drops the debt of a boundary that left the page before the newer revision planned', async () => {
    const requests: StrategyRequest[] = [];
    const rt = await connectAndEditTagline(requests);
    let open = (): void => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    emitter.on('beforeUpdate', () => gate);
    post({ tagline: 'Unsaved tagline', footer: 'Typed footer' });
    await vi.waitFor(() => {
      expect(requests[1]?.signal.aborted).toBe(true);
    });
    document.querySelector('section')?.remove();
    const patched = afterUpdate('patch');
    open();
    await patched;
    expect(document.querySelector('[data-payload-field="footer"]')?.textContent).toBe(
      'Typed footer',
    );
    expect(requests).toHaveLength(2);
    expect(rt.inspect().fragments).toMatchObject({ superseded: 1 });
  });
});
