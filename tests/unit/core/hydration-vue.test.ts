import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HYDRATION_WAIT_CAP_MS } from '@core/hydration';
import {
  VUE_APP_PROPERTY,
  VUE_HYDRATION_SLOT,
  armVueMountSignal,
  whenVueMounted,
} from '@core/hydration-vue';

/**
 * The seam the ADR 0015 addendum describes: Vue's own bookkeeping, read for
 * one fact — has Vue mounted an app around our bindings? The tests play Vue:
 * they assign `container.__vue_app__ = app` the way `runtime-core`'s `mount`
 * does after `hydrate()` has returned, and never import Vue, so what is
 * asserted is that assignment and not a Vue version.
 */

type AppWindow = Window & { [VUE_HYDRATION_SLOT]?: unknown };

const win = window as AppWindow;

/** What `mount` does once hydration is through: a plain assignment on the container. */
function vueMounts(container: Element, app: unknown = {}): void {
  (container as unknown as Record<string, unknown>)[VUE_APP_PROPERTY] = app;
}

function nuxtApp(isHydrating: boolean): {
  app: { $nuxt: { isHydrating: boolean; hook: (name: string, fn: () => void) => void } };
  resolve: () => void;
} {
  const handlers: (() => void)[] = [];
  const app = {
    $nuxt: {
      isHydrating,
      hook: (name: string, fn: () => void) => {
        if (name === 'app:suspense:resolve') handlers.push(fn);
      },
    },
  };
  return {
    app,
    resolve: () => {
      app.$nuxt.isHydrating = false;
      for (const handler of handlers.splice(0)) handler();
    },
  };
}

function page(): Element {
  const container = document.getElementById('__nuxt');
  if (container === null) throw new Error('fixture missing');
  return container;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<div id="__nuxt"><h1 data-payload-field="title">Hello</h1></div><div id="widget"><p>chat</p></div>';
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, VUE_APP_PROPERTY);
  win[VUE_HYDRATION_SLOT] = undefined;
  document.body.innerHTML = '';
});

describe('arming the signal', () => {
  it('installs an accessor Vue assigns through, once, and leaves one that is already there', () => {
    armVueMountSignal();
    const installed = Object.getOwnPropertyDescriptor(Element.prototype, VUE_APP_PROPERTY);
    expect(typeof installed?.set).toBe('function');
    expect(installed?.configurable).toBe(true);

    armVueMountSignal();
    const again = Object.getOwnPropertyDescriptor(Element.prototype, VUE_APP_PROPERTY);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- identity of the accessor, never called
    expect(again?.set).toBe(installed?.set);
  });

  it('does not replace a descriptor another owner put on the prototype', () => {
    const foreign = vi.fn();
    Object.defineProperty(Element.prototype, VUE_APP_PROPERTY, {
      configurable: true,
      set: foreign,
    });

    armVueMountSignal();

    const kept = Object.getOwnPropertyDescriptor(Element.prototype, VUE_APP_PROPERTY);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- identity of the accessor, never called
    expect(kept?.set).toBe(foreign);
  });

  it("files the app on the element as Vue's own assignment would have", () => {
    // Vue reads the property back (a development warning on a second mount)
    // and `app.unmount()` deletes it; DevTools find the app by it.
    armVueMountSignal();
    const app = { version: '3.5' };
    const container = page();

    vueMounts(container, app);

    expect(Object.hasOwn(container, VUE_APP_PROPERTY)).toBe(true);
    expect((container as unknown as Record<string, unknown>)[VUE_APP_PROPERTY]).toBe(app);
    expect((document.body as unknown as Record<string, unknown>)[VUE_APP_PROPERTY]).toBeUndefined();
    Reflect.deleteProperty(container, VUE_APP_PROPERTY);
    expect(Object.hasOwn(container, VUE_APP_PROPERTY)).toBe(false);
  });
});

