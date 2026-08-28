/** Model and commands for the `message-bus` state-machine properties. */

import { expect } from 'vitest';
import { type Command } from 'fast-check';
import { MessageBus } from '@core/message-bus';

export const TRUSTED_ORIGIN = 'https://admin.example.test';

export interface BusDelivery {
  readonly value: number;
  readonly generation: number;
  readonly revision: number;
}

export interface BusModel {
  attached: boolean;
  generation: number;
  revision: number;
  readonly delivered: BusDelivery[];
}

export interface BusReal {
  readonly bus: MessageBus;
  readonly target: Window & { dispatchEvent: (event: Event) => boolean };
  readonly delivered: BusDelivery[];
}

export function createBusReal(): BusReal {
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

export function assertBusState(model: BusModel, real: BusReal): void {
  expect(real.delivered).toEqual(model.delivered);
}

export class AttachBus implements Command<BusModel, BusReal> {
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

export class DetachBus implements Command<BusModel, BusReal> {
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

export class AdvanceBusGeneration implements Command<BusModel, BusReal> {
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

export class SendBusUpdate implements Command<BusModel, BusReal> {
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
