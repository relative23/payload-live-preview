/** Model and commands for the `plugins` state-machine properties. */

import { expect } from 'vitest';
import { type AsyncCommand } from 'fast-check';
import type { FieldRenderer } from '@core/types';
import { EventEmitter } from '@events/emitter';
import { PluginManager } from '@plugins/manager';

export interface PluginModel {
  readonly active: string[];
  registrations: number;
  removals: number;
  eventCalls: number;
}

export interface OwnedRenderer extends FieldRenderer {
  readonly owner: string;
}

export interface PluginReal {
  readonly manager: PluginManager;
  readonly events: EventEmitter;
  readonly rendererOwners: string[];
  cleanupCalls: number;
  destroyCalls: number;
  eventCalls: number;
}

export function createPluginReal(): PluginReal {
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

export function assertPluginState(model: PluginModel, real: PluginReal): void {
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

export class RegisterPlugin implements AsyncCommand<PluginModel, PluginReal> {
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

export class UnregisterPlugin implements AsyncCommand<PluginModel, PluginReal> {
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

export class DestroyAllPlugins implements AsyncCommand<PluginModel, PluginReal> {
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

export class EmitPluginEvent implements AsyncCommand<PluginModel, PluginReal> {
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