describe('waiting for the mount', () => {
  it('settles on the mount of an app around a binding, and only once', () => {
    const settled = vi.fn();
    const cancel = whenVueMounted(document, settled);
    expect(cancel).not.toBeNull();

    vueMounts(page());
    vueMounts(page());

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith('committed');
  });

  it('ignores an app mounted beside the page — a widget is not ours to wait for', () => {
    const widget = document.getElementById('widget');
    if (widget === null) throw new Error('fixture missing');
    const settled = vi.fn();
    whenVueMounted(document, settled);

    vueMounts(widget);
    expect(settled).not.toHaveBeenCalled();

    vueMounts(page());
    expect(settled).toHaveBeenCalledWith('committed');
  });

  it('waits for the Suspense of a Nuxt app that is still hydrating at the mount', () => {
    // Measured 2026-09-11: a page whose setup awaits real time is mounted at
    // 494 ms and hydrates its subtree at 895 ms, when the root Suspense
    // resolves; Nuxt clears `isHydrating` then and runs `app:suspense:resolve`.
    const nuxt = nuxtApp(true);
    const settled = vi.fn();
    whenVueMounted(document, settled);

    vueMounts(page(), nuxt.app);
    expect(settled).not.toHaveBeenCalled();

    nuxt.resolve();
    expect(settled).toHaveBeenCalledWith('committed');
  });

  it('settles at the mount of a Nuxt app whose Suspense resolved inside hydrate()', () => {
    // On a page without an async setup the Suspense resolves during
    // `hydrate()`, before the mount assigns the app; the hook has run.
    const nuxt = nuxtApp(false);
    const settled = vi.fn();
    whenVueMounted(document, settled);

    vueMounts(page(), nuxt.app);

    expect(settled).toHaveBeenCalledWith('committed');
  });

  it('answers with null when Vue mounted before the runtime armed — asset delivery', () => {
    // No accessor yet: the assignment is a plain own property, which is what
    // a runtime that evaluates after `mount()` finds on the way up from a binding.
    vueMounts(page());

    const settled = vi.fn();
    expect(whenVueMounted(document, settled)).toBeNull();
    expect(settled).not.toHaveBeenCalled();
  });

  it('keeps waiting when the app mounted earlier sits beside the bindings, not around them', () => {
    const widget = document.getElementById('widget');
    if (widget === null) throw new Error('fixture missing');
    vueMounts(widget);

    const settled = vi.fn();
    expect(whenVueMounted(document, settled)).not.toBeNull();
    vueMounts(page());
    expect(settled).toHaveBeenCalledWith('committed');
  });

  it('accepts an element root, walking up from its first binding', () => {
    const container = page();
    vueMounts(container);

    const title = document.querySelector('h1');
    if (title === null) throw new Error('fixture missing');
    expect(whenVueMounted(container, vi.fn())).toBeNull();
  });

  it('answers with null once it has settled, so a later start does not wait', () => {
    whenVueMounted(document, () => undefined);
    vueMounts(page());

    const settled = vi.fn();
    expect(whenVueMounted(document, settled)).toBeNull();
    expect(settled).not.toHaveBeenCalled();
  });

  it('times out at the cap and says which way it settled', () => {
    const settled = vi.fn();
    whenVueMounted(document, settled, 100);

    vi.advanceTimersByTime(99);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(settled).toHaveBeenCalledWith('timed-out');
    vueMounts(page());
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('defaults to the cap React has', () => {
    const settled = vi.fn();
    whenVueMounted(document, settled);

    vi.advanceTimersByTime(HYDRATION_WAIT_CAP_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settled).toHaveBeenCalledWith('timed-out');
  });

  it('cancels: neither the mount nor the cap reaches a waiter that left', () => {
    const settled = vi.fn();
    const cancel = whenVueMounted(document, settled, 100);
    cancel?.();

    vueMounts(page());
    vi.advanceTimersByTime(100);

    expect(settled).not.toHaveBeenCalled();
  });

  it('serves two waiters from one mount, each once', () => {
    const first = vi.fn();
    const second = vi.fn();
    whenVueMounted(document, first);
    whenVueMounted(document, second);

    vueMounts(page());

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
