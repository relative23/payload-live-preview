import { describe, expect, it, vi } from 'vitest';
import { UpdateScheduler } from '@core/update/update-scheduler';
import { entry, update } from './update-scheduler-harness';

describe('UpdateScheduler — destroy', () => {
  it('cancels timers and clears state', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 50,
      isVisible: () => true,
      getCacheSize: () => 1,
      enableVisibilityGate: false,
    });
    scheduler.schedule(update(entry(document.createElement('p')), 'v'));
    scheduler.destroy();
    vi.advanceTimersByTime(500);
    expect(apply).not.toHaveBeenCalled();
    expect(scheduler.pendingCount).toBe(0);
  });
  it('leaves no timer behind when it ends inside a window, with the debounce and the deadline armed', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 50,
      isVisible: () => true,
      getCacheSize: () => 1,
      enableVisibilityGate: false,
      // A frame that runs at once, so that what is left to count is timers.
      scheduleFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const target = entry(document.createElement('p'));
    // The first write leads and opens the window; the second waits in it.
    scheduler.schedule(update(target, 'leading'));
    scheduler.schedule(update(target, 'waiting'));
    expect(vi.getTimerCount()).toBe(2);
    scheduler.destroy();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(500);
    expect(apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: 'leading' }));
  });
  it('uses the timer frame fallback when animation-frame globals are absent', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: () => true,
      getCacheSize: () => 1,
      enableVisibilityGate: false,
    });
    scheduler.schedule(update(entry(document.createElement('p')), 'v'));
    vi.advanceTimersByTime(0);
    // Allow microtasks and the default RAF stand-in (setTimeout 0) to fire.
    vi.runAllTimers();
    expect(apply).toHaveBeenCalledOnce();
    scheduler.destroy();
  });
});
