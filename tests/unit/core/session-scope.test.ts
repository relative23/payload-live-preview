import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import type { RouteContext, RouteStrategy } from '@core/strategies';

/**
 * The session scope's contract (ADR 0005, 2.1 note): everything a session
 * acquires — timers, the message listener, observers, the strategies' work
 * in flight — is gone when the session ends, whichever way it ends, and a
 * runtime that starts and stops many times leaves the page as it found it.
 * Counted, not inferred: every timer through vitest's fake clock, every
 * listener on `window` and `document` through the DOM's own methods, every
 * observer through its constructor.
 */

const TRUSTED = 'https://admin.example.com';

class CountingIntersectionObserver implements IntersectionObserver {
  static live = 0;
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  #connected = true;
  constructor() {
    CountingIntersectionObserver.live += 1;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    if (!this.#connected) return;
    this.#connected = false;
    CountingIntersectionObserver.live -= 1;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** jsdom's MutationObserver, counted: `disconnect()` is the only way out. */
function countMutationObservers(): { readonly live: () => number; restore: () => void } {
  const Original = globalThis.MutationObserver;
  let live = 0;
  class Counting extends Original {
    #connected = false;
    override observe(target: Node, options?: MutationObserverInit): void {
      if (!this.#connected) {
        this.#connected = true;
        live += 1;
      }
      super.observe(target, options);
    }
    override disconnect(): void {
      if (this.#connected) {
        this.#connected = false;
        live -= 1;
      }
      super.disconnect();
    }
  }
  globalThis.MutationObserver = Counting;
  return {
    live: () => live,
    restore: () => {
      globalThis.MutationObserver = Original;
    },
  };
}

/** Listeners added minus removed on a target, by the DOM's own methods. */
function countListeners(target: EventTarget): { readonly open: () => number; restore: () => void } {
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  const open = new Map<string, number>();
  target.addEventListener = (type: string, listener: unknown, options?: unknown): void => {
    open.set(type, (open.get(type) ?? 0) + 1);
    // A `once` listener leaves by itself; count it out when it fires.
    if (typeof options === 'object' && options !== null && (options as { once?: boolean }).once) {
      const wrapped = (event: Event): void => {
        open.set(type, (open.get(type) ?? 1) - 1);
        (listener as EventListener)(event);
      };
      add(type, wrapped, options);
      return;
    }
    add(type, listener as EventListener, options as AddEventListenerOptions | boolean | undefined);
  };
  target.removeEventListener = (type: string, listener: unknown, options?: unknown): void => {
    open.set(type, (open.get(type) ?? 0) - 1);
    remove(type, listener as EventListener, options as EventListenerOptions | boolean | undefined);
  };
  return {
    open: () => [...open.values()].reduce((sum, count) => sum + count, 0),
    restore: () => {
      target.addEventListener = add;
      target.removeEventListener = remove;
    },
  };
}

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

/** A route strategy that never answers: its request stays in flight until aborted. */
function hangingRoute(): RouteStrategy & { aborted: number } {
  const strategy = {
    aborted: 0,
    plan: () => false,
    refresh: (context: RouteContext) =>
      new Promise<'refreshed'>((_resolve, reject) => {
        context.signal.addEventListener('abort', () => {
          strategy.aborted += 1;
          reject(new Error('aborted'));
        });
      }),
  };
  return strategy;
}

function makeRuntime(
  emitter: EventEmitter,
  route?: RouteStrategy,
  extra: Record<string, unknown> = {},
): LivePreviewRuntime {
  return new LivePreviewRuntime({
    renderers: { text: textRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 1_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: () => {},
    ...(route === undefined ? {} : { strategies: { route }, onUnboundChange: 'route' }),
    ...extra,
  });
}

let windowListeners: ReturnType<typeof countListeners>;
let documentListeners: ReturnType<typeof countListeners>;
let mutationObservers: ReturnType<typeof countMutationObservers>;

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = CountingIntersectionObserver;
  CountingIntersectionObserver.live = 0;
  mutationObservers = countMutationObservers();
  windowListeners = countListeners(window);
  documentListeners = countListeners(document);
  document.body.innerHTML =
    '<h1 data-payload-field="title">Saved</h1><p data-payload-field="footer">Old</p>';
});

afterEach(() => {
  windowListeners.restore();
  documentListeners.restore();
  mutationObservers.restore();
  vi.useRealTimers();
});

function expectNothingLeft(): void {
  expect(vi.getTimerCount(), 'timers').toBe(0);
  expect(windowListeners.open(), 'window listeners').toBe(0);
  expect(documentListeners.open(), 'document listeners').toBe(0);
  expect(mutationObservers.live(), 'mutation observers').toBe(0);
  expect(CountingIntersectionObserver.live, 'intersection observers').toBe(0);
}

describe('the session scope', () => {
  it('leaves no timer, listener or observer after destroy(), in the ready handshake or later', async () => {
    const runtime = makeRuntime(new EventEmitter());
    runtime.start();
    expect(vi.getTimerCount()).toBeGreaterThan(0); // the ready retries
    expect(windowListeners.open()).toBeGreaterThan(0); // the message listener
    expect(mutationObservers.live()).toBeGreaterThan(0);
    // Half way through the handshake retries, then connected and updated.
    await vi.advanceTimersByTimeAsync(100);
    post({ title: 'One' });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('One');
    runtime.destroy();
    expectNothingLeft();
    expect(runtime.inspect().started).toBe(false);
  });

  it('aborts a route refresh in flight and its trailing retry when the session ends', async () => {
    const route = hangingRoute();
    const runtime = makeRuntime(new EventEmitter(), route);
    runtime.start();
    await vi.advanceTimersByTimeAsync(2_000);
    post({ title: 'Saved', footer: 'Old' }); // the baseline
    await vi.advanceTimersByTimeAsync(50);
    post({ title: 'Saved', footer: 'Old', headline: 'nothing binds this' }); // asks the route
    await vi.advanceTimersByTimeAsync(50);
    expect(route.aborted).toBe(0);
    runtime.destroy();
    await vi.advanceTimersByTimeAsync(0);
    expect(route.aborted).toBe(1);
    expectNothingLeft();
  });

  it('releases the same way on suspend(), and a restart acquires a fresh session', async () => {
    const runtime = makeRuntime(new EventEmitter());
    runtime.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runtime.suspend()).toBe(true);
    expectNothingLeft();
    expect(runtime.start()).toBe(true);
    expect(windowListeners.open()).toBeGreaterThan(0);
    post({ title: 'After resume' });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('After resume');
    runtime.destroy();
    expectNothingLeft();
  });

  it('refuses a reentrant start while the previous session is still closing', async () => {
    const reentrantStarts: boolean[] = [];
    const route: RouteStrategy = {
      plan: (_root, changed) => changed.has('routeOnly'),
      refresh: ({ signal }) =>
        new Promise<'refreshed'>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reentrantStarts.push(runtime.start());
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    };
    const runtime = makeRuntime(new EventEmitter(), route);
    runtime.start();
    await vi.advanceTimersByTimeAsync(2_000);
    post({ title: 'Saved', footer: 'Old' });
    await vi.advanceTimersByTimeAsync(50);
    post({ title: 'Saved', footer: 'Old', routeOnly: 'draft' });
    await vi.advanceTimersByTimeAsync(50);

    expect(runtime.suspend()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(reentrantStarts).toEqual([false]);
    expectNothingLeft();

    expect(runtime.start()).toBe(true);
    expect(windowListeners.open()).toBeGreaterThan(0);
    runtime.destroy();
    expectNothingLeft();
  });

  it('holds across many sessions: fifty start/update/destroy cycles change no count', async () => {
    for (let cycle = 0; cycle < 50; cycle += 1) {
      const runtime = makeRuntime(new EventEmitter());
      runtime.start();
      await vi.advanceTimersByTimeAsync(cycle % 2 === 0 ? 0 : 2_000);
      post({ title: `cycle ${String(cycle)}` });
      await vi.advanceTimersByTimeAsync(50);
      runtime.destroy();
      expectNothingLeft();
    }
  });

  it('closes the scope when a start fails half way, so the retry starts clean', async () => {
    const emitter = new EventEmitter();
    const errors: unknown[] = [];
    emitter.on('error', (event) => {
      errors.push(event.error);
    });
    let failOnce = true;
    const runtime = makeRuntime(emitter, undefined, {
      sendReady: () => {
        if (failOnce) {
          failOnce = false;
          throw new Error('ready failed');
        }
      },
    });
    expect(() => runtime.start()).toThrow('ready failed');
    expectNothingLeft();
    expect(runtime.start()).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    post({ title: 'Second try' });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('Second try');
    runtime.destroy();
    expectNothingLeft();
    expect(errors).toEqual([]);
  });
});
