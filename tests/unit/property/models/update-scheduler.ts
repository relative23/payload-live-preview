/** Model and commands for the `update-scheduler` state-machine properties. */

import { expect } from 'vitest';
import { type Command } from 'fast-check';
import { type MessageRevision } from '@core/message-bus';
import { UpdateScheduler, type ScheduledUpdate } from '@core/update-scheduler';
import type { CachedElement } from '@core/types';

export interface SchedulerApplication {
  readonly element: number;
  readonly value: number;
  readonly identity: MessageRevision;
}

export interface SchedulerModel {
  active: MessageRevision | null;
  cancelled: boolean;
  readonly pending: Map<number, SchedulerApplication>;
  readonly applied: SchedulerApplication[];
}

export interface SchedulerReal {
  readonly scheduler: UpdateScheduler;
  readonly targets: readonly CachedElement[];
  readonly applied: SchedulerApplication[];
}

export function compareIdentity(left: MessageRevision, right: MessageRevision): number {
  return left.generation === right.generation
    ? left.revision - right.revision
    : left.generation - right.generation;
}

export function sameIdentity(left: MessageRevision, right: MessageRevision | null): boolean {
  return right !== null && left.generation === right.generation && left.revision === right.revision;
}

export function createSchedulerReal(): SchedulerReal {
  const elements = Array.from({ length: 3 }, () => document.createElement('span'));
  const targets = elements.map((element, index): CachedElement => ({
    element,
    fieldName: `field-${String(index)}`,
    fieldType: 'text',
  }));
  const applied: SchedulerApplication[] = [];
  const scheduler = new UpdateScheduler(
    (update) => {
      const element = elements.indexOf(update.target.element as HTMLElement);
      if (element < 0 || update.identity === undefined || typeof update.value !== 'number') {
        throw new Error('scheduler model received an invalid application');
      }
      applied.push({ element, value: update.value, identity: update.identity });
    },
    {
      debounceMs: 1_000_000,
      isVisible: () => true,
      disableVisibilityGate: true,
      getCacheSize: () => targets.length,
    },
  );
  return { scheduler, targets, applied };
}

export function assertSchedulerState(model: SchedulerModel, real: SchedulerReal): void {
  expect(real.scheduler.pendingCount).toBe(model.pending.size);
  expect(real.scheduler.replayCount).toBe(0);
  expect(real.applied).toEqual(model.applied);
}

export class AcceptSchedulerRevision implements Command<SchedulerModel, SchedulerReal> {
  constructor(private readonly identity: MessageRevision) {}

  check(_model: Readonly<SchedulerModel>): boolean {
    return true;
  }

  run(model: SchedulerModel, real: SchedulerReal): void {
    real.scheduler.acceptRevision(this.identity);
    if (
      model.active === null ||
      (!sameIdentity(this.identity, model.active) &&
        compareIdentity(this.identity, model.active) >= 0)
    ) {
      model.active = this.identity;
      model.cancelled = false;
      model.pending.clear();
    }
    assertSchedulerState(model, real);
  }

  toString(): string {
    return `accept(${this.identity.generation}:${this.identity.revision})`;
  }
}

export class CancelSchedulerRevision implements Command<SchedulerModel, SchedulerReal> {
  constructor(private readonly identity: MessageRevision) {}

  check(_model: Readonly<SchedulerModel>): boolean {
    return true;
  }

  run(model: SchedulerModel, real: SchedulerReal): void {
    real.scheduler.cancelRevision(this.identity);
    if (sameIdentity(this.identity, model.active)) {
      model.cancelled = true;
      model.pending.clear();
    }
    assertSchedulerState(model, real);
  }

  toString(): string {
    return `cancel(${this.identity.generation}:${this.identity.revision})`;
  }
}

export class ScheduleValue implements Command<SchedulerModel, SchedulerReal> {
  constructor(
    private readonly identity: MessageRevision,
    private readonly element: number,
    private readonly value: number,
  ) {}

  check(_model: Readonly<SchedulerModel>): boolean {
    return true;
  }

  run(model: SchedulerModel, real: SchedulerReal): void {
    const target = real.targets[this.element];
    if (target === undefined) throw new Error('scheduler target is missing');
    const update: ScheduledUpdate = {
      target,
      value: this.value,
      allFields: {},
      identity: this.identity,
    };
    real.scheduler.schedule(update);
    if (!model.cancelled && sameIdentity(this.identity, model.active)) {
      model.pending.set(this.element, {
        element: this.element,
        value: this.value,
        identity: this.identity,
      });
    }
    assertSchedulerState(model, real);
  }

  toString(): string {
    return `schedule(${this.identity.generation}:${this.identity.revision},${String(this.element)},${String(this.value)})`;
  }
}

export class ForgetScheduledElement implements Command<SchedulerModel, SchedulerReal> {
  constructor(private readonly element: number) {}

  check(_model: Readonly<SchedulerModel>): boolean {
    return true;
  }

  run(model: SchedulerModel, real: SchedulerReal): void {
    const target = real.targets[this.element];
    if (target === undefined) throw new Error('scheduler target is missing');
    real.scheduler.forget(target.element);
    model.pending.delete(this.element);
    assertSchedulerState(model, real);
  }

  toString(): string {
    return `forget(${String(this.element)})`;
  }
}

export class FlushScheduler implements Command<SchedulerModel, SchedulerReal> {
  check(_model: Readonly<SchedulerModel>): boolean {
    return true;
  }

  run(model: SchedulerModel, real: SchedulerReal): void {
    const expected = [...model.pending.values()];
    const stats = real.scheduler.flushNow();
    expect(stats.applied).toBe(expected.length);
    model.applied.push(...expected);
    model.pending.clear();
    assertSchedulerState(model, real);
  }

  toString(): string {
    return 'flush';
  }
}

export class DestroyScheduler implements Command<SchedulerModel, SchedulerReal> {
  check(_model: Readonly<SchedulerModel>): boolean {
    return true;
  }

  run(model: SchedulerModel, real: SchedulerReal): void {
    real.scheduler.destroy();
    model.active = null;
    model.cancelled = false;
    model.pending.clear();
    assertSchedulerState(model, real);
  }

  toString(): string {
    return 'destroy';
  }
}
