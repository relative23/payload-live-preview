import { describe, expect, it, vi } from 'vitest';
import { UpdateScheduler } from '@core/update-scheduler';
import { entry, update } from './update-scheduler-harness';

describe('UpdateScheduler — destroy', () => {
  it('cancels timers and clears state', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 50,
      isVisible: () => true,
      getCacheSize: () => 1,
      disableVisibilityGate: true,
    });
    scheduler.schedule(update(entry(document.createElement('p')), 'v'));
    scheduler.destroy();
    vi.advanceTimersByTime(500);
    expect(apply).not.toHaveBeenCalled();
    expect(scheduler.pendingCount).toBe(0);
  });
  it('uses the timer frame fallback when animation-frame globals are absent', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: () => true,
      getCacheSize: () => 1,
      disableVisibilityGate: true,
    });
    scheduler.schedule(update(entry(document.createElement('p')), 'v'));
    vi.advanceTimersByTime(0);
    // Allow microtasks and the default RAF stand-in (setTimeout 0) to fire.
    vi.runAllTimers();
    expect(apply).toHaveBeenCalledOnce();
    scheduler.destroy();
  });
});
