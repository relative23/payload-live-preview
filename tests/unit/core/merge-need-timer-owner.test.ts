/**
 * ADR 0004 requires timer ownership even when host cancellation is ineffective.
 * These controls use controlled timer handles and the real DataMerger, but explicitly
 * deliver captured callbacks or reenter host calls. They do not claim that a
 * conforming browser delivers a callback after clearTimeout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataMerger, type MergeRequest } from '@core/data-merger';
import { MergeNeed, type CoalescedMerge } from '@core/merge-need';

const WINDOW_MS = 50;
type Timer = ReturnType<typeof setTimeout>;

interface CapturedTimer {
  readonly handle: Timer;
  readonly deliver: () => void;
}

/** Controlled handles stay owned here, including handles a failed source loses. */
function timerHostControl() {
  const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
  const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const captured: CapturedTimer[] = [];
  const active = new Set<Timer>();
  let onCancel: (() => void) | undefined;
  let onAcquire: (() => void) | undefined;

  vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    const handle = hostSetTimeout(callback, delay, ...args);
    if (delay === WINDOW_MS) {
      active.add(handle);
      captured.push({
        handle,
        deliver: () => {
          hostClearTimeout(handle);
          active.delete(handle);
          if (typeof callback !== 'function') throw new Error('Expected a timer callback');
          callback(...args);
        },
      });
      const hook = onAcquire;
      onAcquire = undefined;
      hook?.();
    }
    return handle;
  });
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation((handle) => {
    hostClearTimeout(handle);
    for (const owned of active) {
      if (owned === handle) active.delete(owned);
    }
    const hook = onCancel;
    onCancel = undefined;
    hook?.();
  });

  return {
    captured,
    active,
    cancelReentry(hook: () => void): void {
      onCancel = hook;
    },
    acquireReentry(hook: () => void): void {
      onAcquire = hook;
    },
    release(): void {
      onCancel = undefined;
      onAcquire = undefined;
      for (const handle of active) hostClearTimeout(handle);
      active.clear();
    },
  };
}

function requestFor(content: string): MergeRequest {
  return { collectionSlug: 'guides', data: { id: 1, content } };
}

function echoFetch() {
  return vi.fn<typeof fetch>((_url, init) => {
    if (typeof init?.body !== 'string') throw new Error('Expected the real merger body');
    const { data } = JSON.parse(init.body) as { data: Record<string, unknown> };
    return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
  });
}

describe('merge window ownership under ADR host reentry controls', () => {
  let host: ReturnType<typeof timerHostControl>;
  let fetchFn: ReturnType<typeof echoFetch>;
  let merger: DataMerger;
  let need: MergeNeed;

  beforeEach(() => {
    // The ADR shim controls the timer host, not the merger or its results.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(0);
    host = timerHostControl();
    fetchFn = echoFetch();
    merger = new DataMerger({ serverURL: 'https://cms.test', fetchFn });
    need = new MergeNeed();
  });

  afterEach(() => {
    host.release();
    need.destroy();
    merger.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function post(content: string, time: number): CoalescedMerge {
    vi.setSystemTime(time);
    return need.request(merger, WINDOW_MS, requestFor(content));
  }

  function timerAt(index: number): CapturedTimer {
    const timer = host.captured[index];
    if (timer === undefined) throw new Error(`Missing owned timer ${String(index)}`);
    return timer;
  }

  function deliver(index: number): void {
    timerAt(index).deliver();
  }

  it('an old window callback cannot flush or settle a newer window', async () => {
    await post('A', 0).result;
    const queuedB = post('B', 10);
    await post('C', 61).result;
    const queuedD = post('D', 70);
    let settledD = false;
    void queuedD.result.then(() => {
      settledD = true;
    });

    // Explicit ineffective-cancellation control, not native browser delivery.
    deliver(0);
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(settledD).toBe(false);
    expect(await queuedB.result).toEqual({ status: 'superseded' });

    deliver(1);
    expect(await queuedD.result).toEqual({
      status: 'merged',
      doc: { id: 1, content: 'D' },
    });
  });

  it('rescheduling keeps the shared promise but revokes the earlier timer owner', async () => {
    await post('A', 0).result;
    const queuedB = post('B', 10);
    const queuedC = post('C', 20);
    expect(queuedC.result).toBe(queuedB.result);
    let settled = false;
    void queuedC.result.then(() => {
      settled = true;
    });

    deliver(0);
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    deliver(1);
    expect(await queuedC.result).toEqual({
      status: 'merged',
      doc: { id: 1, content: 'C' },
    });
  });

  it('destroy revokes its window before cancellation can start a successor', async () => {
    await post('A', 0).result;
    const queuedA = post('A2', 10);
    const successors: CoalescedMerge[] = [];
    host.cancelReentry(() => {
      successors.push(post('B', 11), post('B2', 12));
    });

    need.destroy();
    expect(successors.map((result) => result.leading)).toEqual([true, false]);
    const newest = post('B3', 13);
    expect(newest.leading).toBe(false);
    expect(newest.result).toBe(successors[1]?.result);
    expect(await queuedA.result).toEqual({ status: 'superseded' });

    deliver(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    deliver(2);
    expect(await newest.result).toEqual({
      status: 'merged',
      doc: { id: 1, content: 'B3' },
    });
  });

  it('a cancel hook that destroys the owner prevents a subsequent timer acquisition', async () => {
    await post('A', 0).result;
    const queuedB = post('B', 10);
    host.cancelReentry(() => {
      need.destroy();
    });

    const queuedC = post('C', 20);
    expect(queuedC.result).toBe(queuedB.result);
    expect(await queuedC.result).toEqual({ status: 'superseded' });
    expect(host.captured).toHaveLength(1);
    expect(host.active.size).toBe(0);
    deliver(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a reentrant acquisition cancels its exact handle and preserves the newer timer', async () => {
    await post('A', 0).result;
    const successors: CoalescedMerge[] = [];
    host.acquireReentry(() => {
      successors.push(post('C', 20));
    });

    const queuedB = post('B', 10);
    expect(queuedB.result).toBe(successors[0]?.result);
    expect(host.captured).toHaveLength(2);
    expect(host.active.has(timerAt(0).handle)).toBe(false);
    expect(host.active.has(timerAt(1).handle)).toBe(true);
    deliver(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    deliver(1);
    expect(await queuedB.result).toEqual({
      status: 'merged',
      doc: { id: 1, content: 'C' },
    });
    expect(host.active.size).toBe(0);
  });

  it('leading cancellation cannot dispatch over a reentrant queued successor', async () => {
    await post('A', 0).result;
    const queuedB = post('B', 10);
    const successors: CoalescedMerge[] = [];
    host.cancelReentry(() => {
      successors.push(post('D', 62), post('E', 63));
    });

    const leadingC = post('C', 61);
    expect(leadingC.leading).toBe(true);
    expect(await leadingC.result).toEqual({ status: 'superseded' });
    expect(successors.map((result) => result.leading)).toEqual([false, false]);
    expect(successors[0]?.result).toBe(successors[1]?.result);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await queuedB.result).toEqual({ status: 'superseded' });

    deliver(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    deliver(2);
    expect(await successors[1]?.result).toEqual({
      status: 'merged',
      doc: { id: 1, content: 'E' },
    });
    expect(host.active.size).toBe(0);
  });
});
