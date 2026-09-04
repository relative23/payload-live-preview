import { describe, expect, it, vi } from 'vitest';
import { UpdateScheduler, type ApplyUpdate, type ScheduledUpdate } from '@core/update-scheduler';
import { entry, update } from './update-scheduler-harness';

describe('UpdateScheduler — debounce and frame batching', () => {
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
