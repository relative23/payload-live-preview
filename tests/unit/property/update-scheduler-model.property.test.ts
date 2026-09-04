import { describe, it, vi } from 'vitest';
import fc, { type Arbitrary, type Command } from 'fast-check';
import { propertyParameters } from './fast-check';
import {
  AcceptSchedulerRevision,
  CancelSchedulerRevision,
  DestroyScheduler,
  FlushScheduler,
  ForgetScheduledElement,
  ScheduleValue,
  type SchedulerModel,
  type SchedulerReal,
  createSchedulerReal,
} from './models/update-scheduler';

describe('UpdateScheduler ownership and coalescing properties', () => {
  it('models scheduler newest-revision ownership, coalescing, cancellation, and teardown', () => {
    const identity = fc.record({
      generation: fc.integer({ min: 1, max: 3 }),
      revision: fc.integer({ min: 1, max: 12 }),
    });
    const commands: Arbitrary<Command<SchedulerModel, SchedulerReal>>[] = [
      identity.map((value) => new AcceptSchedulerRevision(value)),
      identity.map((value) => new CancelSchedulerRevision(value)),
      fc
        .tuple(identity, fc.integer({ min: 0, max: 2 }), fc.integer())
        .map(([ownedBy, element, value]) => new ScheduleValue(ownedBy, element, value)),
      fc.integer({ min: 0, max: 2 }).map((element) => new ForgetScheduledElement(element)),
      fc.constant(new FlushScheduler()),
      fc.constant(new DestroyScheduler()),
    ];

    vi.useFakeTimers();
    try {
      fc.assert(
        fc.property(fc.commands(commands, { maxCommands: 60 }), (generated) => {
          let real: SchedulerReal | undefined;
          try {
            fc.modelRun(() => {
              real = createSchedulerReal();
              return {
                model: { active: null, cancelled: false, pending: new Map(), applied: [] },
                real,
              };
            }, generated);
          } finally {
            real?.scheduler.destroy();
          }
        }),
        propertyParameters(0x53434831, 80),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
