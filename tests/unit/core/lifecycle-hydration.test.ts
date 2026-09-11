import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { HYDRATION_SLOT } from '@core/hydration';
import { VUE_APP_PROPERTY, VUE_HYDRATION_SLOT } from '@core/hydration-vue';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

/**
 * ADR 0015 §3: with `hydration: 'react'` the runtime does not start — no cache,
 * no listener, no `ready` — until React has committed a root that holds a
 * binding, or the cap has passed. The tests play React through the same hook
 * `react-dom` calls; nothing here imports React.
 */

interface Hook {
  onCommitFiberRoot?: (rendererId: number, root: { containerInfo: Node }) => void;
}

type HookWindow = Window & { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook; [HYDRATION_SLOT]?: unknown };

const win = window as HookWindow;

function reactCommits(containerInfo: Node = document): void {
  const hook = win.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook?.onCommitFiberRoot === undefined) throw new Error('the runtime armed no hook');
  hook.onCommitFiberRoot(1, { containerInfo });
}

afterEach(() => {
  delete win.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  win[HYDRATION_SLOT] = undefined;
});

describe('startup on a page that declares React hydration', () => {
  it('posts no ready and applies no message until React has committed', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">server</h1>';
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'react', sendReady });

    expect(runtime.start()).toBe(true);
    expect(sendReady).not.toHaveBeenCalled();
    expect(runtime.cache.elementCount).toBe(0);
    expect(runtime.inspect().hydration).toEqual({ mode: 'react', state: 'waiting' });

    // The message an admin might send unprompted lands on a runtime that is
    // not listening yet — as one before DOMContentLoaded does today.
    fireMessage({ type: 'payload-live-preview', data: { title: 'too early' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('server');

    reactCommits();

    expect(sendReady).toHaveBeenCalledTimes(1);
    expect(runtime.cache.elementCount).toBe(1);
    expect(runtime.inspect().hydration).toEqual({ mode: 'react', state: 'committed' });
    fireMessage({ type: 'payload-live-preview', data: { title: 'after hydration' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('after hydration');

    runtime.destroy();
  });

  it('arms the hook at start(), before React can evaluate', () => {
    document.body.innerHTML = '<h1 data-payload-field="title">server</h1>';
    const runtime = makeRuntime({ hydration: 'react' });
    expect(win.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeUndefined();

    runtime.start();

    expect(typeof win.__REACT_DEVTOOLS_GLOBAL_HOOK__?.onCommitFiberRoot).toBe('function');
    runtime.destroy();
  });

  it('keeps waiting through a commit into a root that holds no binding', () => {
    document.body.innerHTML =
      '<h1 data-payload-field="title">server</h1><nextjs-portal></nextjs-portal>';
    const portal = document.querySelector('nextjs-portal');
    if (portal === null) throw new Error('fixture missing');
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'react', sendReady });
    runtime.start();

    reactCommits(portal);
    expect(sendReady).not.toHaveBeenCalled();
    expect(runtime.inspect().hydration.state).toBe('waiting');

    reactCommits(document);
    expect(sendReady).toHaveBeenCalledTimes(1);
    runtime.destroy();
  });

  it('waits for DOMContentLoaded first, then for the commit', () => {
    document.body.innerHTML = '<h1 data-payload-field="title">server</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'react', sendReady });
    runtime.start();

    // A commit while the document is still parsing settles the signal; the
    // runtime still needs the body before it can build its cache.
    reactCommits();
    expect(sendReady).not.toHaveBeenCalled();

    readyState.mockReturnValue('interactive');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(sendReady).toHaveBeenCalledTimes(1);
    expect(runtime.inspect().hydration.state).toBe('committed');
    runtime.destroy();
    readyState.mockRestore();
  });

  it('starts at the cap, once, and says so with LP0607', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">server</h1>';
    const sendReady = vi.fn();
    const warn = vi.fn();
    const runtime = makeRuntime({ hydration: 'react', sendReady, warn });
    runtime.start();

    await vi.advanceTimersByTimeAsync(4999);
    expect(sendReady).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(sendReady).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('LP0607');
    expect(runtime.inspect().hydration).toEqual({ mode: 'react', state: 'timed-out' });

    // The page works from here as it did before this record; a commit that
    // comes later changes nothing the runtime reports.
    reactCommits();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(runtime.inspect().hydration.state).toBe('timed-out');
    fireMessage({ type: 'payload-live-preview', data: { title: 'late' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('late');
    runtime.destroy();
  });

  it('destroy() while waiting cancels the pending startup', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">server</h1>';
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'react', sendReady });
    runtime.start();
    runtime.destroy();

    reactCommits();
    await vi.advanceTimersByTimeAsync(5000);

    expect(sendReady).not.toHaveBeenCalled();
    fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('server');
  });

  it('a restart after the commit starts at once — a bfcache restore does not wait again', () => {
    document.body.innerHTML = '<h1 data-payload-field="title">server</h1>';
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'react', sendReady });
    runtime.start();
    reactCommits();
    expect(sendReady).toHaveBeenCalledTimes(1);

    runtime.suspend();
    expect(runtime.start()).toBe(true);

    expect(sendReady).toHaveBeenCalledTimes(2);
    expect(runtime.inspect().hydration.state).toBe('committed');
    runtime.destroy();
  });

  it('reports a failure of the deferred start as LP0605, like a failure after DOMContentLoaded', () => {
    document.body.innerHTML = '<h1 data-payload-field="title">server</h1>';
    const codes: string[] = [];
    const emitter = new EventEmitter();
    emitter.on('error', (event) => {
      codes.push(event.code);
    });
    const runtime = makeRuntime({
      hydration: 'react',
      emitter,
      resolveRenderer: () => {
        throw new Error('resolution exploded');
      },
    });
    runtime.start();

    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = function broken(): never {
      throw new Error('observer unavailable');
    } as unknown as typeof IntersectionObserver;
    reactCommits();
    globalThis.IntersectionObserver = original;

    expect(codes).toContain('LP0605');
    runtime.destroy();
  });

  it('changes nothing on a page that declares no hydration', () => {
    document.body.innerHTML = '<h1 data-payload-field="title">server</h1>';
    const sendReady = vi.fn();
    const runtime = makeRuntime({ sendReady });

    runtime.start();

    expect(sendReady).toHaveBeenCalledTimes(1);
    expect(win.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeUndefined();
    expect(runtime.inspect().hydration).toEqual({ mode: 'off', state: 'idle' });
    runtime.destroy();
  });
});

