import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateScheduler, type ApplyUpdate, type ScheduledUpdate } from '@core/update-scheduler';
import { markNoWriteCallback } from '@core/internal-outcome';
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('UpdateScheduler — debounce + RAF', () => {
  it('keeps value-returning callbacks compatible with the public void contract', () => {
    const seen: ScheduledUpdate[] = [];
    const apply: ApplyUpdate = (scheduled) => seen.push(scheduled);
    const scheduler = new UpdateScheduler(apply, {
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
    });
    scheduler.schedule(update(entry(document.createElement('p')), 'value'));

    expect(scheduler.flushNow().applied).toBe(1);
    expect(seen).toHaveLength(1);
  });

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

  it('does not retain a handle returned after a synchronous frame callback completes', () => {
    const cancelFrame = vi.fn(() => {
      throw new Error('completed frame must not be cancelled');
    });
    const scheduler = new UpdateScheduler(vi.fn(), {
      debounceMs: 0,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (callback) => {
        callback(0);
        return 73;
      },
      cancelFrame,
    });
    scheduler.schedule(update(entry(document.createElement('p')), 'value'));
    vi.advanceTimersByTime(0);
    cancelFrame.mockClear();

    expect(() => scheduler.destroy()).not.toThrow();
    expect(cancelFrame).not.toHaveBeenCalled();
  });

  it('keeps an ineffectively cancelled older debounce callback inert', () => {
    const apply = vi.fn();
    const onFlush = vi.fn();
    const frames: FrameRequestCallback[] = [];
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 100,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (callback) => frames.push(callback),
      cancelFrame: () => {},
      onFlush,
    });
    const target = entry(document.createElement('p'));
    scheduler.schedule(update(target, 'A'));
    vi.advanceTimersByTime(50);
    const ineffectiveClearTimeout = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);

    try {
      scheduler.schedule(update(target, 'B'));
      vi.advanceTimersByTime(50);
      expect(frames).toHaveLength(0);
      expect(scheduler.pendingCount).toBe(1);
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(frames).toHaveLength(1);
      frames[0]?.(0);
      expect(apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: 'B' }));
      expect(onFlush).toHaveBeenCalledOnce();
    } finally {
      ineffectiveClearTimeout.mockRestore();
    }
  });

  it('keeps an ineffectively cancelled debounce callback inert after destroy and reuse', () => {
    const apply = vi.fn();
    const onFlush = vi.fn();
    const frames: FrameRequestCallback[] = [];
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 100,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (callback) => frames.push(callback),
      cancelFrame: () => {},
      onFlush,
    });
    const target = entry(document.createElement('p'));
    scheduler.schedule(update(target, 'A'));
    vi.advanceTimersByTime(50);
    const ineffectiveClearTimeout = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);

    try {
      scheduler.destroy();
      scheduler.schedule(update(target, 'B'));
      vi.advanceTimersByTime(50);
      expect(frames).toHaveLength(0);
      expect(scheduler.pendingCount).toBe(1);
      expect(onFlush).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);
      expect(frames).toHaveLength(1);
      frames[0]?.(0);
      expect(apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: 'B' }));
      expect(onFlush).toHaveBeenCalledOnce();
    } finally {
      ineffectiveClearTimeout.mockRestore();
    }
  });

  it('keeps a stale cancelled frame from flushing replacement work', () => {
    const apply = vi.fn();
    const onFlush = vi.fn();
    const frames: FrameRequestCallback[] = [];
    const cancelFrame = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (callback) => frames.push(callback),
      cancelFrame,
      onFlush,
    });
    const target = entry(document.createElement('p'));
    scheduler.schedule(update(target, 'A'));
    vi.advanceTimersByTime(0);
    scheduler.schedule(update(target, 'B'));
    vi.advanceTimersByTime(0);

    expect(frames).toHaveLength(2);
    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(1);
    frames[0]?.(0);
    expect(apply).not.toHaveBeenCalled();
    expect(onFlush).not.toHaveBeenCalled();
    expect(scheduler.pendingCount).toBe(1);

    frames[1]?.(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: 'B' }));
    expect(onFlush).toHaveBeenCalledOnce();
  });

  it('keeps a stale cancelled frame inert after destroy and reuse', () => {
    const apply = vi.fn();
    const onFlush = vi.fn();
    const frames: FrameRequestCallback[] = [];
    const cancelFrame = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (callback) => frames.push(callback),
      cancelFrame,
      onFlush,
    });
    const target = entry(document.createElement('p'));
    scheduler.schedule(update(target, 'A'));
    vi.advanceTimersByTime(0);
    scheduler.destroy();
    scheduler.schedule(update(target, 'B'));
    vi.advanceTimersByTime(0);

    expect(frames).toHaveLength(2);
    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(1);
    frames[0]?.(0);
    expect(apply).not.toHaveBeenCalled();
    expect(onFlush).not.toHaveBeenCalled();
    expect(scheduler.pendingCount).toBe(1);

    frames[1]?.(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: 'B' }));
    expect(onFlush).toHaveBeenCalledOnce();
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

  it('flushNow cancels an already-requested frame before applying it synchronously', () => {
    const apply = vi.fn();
    const onFlush = vi.fn();
    const cancelFrame = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: () => 73,
      cancelFrame,
      onFlush,
    });
    scheduler.schedule(update(entry(document.createElement('p')), 'v'));
    vi.advanceTimersByTime(0);

    const stats = scheduler.flushNow();

    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(73);
    expect(stats.applied).toBe(1);
    expect(apply).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledOnce();
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

  it('keeps cancellation terminal for the active revision', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const identity = { generation: 1, revision: 1 };
    const target = entry(document.createElement('p'));
    scheduler.acceptRevision(identity);
    scheduler.cancelRevision(identity);

    scheduler.schedule({ ...update(target, 'must-not-apply'), identity });
    scheduler.flushNow();

    expect(apply).not.toHaveBeenCalled();
    expect(scheduler.pendingCount).toBe(0);
  });

  it('ignores duplicate, older, unrelated, and mismatched revision operations', () => {
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 100,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
    });
    const current = { generation: 2, revision: 2 };
    const target = entry(document.createElement('p'));
    scheduler.acceptRevision(current);
    scheduler.schedule({ ...update(target, 'current'), identity: current });

    scheduler.acceptRevision(current);
    scheduler.acceptRevision({ generation: 1, revision: 99 });
    scheduler.acceptRevision({ generation: 2, revision: 1 });
    scheduler.cancelRevision({ generation: 2, revision: 1 });
    scheduler.schedule({
      ...update(target, 'future-mismatch'),
      identity: { generation: 2, revision: 3 },
    });

    expect(scheduler.pendingCount).toBe(1);
    scheduler.flushNow();
    expect(apply).toHaveBeenCalledOnce();
    expect((apply.mock.calls[0]?.[0] as ScheduledUpdate).value).toBe('current');
  });

  it('cancels an already-requested frame before replacing or destroying it', () => {
    const cancelFrame = vi.fn();
    let nextHandle = 0;
    const scheduler = new UpdateScheduler(vi.fn(), {
      debounceMs: 0,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: () => (nextHandle += 1),
      cancelFrame,
    });
    const target = entry(document.createElement('p'));

    scheduler.schedule(update(target, 'A'));
    vi.advanceTimersByTime(0);
    scheduler.schedule(update(target, 'B'));
    vi.advanceTimersByTime(0);
    scheduler.destroy();

    expect(cancelFrame.mock.calls).toEqual([[1], [2]]);
    expect(scheduler.pendingCount).toBe(0);
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

  it('never replays an older buffered value after a newer visible update', () => {
    const applied: unknown[] = [];
    const visible = new Set<Element>();
    const scheduler = new UpdateScheduler(
      (scheduled) => {
        applied.push(scheduled.value);
      },
      {
        debounceMs: 0,
        isVisible: (el) => visible.has(el),
        getCacheSize: () => 100,
        visibilityGateThreshold: 50,
        scheduleFrame: (cb) => {
          cb(0);
          return 1;
        },
        cancelFrame: () => {},
      },
    );
    const el = document.createElement('p');
    const target = entry(el);
    scheduler.schedule(update(target, 'A'));
    scheduler.flushNow();
    expect(scheduler.replayCount).toBe(1);

    visible.add(el);
    scheduler.schedule(update(target, 'B'));
    scheduler.flushNow();
    expect(applied).toEqual(['B']);

    scheduler.notifyVisible(el);
    expect(applied).toEqual(['B']);
    expect(scheduler.replayCount).toBe(0);
  });

  it('drops an obsolete entry when the visibility predicate accepts a newer revision', () => {
    const applied = vi.fn();
    const onFlush = vi.fn();
    const first = { generation: 1, revision: 1 };
    const second = { generation: 1, revision: 2 };
    const scheduler = new UpdateScheduler(applied, {
      debounceMs: 100,
      isVisible: () => {
        scheduler.acceptRevision(second);
        return false;
      },
      getCacheSize: () => 100,
      visibilityGateThreshold: 1,
      onFlush,
    });
    scheduler.acceptRevision(first);
    scheduler.schedule({
      ...update(entry(document.createElement('p')), 'obsolete'),
      identity: first,
    });

    scheduler.flushNow();

    expect(applied).not.toHaveBeenCalled();
    expect(scheduler.replayCount).toBe(0);
    expect(onFlush).toHaveBeenLastCalledWith(expect.objectContaining({ applied: 0, deferred: 0 }));
    expect(onFlush.mock.lastCall?.[0]).not.toHaveProperty('identity');
  });

  it('drops old pending work when the cache-size callback accepts a newer revision', () => {
    const applied = vi.fn();
    const onFlush = vi.fn();
    const first = { generation: 1, revision: 1 };
    const second = { generation: 1, revision: 2 };
    const scheduler = new UpdateScheduler(applied, {
      debounceMs: 100,
      isVisible: () => false,
      getCacheSize: () => {
        scheduler.acceptRevision(second);
        return 100;
      },
      visibilityGateThreshold: 1,
      onFlush,
    });
    scheduler.acceptRevision(first);
    scheduler.schedule({
      ...update(entry(document.createElement('p')), 'obsolete'),
      identity: first,
    });

    scheduler.flushNow();

    expect(applied).not.toHaveBeenCalled();
    expect(scheduler.pendingCount).toBe(0);
    expect(scheduler.replayCount).toBe(0);
    expect(onFlush).toHaveBeenLastCalledWith(expect.objectContaining({ applied: 0, deferred: 0 }));
    expect(onFlush.mock.lastCall?.[0]).not.toHaveProperty('identity');
  });

  it('reports an applied visibility replay through onFlush', () => {
    const onFlush = vi.fn();
    const scheduler = new UpdateScheduler(() => {}, {
      debounceMs: 0,
      isVisible: () => false,
      getCacheSize: () => 100,
      visibilityGateThreshold: 50,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
      onFlush,
    });
    const el = document.createElement('p');
    scheduler.schedule(update(entry(el), 'replay'));
    scheduler.flushNow();
    onFlush.mockClear();

    scheduler.notifyVisible(el);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]?.[0]).toMatchObject({ applied: 1, deferred: 0 });
  });

  it('reports a refused visibility replay as zero applied writes', () => {
    const onFlush = vi.fn();
    const scheduler = new UpdateScheduler(
      markNoWriteCallback(() => false),
      {
        debounceMs: 0,
        isVisible: () => false,
        getCacheSize: () => 100,
        visibilityGateThreshold: 50,
        scheduleFrame: (cb) => {
          cb(0);
          return 1;
        },
        cancelFrame: () => {},
        onFlush,
      },
    );
    const element = document.createElement('p');
    scheduler.schedule(update(entry(element), 'refused'));
    scheduler.flushNow();
    onFlush.mockClear();

    scheduler.notifyVisible(element);

    expect(onFlush).toHaveBeenCalledWith(expect.objectContaining({ applied: 0, deferred: 0 }));
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

  it('retargets retained pending and replay work to fresh cache metadata', () => {
    const apply = vi.fn();
    let visible = true;
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 100,
      isVisible: () => visible,
      getCacheSize: () => 100,
      visibilityGateThreshold: 1,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const el = document.createElement('p');
    const oldTarget = entry(el);
    const pendingTarget: CachedElement = {
      ...oldTarget,
      targetAttribute: 'data-pending-target',
    };
    scheduler.schedule(update(oldTarget, 'pending'));

    scheduler.retarget(pendingTarget);
    scheduler.flushNow();
    expect((apply.mock.calls[0]?.[0] as ScheduledUpdate).target).toBe(pendingTarget);

    visible = false;
    scheduler.schedule(update(pendingTarget, 'replay'));
    scheduler.flushNow();
    const replayTarget: CachedElement = {
      ...pendingTarget,
      targetAttribute: 'data-replay-target',
    };
    scheduler.retarget(replayTarget);
    scheduler.notifyVisible(el);
    expect((apply.mock.calls[1]?.[0] as ScheduledUpdate).target).toBe(replayTarget);
  });

  it('retarget discards buffered work when the field binding changed', () => {
    const scheduler = new UpdateScheduler(vi.fn(), {
      debounceMs: 100,
      isVisible: () => false,
      getCacheSize: () => 100,
      visibilityGateThreshold: 1,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const el = document.createElement('p');
    const original = entry(el, 'before');
    scheduler.schedule(update(original, 'replay'));
    scheduler.flushNow();
    scheduler.schedule(update(original, 'pending'));
    expect(scheduler.replayCount).toBe(1);
    expect(scheduler.pendingCount).toBe(1);

    scheduler.retarget(entry(el, 'after'));

    expect(scheduler.pendingCount).toBe(0);
    expect(scheduler.replayCount).toBe(0);
  });

  it('retarget discards values prepared for a different element locale', () => {
    const scheduler = new UpdateScheduler(vi.fn(), {
      debounceMs: 100,
      isVisible: () => false,
      getCacheSize: () => 100,
      visibilityGateThreshold: 1,
      scheduleFrame: (cb) => {
        cb(0);
        return 1;
      },
      cancelFrame: () => {},
    });
    const el = document.createElement('p');
    const german: CachedElement = { ...entry(el), locale: 'de' };
    const french: CachedElement = { ...german, locale: 'fr' };
    scheduler.schedule(update(german, 'replay'));
    scheduler.flushNow();
    scheduler.schedule(update(german, 'pending'));

    scheduler.retarget(french);

    expect(scheduler.pendingCount).toBe(0);
    expect(scheduler.replayCount).toBe(0);
  });

  it('retargets work that has not yet applied in a reentrant active flush', () => {
    const firstElement = document.createElement('p');
    const secondElement = document.createElement('p');
    const firstTarget = entry(firstElement, 'first');
    const secondTarget = entry(secondElement, 'second');
    const rebuiltSecond: CachedElement = {
      ...secondTarget,
      targetAttribute: 'data-rebuilt-target',
    };
    const appliedTargets: CachedElement[] = [];
    const scheduler = new UpdateScheduler(
      (scheduled) => {
        appliedTargets.push(scheduled.target);
        if (scheduled.target === firstTarget) scheduler.retarget(rebuiltSecond);
      },
      {
        debounceMs: 100,
        isVisible: () => true,
        disableVisibilityGate: true,
        getCacheSize: () => 2,
      },
    );
    scheduler.schedule(update(firstTarget, 'first'));
    scheduler.schedule(update(secondTarget, 'second'));

    scheduler.flushNow();

    expect(appliedTargets).toEqual([firstTarget, rebuiltSecond]);
  });

  it('forgets work that has not yet applied in a reentrant active flush', () => {
    const firstElement = document.createElement('p');
    const secondElement = document.createElement('p');
    const firstTarget = entry(firstElement, 'first');
    const secondTarget = entry(secondElement, 'second');
    const appliedTargets: CachedElement[] = [];
    const scheduler = new UpdateScheduler(
      (scheduled) => {
        appliedTargets.push(scheduled.target);
        if (scheduled.target === firstTarget) scheduler.forget(secondElement);
      },
      {
        debounceMs: 100,
        isVisible: () => true,
        disableVisibilityGate: true,
        getCacheSize: () => 2,
      },
    );
    scheduler.schedule(update(firstTarget, 'first'));
    scheduler.schedule(update(secondTarget, 'second'));

    scheduler.flushNow();

    expect(appliedTargets).toEqual([firstTarget]);
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
