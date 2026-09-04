import { PluginManager } from '@plugins/manager';
import { EventEmitter } from '@events/emitter';
import type { FieldRenderer } from '@core/types';

export function makeManager(): {
  events: EventEmitter;
  rendererSink: FieldRenderer[];
  logs: unknown[][];
  manager: PluginManager;
} {
  const events = new EventEmitter();
  const rendererSink: FieldRenderer[] = [];
  const logs: unknown[][] = [];
  const manager = new PluginManager({
    events,
    config: Object.freeze({ key: 'value' }),
    registerFieldRenderer: (r) => {
      rendererSink.push(r);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const index = rendererSink.lastIndexOf(r);
        if (index >= 0) rendererSink.splice(index, 1);
      };
    },
    log: (...args) => {
      logs.push(args);
    },
  });
  return { events, rendererSink, logs, manager };
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Drain a fixed number of microtasks; a queue cycle stays unsettled however many turns pass. */
export async function settlesWithinMicrotaskDrain(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  return settled;
}

export function applyTitle(manager: PluginManager, value: unknown = 'original'): unknown {
  return manager.applyTransforms('title', value, {
    element: document.createElement('p'),
    allFields: {},
  });
}
