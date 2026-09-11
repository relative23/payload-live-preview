import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { HYDRATION_SLOT } from '@core/hydration';
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
