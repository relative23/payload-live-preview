import { describe, expect, it, vi } from 'vitest';
import { UpdateScheduler } from '@core/update-scheduler';
import type { CachedElement } from '@core/types';
import { entry, update } from './update-scheduler-harness';

describe('UpdateScheduler — replay across revisions', () => {
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

describe('UpdateScheduler — reentrant host cancellation', () => {
  function fixture() {
    const apply = vi.fn();
    const target = entry(document.createElement('p'));
    const first = { generation: 1, revision: 1 };
    const next = { generation: 1, revision: 2 };
    const newest = { generation: 1, revision: 3 };
    let onCancel: (() => void) | undefined;
    const scheduler = new UpdateScheduler(apply, {
      debounceMs: 0,
      isVisible: () => true,
      getCacheSize: () => 1,
      disableVisibilityGate: true,
      scheduleFrame: () => 1,
      cancelFrame: () => {
        const callback = onCancel;
        onCancel = undefined;
        callback?.();
      },
    });
    scheduler.acceptRevision(first);
    scheduler.schedule({ ...update(target, 'A'), revision: first });
    return {
      apply,
      target,
      first,
      next,
      newest,
      scheduler,
      reenter: (callback: () => void) => {
        onCancel = callback;
      },
    };
  }

  it.each(['accept', 'cancel'] as const)(
    'keeps a newer revision accepted while the host cancels an older %s',
    (operation) => {
      const { apply, target, first, next, newest, scheduler, reenter } = fixture();
      reenter(() => {
        scheduler.acceptRevision(newest);
        scheduler.schedule({ ...update(target, 'C'), revision: newest });
      });
      try {
        if (operation === 'accept') scheduler.acceptRevision(next);
        else scheduler.cancelRevision(first);
        scheduler.flushNow();
        expect(apply).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ value: 'C', revision: newest }),
        );
      } finally {
        scheduler.destroy();
      }
    },
  );

  it('keeps work for the incoming revision scheduled inside host cancellation', () => {
    const { apply, target, next, scheduler, reenter } = fixture();
    reenter(() => {
      scheduler.acceptRevision(next);
      scheduler.schedule({ ...update(target, 'B'), revision: next });
    });
    try {
      scheduler.acceptRevision(next);
      scheduler.flushNow();
      expect(apply).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ value: 'B', revision: next }),
      );
    } finally {
      scheduler.destroy();
    }
  });

  it('does not revive the incoming revision after host cancellation destroys it', () => {
    const { apply, target, next, scheduler, reenter } = fixture();
    reenter(() => scheduler.destroy());
    try {
      scheduler.acceptRevision(next);
      scheduler.schedule({ ...update(target, 'B'), revision: next });
      scheduler.flushNow();
      expect(apply).not.toHaveBeenCalled();
    } finally {
      scheduler.destroy();
    }
  });

  it.each(['flush', 'visible'] as const)(
    'revokes old %s work before invoking host cancellation during teardown',
    (operation) => {
      const apply = vi.fn();
      const target = entry(document.createElement('p'));
      const revision = { generation: 1, revision: 1 };
      let onCancel: (() => void) | undefined;
      const scheduler = new UpdateScheduler(apply, {
        debounceMs: 0,
        isVisible: () => false,
        getCacheSize: () => 100,
        visibilityGateThreshold: 1,
        disableVisibilityGate: operation === 'flush',
        scheduleFrame: () => 1,
        cancelFrame: () => {
          const callback = onCancel;
          onCancel = undefined;
          callback?.();
        },
      });
      scheduler.acceptRevision(revision);
      scheduler.schedule({ ...update(target, 'A'), revision });
      if (operation === 'visible') {
        scheduler.flushNow();
        expect(scheduler.replayCount).toBe(1);
        scheduler.schedule({ ...update(target, 'buffered A'), revision });
      }
      onCancel = () => {
        if (operation === 'flush') scheduler.flushNow();
        else scheduler.notifyVisible(target.element);
      };
      try {
        scheduler.destroy();
        expect(apply).not.toHaveBeenCalled();
        expect(scheduler.pendingCount).toBe(0);
        expect(scheduler.replayCount).toBe(0);
      } finally {
        scheduler.destroy();
      }
    },
  );

  it.each([true, false])(
    'releases callback-created frames before full teardown returns (revisioned: %s)',
    (revisioned) => {
      const frames = new Map<number, FrameRequestCallback>();
      const onFlush = vi.fn();
      const apply = vi.fn();
      const target = entry(document.createElement('p'));
      const first = { generation: 1, revision: 1 };
      const next = { generation: 1, revision: 2 };
      let nextHandle = 0;
      let onCancel: (() => void) | undefined;
      const scheduler = new UpdateScheduler(apply, {
        debounceMs: 0,
        isVisible: () => true,
        getCacheSize: () => 1,
        disableVisibilityGate: true,
        onFlush,
        scheduleFrame: (callback) => {
          const handle = ++nextHandle;
          frames.set(handle, callback);
          return handle;
        },
        cancelFrame: (handle) => {
          frames.delete(handle);
          const callback = onCancel;
          onCancel = undefined;
          callback?.();
        },
      });
      scheduler.acceptRevision(first);
      scheduler.schedule({ ...update(target, 'A'), revision: first });
      onCancel = () => {
        scheduler.destroy();
        scheduler.acceptRevision(next);
        scheduler.schedule({ ...update(target, 'B'), ...(revisioned ? { revision: next } : {}) });
      };
      try {
        scheduler.destroy();
        expect.soft(frames.size).toBe(0);
        for (const callback of frames.values()) callback(0);
        expect(onFlush).not.toHaveBeenCalled();
        expect(apply).not.toHaveBeenCalled();
      } finally {
        scheduler.destroy();
      }
    },
  );

  it('drops callback-created work during full teardown and allows a later fresh owner', () => {
    const { apply, target, newest, scheduler, reenter } = fixture();
    reenter(() => {
      scheduler.acceptRevision(newest);
      scheduler.schedule({ ...update(target, 'C'), revision: newest });
    });
    try {
      scheduler.destroy();
      scheduler.flushNow();
      expect(apply).not.toHaveBeenCalled();
      const restarted = { generation: 2, revision: 1 };
      scheduler.acceptRevision(restarted);
      scheduler.schedule({ ...update(target, 'restart'), revision: restarted });
      scheduler.flushNow();
      expect(apply).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ value: 'restart', revision: restarted }),
      );
      scheduler.destroy();
      scheduler.schedule(update(target, 'unversioned restart'));
      scheduler.flushNow();
      expect(apply).toHaveBeenLastCalledWith(
        expect.objectContaining({ value: 'unversioned restart', revision: undefined }),
      );
      expect(apply).toHaveBeenCalledTimes(2);
    } finally {
      scheduler.destroy();
    }
  });
});
