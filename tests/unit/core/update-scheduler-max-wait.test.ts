import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateScheduler, type ScheduledUpdate } from '@core/update-scheduler';
import type { CachedElement } from '@core/types';

/** Key repeat schedules faster than the debounce; the flush must still happen. */

function update(element: Element, value: unknown): ScheduledUpdate {
  const target: CachedElement = { element, fieldName: 'f', fieldType: 'text' };
  return { target, value, allFields: {} };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('UpdateScheduler — max wait', () => {
  it('flushes within four debounce windows under continuous scheduling', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 50,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const element = document.createElement('p');
    for (let elapsed = 0; elapsed < 2_000; elapsed += 30) {
      scheduler.schedule(update(element, elapsed));
      vi.advanceTimersByTime(30);
    }
    expect(apply.mock.calls.length).toBeGreaterThanOrEqual(9);
    vi.advanceTimersByTime(50);
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ value: 1_980 }));
  });

  it('honours an explicit maxWaitMs and clears it on a flush', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 50,
      maxWaitMs: 120,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const element = document.createElement('p');
    scheduler.schedule(update(element, 1));
    vi.advanceTimersByTime(40);
    scheduler.schedule(update(element, 2));
    vi.advanceTimersByTime(40);
    scheduler.schedule(update(element, 3));
    vi.advanceTimersByTime(40);
    expect(apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: 3 }));
    scheduler.destroy();
  });
});