/**
 * The addendum to ADR 0015: with `hydration: 'vue'` the runtime does not start
 * until Vue has mounted an app around a binding — the assignment
 * `container.__vue_app__ = app` that `runtime-core` makes after `hydrate()`,
 * which is where the write it would otherwise have made is quietly put back.
 */
type VueWindow = Window & { [VUE_HYDRATION_SLOT]?: unknown };

function vueMounts(container: Element, app: unknown = {}): void {
  (container as unknown as Record<string, unknown>)[VUE_APP_PROPERTY] = app;
}

function nuxtPage(): Element {
  const container = document.getElementById('__nuxt');
  if (container === null) throw new Error('fixture missing');
  return container;
}

describe('startup on a page that declares Vue hydration', () => {
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, VUE_APP_PROPERTY);
    (window as VueWindow)[VUE_HYDRATION_SLOT] = undefined;
  });

  it('posts no ready and applies no message until Vue has mounted the app around the bindings', async () => {
    document.body.innerHTML = '<div id="__nuxt"><h1 data-payload-field="title">server</h1></div>';
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'vue', sendReady });

    expect(runtime.start()).toBe(true);
    expect(sendReady).not.toHaveBeenCalled();
    expect(runtime.cache.elementCount).toBe(0);
    expect(runtime.inspect().hydration).toEqual({ mode: 'vue', state: 'waiting' });

    fireMessage({ type: 'payload-live-preview', data: { title: 'too early' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('server');

    vueMounts(nuxtPage());

    expect(sendReady).toHaveBeenCalledTimes(1);
    expect(runtime.cache.elementCount).toBe(1);
    expect(runtime.inspect().hydration).toEqual({ mode: 'vue', state: 'committed' });
    fireMessage({ type: 'payload-live-preview', data: { title: 'after hydration' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('after hydration');

    runtime.destroy();
  });

  it('arms the accessor at start(), before Vue can mount, and not on a React page', () => {
    document.body.innerHTML = '<div id="__nuxt"><h1 data-payload-field="title">server</h1></div>';
    const runtime = makeRuntime({ hydration: 'vue' });
    expect(Object.getOwnPropertyDescriptor(Element.prototype, VUE_APP_PROPERTY)).toBeUndefined();

    runtime.start();

    expect(typeof Object.getOwnPropertyDescriptor(Element.prototype, VUE_APP_PROPERTY)?.set).toBe(
      'function',
    );
    expect(win.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeUndefined();
    runtime.destroy();
  });

  it('keeps waiting through the mount of an app that holds no binding', () => {
    document.body.innerHTML =
      '<div id="__nuxt"><h1 data-payload-field="title">server</h1></div><div id="widget"><p>chat</p></div>';
    const widget = document.getElementById('widget');
    if (widget === null) throw new Error('fixture missing');
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'vue', sendReady });
    runtime.start();

    vueMounts(widget);
    expect(sendReady).not.toHaveBeenCalled();
    expect(runtime.inspect().hydration.state).toBe('waiting');

    vueMounts(nuxtPage());
    expect(sendReady).toHaveBeenCalledTimes(1);
    runtime.destroy();
  });

  it('starts at once when Vue mounted before the runtime evaluated — asset delivery', () => {
    document.body.innerHTML = '<div id="__nuxt"><h1 data-payload-field="title">server</h1></div>';
    vueMounts(nuxtPage());
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'vue', sendReady });

    runtime.start();

    expect(sendReady).toHaveBeenCalledTimes(1);
    expect(runtime.inspect().hydration).toEqual({ mode: 'vue', state: 'committed' });
    runtime.destroy();
  });

  it('waits for the Suspense of a Nuxt app that is still hydrating when it mounts', () => {
    document.body.innerHTML = '<div id="__nuxt"><h1 data-payload-field="title">server</h1></div>';
    const handlers: (() => void)[] = [];
    const app = {
      $nuxt: {
        isHydrating: true,
        hook: (name: string, fn: () => void) => {
          if (name === 'app:suspense:resolve') handlers.push(fn);
        },
      },
    };
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'vue', sendReady });
    runtime.start();

    vueMounts(nuxtPage(), app);
    expect(sendReady).not.toHaveBeenCalled();

    app.$nuxt.isHydrating = false;
    for (const handler of handlers) handler();
    expect(sendReady).toHaveBeenCalledTimes(1);
    expect(runtime.inspect().hydration.state).toBe('committed');
    runtime.destroy();
  });

  it('starts at the cap, once, and says so with LP0607 naming the mount it waited for', async () => {
    document.body.innerHTML = '<div id="__nuxt"><h1 data-payload-field="title">server</h1></div>';
    const sendReady = vi.fn();
    const warn = vi.fn();
    const runtime = makeRuntime({ hydration: 'vue', sendReady, warn });
    runtime.start();

    await vi.advanceTimersByTimeAsync(4999);
    expect(sendReady).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(sendReady).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('LP0607');
    expect(String(warn.mock.calls[0]?.[0])).toContain('no Vue mount');
    expect(runtime.inspect().hydration).toEqual({ mode: 'vue', state: 'timed-out' });

    vueMounts(nuxtPage());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(runtime.inspect().hydration.state).toBe('timed-out');
    runtime.destroy();
  });

  it('destroy() while waiting cancels the pending startup', async () => {
    document.body.innerHTML = '<div id="__nuxt"><h1 data-payload-field="title">server</h1></div>';
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'vue', sendReady });
    runtime.start();
    runtime.destroy();

    vueMounts(nuxtPage());
    await vi.advanceTimersByTimeAsync(5000);

    expect(sendReady).not.toHaveBeenCalled();
  });

  it('a restart after the mount starts at once — a bfcache restore does not wait again', () => {
    document.body.innerHTML = '<div id="__nuxt"><h1 data-payload-field="title">server</h1></div>';
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'vue', sendReady });
    runtime.start();
    vueMounts(nuxtPage());
    expect(sendReady).toHaveBeenCalledTimes(1);

    runtime.suspend();
    expect(runtime.start()).toBe(true);

    expect(sendReady).toHaveBeenCalledTimes(2);
    expect(runtime.inspect().hydration.state).toBe('committed');
    runtime.destroy();
  });
});
