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
