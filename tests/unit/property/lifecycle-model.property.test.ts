import { describe, expect, it, vi } from 'vitest';
import fc, { type Arbitrary, type AsyncCommand, type Command } from 'fast-check';
import { MessageBus, type MessageRevision } from '@core/message-bus';
import { UpdateScheduler, type ScheduledUpdate } from '@core/update-scheduler';
import type { CachedElement, FieldRenderer } from '@core/types';
import { EventEmitter } from '@events/emitter';
import { PluginManager } from '@plugins/manager';
import { propertyParameters } from './fast-check';

const TRUSTED_ORIGIN = 'https://admin.example.test';

interface BusDelivery {
  readonly value: number;
  readonly generation: number;
  readonly revision: number;
}

interface BusModel {
  attached: boolean;
  generation: number;
  revision: number;
  readonly delivered: BusDelivery[];
}

interface BusReal {
  readonly bus: MessageBus;
  readonly target: Window & { dispatchEvent: (event: Event) => boolean };
  readonly delivered: BusDelivery[];
}

function createBusReal(): BusReal {
  const delivered: BusDelivery[] = [];
  const target = new EventTarget() as unknown as Window & {
    dispatchEvent: (event: Event) => boolean;
  };
  const bus = new MessageBus((origin) => origin === TRUSTED_ORIGIN, {
    onUpdate: (message, _origin, identity) => {
      const value = message.data?.['sequence'];
      if (typeof value !== 'number' || identity === undefined) {
        throw new Error('model message lost its value or identity');
      }
      delivered.push({ value, ...identity });
    },
    onDocumentEvent: () => undefined,
  });
  return { bus, target, delivered };
}

function assertBusState(model: BusModel, real: BusReal): void {
  expect(real.delivered).toEqual(model.delivered);
}

class AttachBus implements Command<BusModel, BusReal> {
  check(_model: Readonly<BusModel>): boolean {
    return true;
  }

  run(model: BusModel, real: BusReal): void {
    real.bus.attach(real.target);
    if (!model.attached) {
      model.attached = true;
      model.generation += 1;
    }
    assertBusState(model, real);
  }

  toString(): string {
    return 'attach';
  }
}

class DetachBus implements Command<BusModel, BusReal> {
  check(_model: Readonly<BusModel>): boolean {
    return true;
  }

  run(model: BusModel, real: BusReal): void {
    real.bus.detach();
    model.attached = false;
    assertBusState(model, real);
  }

  toString(): string {
    return 'detach';
  }
}

class AdvanceBusGeneration implements Command<BusModel, BusReal> {
  check(_model: Readonly<BusModel>): boolean {
    return true;
  }

  run(model: BusModel, real: BusReal): void {
    expect(real.bus.advanceGeneration()).toBe(model.attached);
    if (model.attached) model.generation += 1;
    assertBusState(model, real);
  }

  toString(): string {
    return 'advanceGeneration';
  }
}

class SendBusUpdate implements Command<BusModel, BusReal> {
  constructor(private readonly value: number) {}

  check(_model: Readonly<BusModel>): boolean {
    return true;
  }

  run(model: BusModel, real: BusReal): void {
    real.target.dispatchEvent(
      new MessageEvent('message', {
        origin: TRUSTED_ORIGIN,
        data: { type: 'payload-live-preview', data: { sequence: this.value } },
      }),
    );
    if (model.attached) {
      model.revision += 1;
      model.delivered.push({
        value: this.value,
        generation: model.generation,
        revision: model.revision,
      });
    }
    assertBusState(model, real);
  }

  toString(): string {
    return `send(${String(this.value)})`;
  }
}

interface SchedulerApplication {
  readonly element: number;
  readonly value: number;
  readonly identity: MessageRevision;
}

interface SchedulerModel {
  active: MessageRevision | null;
  cancelled: boolean;
  readonly pending: Map<number, SchedulerApplication>;
  readonly applied: SchedulerApplication[];
}

