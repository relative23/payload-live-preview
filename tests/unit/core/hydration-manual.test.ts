import { afterEach, describe, expect, it, vi } from 'vitest';
import { markHydrated } from '@/index';
import { HYDRATION_WAIT_CAP_MS } from '@core/hydration';
import { MANUAL_HYDRATION_SLOT, whenMarkedHydrated } from '@core/hydration-manual';
import { RUNTIME_LEAN_SOURCE } from '@inline/runtime-lean.generated';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

/**
 * `hydration: 'manual'`: a page whose framework this package cannot observe says
 * when it has hydrated. The slot holds a state, not an event, because the page's
 * bundle and the runtime are separate scripts and either may run first.
 */

const win = window as Window & { [MANUAL_HYDRATION_SLOT]?: unknown };

afterEach(() => {
  win[MANUAL_HYDRATION_SLOT] = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('whenMarkedHydrated', () => {
  it('calls back when the page marks itself hydrated, once', () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    expect(whenMarkedHydrated(document, settled)).not.toBeNull();
    expect(settled).not.toHaveBeenCalled();
    markHydrated();
    markHydrated();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith('committed');
    vi.advanceTimersByTime(HYDRATION_WAIT_CAP_MS * 2);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('has nothing to wait for once the page has marked itself, whichever ran first', () => {
    markHydrated();
    const settled = vi.fn();
    expect(whenMarkedHydrated(document, settled)).toBeNull();
    expect(settled).not.toHaveBeenCalled();
  });

  it('gives up at the cap, and a cancelled wait hears nothing', () => {
    vi.useFakeTimers();
    const capped = vi.fn();
    const cancelled = vi.fn();
    whenMarkedHydrated(document, capped);
    const cancel = whenMarkedHydrated(document, cancelled);
    cancel?.();
    vi.advanceTimersByTime(HYDRATION_WAIT_CAP_MS - 1);
    expect(capped).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(capped).toHaveBeenCalledWith('timed-out');
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('reaches a runtime from another bundle, which holds its own copy of this module', async () => {
    const settled = vi.fn();
    whenMarkedHydrated(document, settled);
    vi.resetModules();
    const other = await import('@core/hydration-manual');
    expect(other.markHydrated).not.toBe(markHydrated);
    other.markHydrated();
    expect(settled).toHaveBeenCalledWith('committed');
  });

  it('names the same slot in the built runtime as the entry a page imports', () => {
    expect(RUNTIME_LEAN_SOURCE).toContain(MANUAL_HYDRATION_SLOT);
  });

  it('does nothing on a server, where a shared module may import it', () => {
    vi.stubGlobal('window', undefined);
    expect(() => {
      markHydrated();
    }).not.toThrow();
    expect(whenMarkedHydrated(document, vi.fn())).toBeNull();
  });
});

describe('startup on a page that declares manual hydration', () => {
  it('posts no ready and applies no message until the page marks itself hydrated', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<h1 data-payload-field="title">server</h1>';
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'manual', sendReady });

    expect(runtime.start()).toBe(true);
    expect(sendReady).not.toHaveBeenCalled();
    expect(runtime.inspect().hydration).toEqual({ mode: 'manual', state: 'waiting' });
    fireMessage({ type: 'payload-live-preview', data: { title: 'too early' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('server');

    markHydrated();

    expect(sendReady).toHaveBeenCalledTimes(1);
    expect(runtime.inspect().hydration).toEqual({ mode: 'manual', state: 'committed' });
    fireMessage({ type: 'payload-live-preview', data: { title: 'after hydration' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('after hydration');
    runtime.destroy();
  });

  it('starts at once on a page that marked itself before the runtime ran', () => {
    document.body.innerHTML = '<h1 data-payload-field="title">server</h1>';
    markHydrated();
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'manual', sendReady });
    runtime.start();
    expect(sendReady).toHaveBeenCalledTimes(1);
    expect(runtime.inspect().hydration).toEqual({ mode: 'manual', state: 'committed' });
    runtime.destroy();
  });

  it('starts at the cap and reports LP0607, naming the call it waited for', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<h1 data-payload-field="title">server</h1>';
    const warn = vi.fn();
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'manual', sendReady, warn });
    runtime.start();
    vi.advanceTimersByTime(HYDRATION_WAIT_CAP_MS);
    expect(sendReady).toHaveBeenCalledTimes(1);
    expect(runtime.inspect().hydration).toEqual({ mode: 'manual', state: 'timed-out' });
    expect(warn).toHaveBeenCalledWith(
      `[live-preview] LP0607: no markHydrated() call in ${String(HYDRATION_WAIT_CAP_MS)} ms; started without waiting for hydration.`,
    );
    runtime.destroy();
  });
});
