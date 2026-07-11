import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateScheduler, type ScheduledUpdate } from '@core/update-scheduler';
import type { CachedElement } from '@core/types';

function entry(element: Element, fieldName = 'f'): CachedElement {
  return { element, fieldName, fieldType: 'text' };
}

function update(target: CachedElement, value: unknown): ScheduledUpdate {
  return { target, value, allFields: {} };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('UpdateScheduler — debounce + RAF', () => {
  it('applies pending updates after debounce + frame', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 20,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const el = document.createElement('p');
    scheduler.schedule(update(entry(el), 'hello'));
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('coalesces multiple writes to the same element', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 10,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const el = document.createElement('p');
    const ce = entry(el);
    scheduler.schedule(update(ce, 'a'));
    scheduler.schedule(update(ce, 'b'));
    scheduler.schedule(update(ce, 'c'));
    expect(scheduler.pendingCount).toBe(1);
    vi.advanceTimersByTime(10);
    expect(apply).toHaveBeenCalledOnce();
    expect((apply.mock.calls[0]?.[0] as ScheduledUpdate).value).toBe('c');
  });

  it('flushNow applies pending updates immediately and clears the debounce', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 100,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const el = document.createElement('p');
    scheduler.schedule(update(entry(el), 'v'));
    const stats = scheduler.flushNow();
    expect(stats.applied).toBe(1);
    expect(stats.deferred).toBe(0);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('calls onFlush after each flush', () => {
    const onFlush = vi.fn();
    const scheduler = new UpdateScheduler(() => {}, {
      debounceMs: 10,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
      onFlush,
    });
    scheduler.schedule(update(entry(document.createElement('p')), 'a'));
    vi.advanceTimersByTime(10);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]?.[0]).toMatchObject({ applied: 1, deferred: 0 });
  });
});

describe('UpdateScheduler — offscreen replay queue', () => {
  it('defers updates for offscreen elements when the gate is active', () => {
    const apply = vi.fn();
    const visible = new Set<Element>();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: (el) => visible.has(el),
      getCacheSize: () => 100, // above threshold
      visibilityGateThreshold: 50,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const el = document.createElement('p');
    scheduler.schedule(update(entry(el), 'v1'));
    scheduler.flushNow();
    expect(apply).not.toHaveBeenCalled();
    expect(scheduler.replayCount).toBe(1);
  });

  it('replays buffered value when notifyVisible is called', () => {
    const apply = vi.fn();
    const visible = new Set<Element>();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: (el) => visible.has(el),
      getCacheSize: () => 100,
      visibilityGateThreshold: 50,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const el = document.createElement('p');
    scheduler.schedule(update(entry(el), 'replay-me'));
    scheduler.flushNow();
    scheduler.notifyVisible(el);
    expect(apply).toHaveBeenCalledOnce();
    expect((apply.mock.calls[0]?.[0] as ScheduledUpdate).value).toBe('replay-me');
    expect(scheduler.replayCount).toBe(0);
  });

  it('notifyVisible without a buffered value is a no-op', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      isVisible: () => false,
      getCacheSize: () => 1,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    scheduler.notifyVisible(document.createElement('p'));
    expect(apply).not.toHaveBeenCalled();
  });

  it('does not defer when the gate threshold has not been crossed', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: () => false,
      getCacheSize: () => 10, // below threshold
      visibilityGateThreshold: 50,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    scheduler.schedule(update(entry(document.createElement('p')), 'v'));
    scheduler.flushNow();
    expect(apply).toHaveBeenCalledOnce();
  });

  it('disableVisibilityGate forces application regardless of size', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: () => false,
      getCacheSize: () => 1000,
      visibilityGateThreshold: 50,
      disableVisibilityGate: true,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    scheduler.schedule(update(entry(document.createElement('p')), 'v'));
    scheduler.flushNow();
    expect(apply).toHaveBeenCalledOnce();
  });

  it('forget drops both pending and replay state', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: () => false,
      getCacheSize: () => 1000,
      visibilityGateThreshold: 1,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const el = document.createElement('p');
    scheduler.schedule(update(entry(el), 'v'));
    scheduler.flushNow();
    expect(scheduler.replayCount).toBe(1);
    scheduler.forget(el);
    expect(scheduler.replayCount).toBe(0);
    expect(scheduler.pendingCount).toBe(0);
  });
});

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

  it('uses default scheduleFrame/cancelFrame when none provided', () => {
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
