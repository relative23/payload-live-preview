/**
 * The leading edge of the debounce: the write that opens a quiet phase goes out
 * on the next frame, and the window it opens is what the rest of the burst
 * waits for. Measured before this existed, an isolated keystroke cost 66.6 ms
 * p95 in jsdom, of which 50 ms was a window that had nothing to coalesce.
 *
 * The frame scheduler here collects callbacks instead of running them, because
 * the distinction under test is "a frame was asked for" against "a timer was
 * armed" — a synchronous frame would hide it.
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

describe('UpdateScheduler — leading edge', () => {
  it('asks for a frame straight away instead of waiting out the window', () => {
    const frames: FrameRequestCallback[] = [];
    const apply = vi.fn();
    const scheduler = schedulerWith(frames, apply);

    scheduler.schedule(update(entry(document.createElement('p')), 'A'));

    expect(frames).toHaveLength(1);
    // Not "a shorter debounce": no timer is armed for this write at all.
    expect(vi.getTimerCount()).toBe(0);
    frames[0]?.(0);
    expect(apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: 'A' }));
    scheduler.destroy();
  });

  it('makes the rest of the burst wait for the window the leading write opened', () => {
    const frames: FrameRequestCallback[] = [];
    const apply = vi.fn();
    const scheduler = schedulerWith(frames, apply);
    const target = entry(document.createElement('p'));

    scheduler.schedule(update(target, 'A'));
    frames[0]?.(0);
    vi.advanceTimersByTime(20);
    scheduler.schedule(update(target, 'B'));
    vi.advanceTimersByTime(49);
    expect(frames).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(frames).toHaveLength(2);
    frames[1]?.(0);
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'B' }));
    scheduler.destroy();
  });

  it('leads again once the page has been quiet for a window', () => {
    const frames: FrameRequestCallback[] = [];
    const scheduler = schedulerWith(frames, vi.fn());
    const target = entry(document.createElement('p'));

    scheduler.schedule(update(target, 'A'));
    frames[0]?.(0);
    vi.advanceTimersByTime(50);
    scheduler.schedule(update(target, 'B'));

    expect(frames).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    scheduler.destroy();
  });

  it('carries the writes that follow it in the same tick, in one flush', () => {
    const frames: FrameRequestCallback[] = [];
    const onFlush = vi.fn();
    const scheduler = new UpdateScheduler(vi.fn(), {
      debounceMs: 50,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => 2,
      scheduleFrame: (callback) => frames.push(callback),
      cancelFrame: () => {},
      onFlush,
    });

    // One message schedules every binding it moved; the frame the first one
    // asked for is already on its way, so the rest ride with it.
    scheduler.schedule(update(entry(document.createElement('p'), 'title'), 'A'));
    scheduler.schedule(update(entry(document.createElement('p'), 'subtitle'), 'B'));
    expect(frames).toHaveLength(1);
    frames[0]?.(0);
    expect(onFlush).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ applied: 2 }));

    // And the window that write opened owes nothing: without this, every
    // message left a timer behind that flushed an empty buffer.
    vi.advanceTimersByTime(500);
    expect(frames).toHaveLength(1);
    expect(onFlush).toHaveBeenCalledOnce();
    scheduler.destroy();
  });

  it('leads once more after destroy, because a restarted page is quiet again', () => {
    const frames: FrameRequestCallback[] = [];
    const scheduler = schedulerWith(frames, vi.fn());
    const target = entry(document.createElement('p'));

    scheduler.schedule(update(target, 'A'));
    frames[0]?.(0);
    scheduler.destroy();
    scheduler.schedule(update(target, 'B'));

    expect(frames).toHaveLength(2);
    scheduler.destroy();
  });
});
