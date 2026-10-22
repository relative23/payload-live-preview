/**
 * A write waits for a frame, and only for so long. On 2026-10-22 WebKit gave a
 * visible cross-origin preview frame no animation frame for seconds
 * (`animationFramesIn600ms: 0` in the real-admin suite's own report): the
 * merged document had arrived and the page kept the old text. The fallback
 * timer writes when the frame does not come; whichever comes first writes and
 * the other does nothing.
 */

import { describe, expect, it, vi } from 'vitest';
import { UpdateScheduler } from '@core/update-scheduler';
import { entry, update } from './update-scheduler-harness';

function schedulerWith(frames: FrameRequestCallback[], apply: () => void): UpdateScheduler {
  return new UpdateScheduler(apply, {
    debounceMs: 50,
    isVisible: () => true,
    disableVisibilityGate: true,
    getCacheSize: () => 1,
    scheduleFrame: (callback) => frames.push(callback),
    cancelFrame: () => {},
  });
}

describe('UpdateScheduler — a frame that does not come', () => {
  it('writes after the fallback when the browser gives no frame', () => {
    const frames: FrameRequestCallback[] = [];
    const apply = vi.fn();
    const scheduler = schedulerWith(frames, apply);

    scheduler.schedule(update(entry(document.createElement('p')), 'A'));
    vi.advanceTimersByTime(99);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(frames).toHaveLength(1);
    expect(apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: 'A' }));
    scheduler.destroy();
  });

  it('lets the frame write when it comes first, and the fallback then does nothing', () => {
    const frames: FrameRequestCallback[] = [];
    const apply = vi.fn();
    const scheduler = schedulerWith(frames, apply);

    scheduler.schedule(update(entry(document.createElement('p')), 'A'));
    vi.advanceTimersByTime(16);
    frames[0]?.(16);
    vi.advanceTimersByTime(500);

    expect(apply).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    scheduler.destroy();
  });

  it('ignores a frame that arrives after the fallback wrote', () => {
    const frames: FrameRequestCallback[] = [];
    const apply = vi.fn();
    const scheduler = schedulerWith(frames, apply);

    scheduler.schedule(update(entry(document.createElement('p')), 'A'));
    vi.advanceTimersByTime(100);
    frames[0]?.(100);

    expect(apply).toHaveBeenCalledOnce();
    scheduler.destroy();
  });

  it('keeps writing a burst through the fallback while no frame comes', () => {
    const frames: FrameRequestCallback[] = [];
    const apply = vi.fn();
    const scheduler = schedulerWith(frames, apply);
    const target = entry(document.createElement('p'));

    scheduler.schedule(update(target, 'A'));
    vi.advanceTimersByTime(100);
    scheduler.schedule(update(target, 'AB'));
    vi.advanceTimersByTime(50 + 100);

    expect(apply.mock.calls.map(([written]) => (written as { value: unknown }).value)).toEqual([
      'A',
      'AB',
    ]);
    scheduler.destroy();
  });

  it('cancels the frame it asked for when the fallback writes first', () => {
    const frames: FrameRequestCallback[] = [];
    const cancelFrame = vi.fn();
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 50,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
      scheduleFrame: (callback) => frames.push(callback),
      cancelFrame,
    });

    scheduler.schedule(update(entry(document.createElement('p')), 'A'));
    vi.advanceTimersByTime(100);

    expect(apply).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(1);
    scheduler.destroy();
  });

  it('leaves no fallback behind when the frame ran synchronously', () => {
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

    scheduler.schedule(update(entry(document.createElement('p')), 'A'));

    expect(apply).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    scheduler.destroy();
  });

  it('writes on the next task, not after the fallback, where the host has no animation frames', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
    const apply = vi.fn();
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 50,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 1,
    });

    scheduler.schedule(update(entry(document.createElement('p')), 'A'));
    vi.advanceTimersByTime(0);

    expect(apply).toHaveBeenCalledOnce();
    scheduler.destroy();
  });

  it('writes nothing after destroy, frame or fallback', () => {
    const frames: FrameRequestCallback[] = [];
    const apply = vi.fn();
    const scheduler = schedulerWith(frames, apply);

    scheduler.schedule(update(entry(document.createElement('p')), 'A'));
    scheduler.destroy();
    vi.advanceTimersByTime(1000);
    frames[0]?.(1000);

    expect(apply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
