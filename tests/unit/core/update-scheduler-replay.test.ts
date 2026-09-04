import { describe, expect, it, vi } from 'vitest';
import { UpdateScheduler, type FlushStats, type ScheduledUpdate } from '@core/update-scheduler';
import { markNoWriteCallback } from '@core/internal-outcome';
import type { CachedElement } from '@core/types';
import { entry, update } from './update-scheduler-harness';

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
  it('names the replayed field in the flush stats, and names nothing when nothing applied', () => {
    // The visible-replay path builds its own single-entry stats, separate from
    // the batch flush. Both of its branches were unexercised: the mutation
    // baseline surfaced them as survivors the moment appliedFields was added.
    const visible = new Set<Element>();
    const stats: FlushStats[] = [];
    const applyResult = { value: undefined as unknown };
    const scheduler = new UpdateScheduler(
      markNoWriteCallback(() => applyResult.value),
      {
        debounceMs: 0,
        isVisible: (el) => visible.has(el),
        getCacheSize: () => 100,
        visibilityGateThreshold: 50,
        onFlush: (s) => stats.push(s),
        scheduleFrame: (cb) => {
          cb(0);
          return 1;
        },
        cancelFrame: () => {},
      },
    );

    const el = document.createElement('p');
    scheduler.schedule(update(entry(el), 'replay-me'));
    scheduler.flushNow();
    stats.length = 0;
    scheduler.notifyVisible(el);

    expect(stats).toHaveLength(1);
    expect(stats[0]?.applied).toBe(1);
    expect(stats[0]?.appliedFields).toEqual([entry(el).fieldName]);

    // A renderer that declines the write must name no field either.
    applyResult.value = false;
    const other = document.createElement('p');
    scheduler.schedule(update(entry(other), 'declined'));
    scheduler.flushNow();
    stats.length = 0;
    scheduler.notifyVisible(other);

    expect(stats).toHaveLength(1);
    expect(stats[0]?.applied).toBe(0);
    expect(stats[0]?.appliedFields).toEqual([]);
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
});