interface SchedulerReal {
  readonly scheduler: UpdateScheduler;
  readonly targets: readonly CachedElement[];
  readonly applied: SchedulerApplication[];
}

function compareIdentity(left: MessageRevision, right: MessageRevision): number {
  return left.generation === right.generation
    ? left.revision - right.revision
    : left.generation - right.generation;
}

function sameIdentity(left: MessageRevision, right: MessageRevision | null): boolean {
  return right !== null && left.generation === right.generation && left.revision === right.revision;
}

function createSchedulerReal(): SchedulerReal {
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

function assertSchedulerState(model: SchedulerModel, real: SchedulerReal): void {
  expect(real.scheduler.pendingCount).toBe(model.pending.size);
  expect(real.scheduler.replayCount).toBe(0);
  expect(real.applied).toEqual(model.applied);
}

class AcceptSchedulerRevision implements Command<SchedulerModel, SchedulerReal> {
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

class CancelSchedulerRevision implements Command<SchedulerModel, SchedulerReal> {
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

class ScheduleValue implements Command<SchedulerModel, SchedulerReal> {
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

class ForgetScheduledElement implements Command<SchedulerModel, SchedulerReal> {
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

class FlushScheduler implements Command<SchedulerModel, SchedulerReal> {
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

class DestroyScheduler implements Command<SchedulerModel, SchedulerReal> {
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

interface PluginModel {
  readonly active: string[];
  registrations: number;
  removals: number;
  eventCalls: number;
}

interface OwnedRenderer extends FieldRenderer {
  readonly owner: string;
}

interface PluginReal {
  readonly manager: PluginManager;
  readonly events: EventEmitter;
  readonly rendererOwners: string[];
  cleanupCalls: number;
  destroyCalls: number;
  eventCalls: number;
}

function createPluginReal(): PluginReal {
  const events = new EventEmitter();
  const rendererOwners: string[] = [];
  const real = {
    events,
    rendererOwners,
    cleanupCalls: 0,
    destroyCalls: 0,
    eventCalls: 0,
  } as Omit<PluginReal, 'manager'> & { manager?: PluginManager };
  const manager = new PluginManager({
    events,
    config: Object.freeze({}),
    registerFieldRenderer: (renderer) => {
      const owned = renderer as OwnedRenderer;
      rendererOwners.push(owned.owner);
      return () => {
        const index = rendererOwners.lastIndexOf(owned.owner);
        if (index >= 0) rendererOwners.splice(index, 1);
      };
    },
    log: () => undefined,
  });
  real.manager = manager;
  return real as PluginReal;
}

function assertPluginState(model: PluginModel, real: PluginReal): void {
  expect(real.manager.list()).toEqual(model.active);
  expect(real.manager.size).toBe(model.active.length);
  expect(real.events.listenerCount('documentSave')).toBe(model.active.length);
  expect(real.rendererOwners).toEqual(model.active);
  expect(
    real.manager.applyTransforms('title', 'base', {
      element: document.createElement('span'),
      allFields: {},
    }),
  ).toBe(model.active.reduce((value, name) => `${value}:${name}`, 'base'));
  expect(real.cleanupCalls).toBe(model.removals);
  expect(real.destroyCalls).toBe(model.removals);
  expect(real.eventCalls).toBe(model.eventCalls);
}

class RegisterPlugin implements AsyncCommand<PluginModel, PluginReal> {
  constructor(private readonly name: string) {}

  check(_model: Readonly<PluginModel>): boolean {
    return true;
  }

  async run(model: PluginModel, real: PluginReal): Promise<void> {
    const alreadyActive = model.active.includes(this.name);
    await real.manager.register({
      name: this.name,
      init: (context) => {
        context.events.on('documentSave', () => {
          real.eventCalls += 1;
        });
        context.registerTransform('title', (value) => `${String(value)}:${this.name}`);
        const renderer: OwnedRenderer = {
          name: 'text',
          owner: this.name,
          render: () => undefined,
        };
        context.registerFieldRenderer(renderer);
        context.registerCleanup?.(() => {
          real.cleanupCalls += 1;
        });
      },
      destroy: () => {
        real.destroyCalls += 1;
      },
    });
    if (!alreadyActive) {
      model.active.push(this.name);
      model.registrations += 1;
    }
    assertPluginState(model, real);
  }

  toString(): string {
    return `register(${this.name})`;
  }
}

class UnregisterPlugin implements AsyncCommand<PluginModel, PluginReal> {
  constructor(private readonly name: string) {}

  check(_model: Readonly<PluginModel>): boolean {
    return true;
  }

  async run(model: PluginModel, real: PluginReal): Promise<void> {
    const index = model.active.indexOf(this.name);
    await real.manager.unregister(this.name);
    if (index >= 0) {
      model.active.splice(index, 1);
      model.removals += 1;
    }
    assertPluginState(model, real);
  }

  toString(): string {
    return `unregister(${this.name})`;
  }
}

class DestroyAllPlugins implements AsyncCommand<PluginModel, PluginReal> {
  check(_model: Readonly<PluginModel>): boolean {
    return true;
  }

  async run(model: PluginModel, real: PluginReal): Promise<void> {
    await real.manager.destroyAll();
    model.removals += model.active.length;
    model.active.splice(0);
    assertPluginState(model, real);
  }

  toString(): string {
    return 'destroyAll';
  }
}

class EmitPluginEvent implements AsyncCommand<PluginModel, PluginReal> {
  check(_model: Readonly<PluginModel>): boolean {
    return true;
  }

  async run(model: PluginModel, real: PluginReal): Promise<void> {
    await real.events.emit('documentSave', { timestamp: model.eventCalls });
    model.eventCalls += model.active.length;
    assertPluginState(model, real);
  }

  toString(): string {
    return 'emit(documentSave)';
  }
}

describe('lifecycle state-machine properties', () => {
  it('models MessageBus attachment generations and monotonic revisions', () => {
    const commands: Arbitrary<Command<BusModel, BusReal>>[] = [
      fc.constant(new AttachBus()),
      fc.constant(new DetachBus()),
      fc.constant(new AdvanceBusGeneration()),
      fc.integer().map((value) => new SendBusUpdate(value)),
    ];

    fc.assert(
      fc.property(fc.commands(commands, { maxCommands: 50 }), (generated) => {
        let real: BusReal | undefined;
        try {
          fc.modelRun(() => {
            real = createBusReal();
            return {
              model: { attached: false, generation: 0, revision: 0, delivered: [] },
              real,
            };
          }, generated);
        } finally {
          real?.bus.detach();
        }
      }),
      propertyParameters(0x42555331, 80),
    );
  });

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

  it('models plugin listener, transform, renderer, cleanup, and destroy ownership', async () => {
    const name = fc.constantFrom('alpha', 'beta', 'gamma');
    const commands: Arbitrary<AsyncCommand<PluginModel, PluginReal>>[] = [
      name.map((value) => new RegisterPlugin(value)),
      name.map((value) => new UnregisterPlugin(value)),
      fc.constant(new DestroyAllPlugins()),
      fc.constant(new EmitPluginEvent()),
    ];

    await fc.assert(
      fc.asyncProperty(fc.commands(commands, { maxCommands: 40 }), async (generated) => {
        let real: PluginReal | undefined;
        try {
          await fc.asyncModelRun(() => {
            real = createPluginReal();
            return {
              model: { active: [], registrations: 0, removals: 0, eventCalls: 0 },
              real,
            };
          }, generated);
        } finally {
          await real?.manager.destroyAll();
        }
      }),
      propertyParameters(0x504c4731, 60),
    );
  });
});
