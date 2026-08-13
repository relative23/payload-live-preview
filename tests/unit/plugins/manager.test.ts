import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager } from '@plugins/manager';
import { EventEmitter } from '@events/emitter';
import type { FieldRenderer } from '@core/types';
import type { LivePreviewPlugin, PluginContext } from '@plugins/types';

function makeManager(): {
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settlesWithinMicrotaskDrain(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  // A synchronous destroy hook still crosses the manager's async isolation
  // boundary. Drain a fixed number of microtasks without using wall-clock time;
  // a queue cycle remains unsettled regardless of how many turns are drained.
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  return settled;
}

describe('PluginManager — register / unregister', () => {
  it('keeps pre-1.0.4 structural context mocks assignable', () => {
    const legacyContext: PluginContext = {
      events: new EventEmitter(),
      registerFieldRenderer: () => undefined,
      registerTransform: () => undefined,
      getConfig: () => ({}),
      log: () => undefined,
    };

    expect(legacyContext.registerCleanup).toBeUndefined();
    expect(legacyContext.registerFieldRenderer({ name: 'text', render: () => undefined })).toBe(
      undefined,
    );
  });

  it('runs init and tracks the plugin', async () => {
    const { manager } = makeManager();
    const init = vi.fn();
    await manager.register({ name: 'p1', init });
    expect(init).toHaveBeenCalledOnce();
    expect(manager.size).toBe(1);
    expect(manager.list()).toEqual(['p1']);
  });

  it('refuses duplicate registrations', async () => {
    const { manager } = makeManager();
    const plugin: LivePreviewPlugin = { name: 'dup', init: () => {} };
    await manager.register(plugin);
    await manager.register(plugin);
    expect(manager.size).toBe(1);
  });

  it('isolates errors thrown in init', async () => {
    const { manager } = makeManager();
    await manager.register({
      name: 'bad',
      init: () => {
        throw new Error('boom');
      },
    });
    expect(manager.size).toBe(0);
  });

  it('passes a context with bound config and scoped event access', async () => {
    const { manager, events } = makeManager();
    let receivedConfig: unknown;
    const listener = vi.fn();
    await manager.register({
      name: 'ctx',
      init: (ctx) => {
        receivedConfig = ctx.getConfig();
        ctx.events.on('documentSave', listener);
      },
    });
    expect(receivedConfig).toEqual({ key: 'value' });
    await events.emit('documentSave', { timestamp: 1 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('keeps the scoped event facade EventEmitter-compatible without widening teardown', async () => {
    const { manager, events } = makeManager();
    const consumer = vi.fn();
    const owned = vi.fn();
    let legacyEvents: EventEmitter | undefined;
    events.on('documentSave', consumer);

    await manager.register({
      name: 'event-emitter-compatibility',
      init: (ctx) => {
        // PluginContext.events was publicly typed as EventEmitter before
        // ownership scopes were introduced. Keep nominal assignment and
        // runtime feature detection compatible in the patch release.
        legacyEvents = ctx.events;
        expect(ctx.events).toBeInstanceOf(EventEmitter);
        ctx.events.on('documentSave', owned);
      },
    });
    if (legacyEvents === undefined) throw new Error('plugin event facade was not captured');

    await events.emit('documentSave', { timestamp: 1 });
    expect(consumer).toHaveBeenCalledOnce();
    expect(owned).toHaveBeenCalledOnce();
    expect(legacyEvents.listenerCount('documentSave')).toBe(1);

    await manager.unregister('event-emitter-compatibility');
    await events.emit('documentSave', { timestamp: 2 });
    expect(consumer).toHaveBeenCalledTimes(2);
    expect(owned).toHaveBeenCalledOnce();
    expect(legacyEvents.listenerCount('documentSave')).toBe(0);
  });

  it('preserves the EventEmitter surface while scoping introspection and bulk removal', async () => {
    const { manager, events } = makeManager();
    const consumer = vi.fn();
    const owned = vi.fn();
    let context: PluginContext | undefined;
    events.on('documentSave', consumer);

    await manager.register({
      name: 'event-surface',
      init: async (ctx) => {
        context = ctx;
        ctx.events.on('documentSave', owned);
        expect(ctx.events.listenerCount('documentSave')).toBe(1);
        expect(ctx.events.eventNames()).toEqual(['documentSave']);
        // Context registrations remain staged until init completes. Emitting is
        // still available, but no external caller can observe a partial plugin.
        await ctx.events.emit('documentSave', { timestamp: 1 });
        expect(owned).not.toHaveBeenCalled();
      },
    });

    expect(consumer).toHaveBeenCalledOnce();
    if (context === undefined) throw new Error('plugin context was not captured');
    await events.emit('documentSave', { timestamp: 2 });
    expect(consumer).toHaveBeenCalledTimes(2);
    expect(owned).toHaveBeenCalledOnce();
    context.events.removeAllListeners('documentSave');
    expect(context.events.listenerCount('documentSave')).toBe(0);
    expect(context.events.eventNames()).toEqual([]);
    await events.emit('documentSave', { timestamp: 3 });
    expect(consumer).toHaveBeenCalledTimes(3);
    expect(owned).toHaveBeenCalledOnce();
  });

  it('delegates emitWhile to the owning client channel and preserves eligibility', async () => {
    const { manager, events } = makeManager();
    const consumer = vi.fn();
    let context: PluginContext | undefined;
    events.on('documentSave', consumer);
    await manager.register({
      name: 'guarded-event-surface',
      init: (ctx) => {
        context = ctx;
      },
    });
    if (context === undefined) throw new Error('plugin context was not captured');

    await expect(
      context.events.emitWhile('documentSave', { timestamp: 1 }, () => true),
    ).resolves.toBe(true);
    await expect(
      context.events.emitWhile('documentSave', { timestamp: 2 }, () => false),
    ).resolves.toBe(false);

    expect(consumer).toHaveBeenCalledOnce();
    expect(consumer).toHaveBeenCalledWith({ timestamp: 1 });
  });

  it('makes an in-flight emitWhile ineligible when its plugin scope closes', async () => {
    const { manager, events } = makeManager();
    const started = vi.fn();
    const release = deferred();
    const later = vi.fn();
    let context: PluginContext | undefined;
    events.on('documentSave', async () => {
      started();
      await release.promise;
    });
    events.on('documentSave', later);
    await manager.register({
      name: 'guarded-event-close',
      init: (ctx) => {
        context = ctx;
      },
    });
    if (context === undefined) throw new Error('plugin context was not captured');

    const emitting = context.events.emitWhile('documentSave', { timestamp: 1 }, () => true);
    expect(started).toHaveBeenCalledOnce();
    await manager.unregister('guarded-event-close');
    release.resolve();

    await expect(emitting).resolves.toBe(false);
    expect(later).not.toHaveBeenCalled();
  });

  it('does not start a handler when the caller predicate closes its scope reentrantly', async () => {
    const { manager, events } = makeManager();
    const consumer = vi.fn();
    let predicateCalls = 0;
    let dispatched: boolean | undefined;
    let removal: Promise<void> | undefined;
    events.on('documentSave', consumer);

    await manager.register({
      name: 'guarded-predicate-close',
      init: async (ctx) => {
        dispatched = await ctx.events.emitWhile('documentSave', { timestamp: 1 }, () => {
          predicateCalls += 1;
          if (predicateCalls === 2) removal = manager.unregister('guarded-predicate-close');
          return true;
        });
      },
    });
    await removal;

    expect(predicateCalls).toBe(2);
    expect(dispatched).toBe(false);
    expect(consumer).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
  });

  it('rejects emitWhile from a context whose resource scope is already closed', async () => {
    const { manager } = makeManager();
    let context: PluginContext | undefined;
    await manager.register({
      name: 'closed-guarded-event',
      init: (ctx) => {
        context = ctx;
      },
    });
    if (context === undefined) throw new Error('plugin context was not captured');
    const closedContext = context;
    await manager.unregister('closed-guarded-event');

    expect(() =>
      closedContext.events.emitWhile('documentSave', { timestamp: 1 }, () => true),
    ).toThrow(/no longer active/);
  });

  it('drops a scoped once subscription from introspection after it fires', async () => {
    const { manager, events } = makeManager();
    let context: PluginContext | undefined;
    const countsDuringHandler: number[] = [];
    await manager.register({
      name: 'once-introspection',
      init: (ctx) => {
        context = ctx;
        ctx.events.once('documentSave', () => {
          countsDuringHandler.push(ctx.events.listenerCount('documentSave'));
        });
      },
    });
    if (context === undefined) throw new Error('plugin context was not captured');
    expect(context.events.listenerCount('documentSave')).toBe(1);
    await events.emit('documentSave', { timestamp: 1 });
    expect(countsDuringHandler).toEqual([0]);
    expect(context.events.listenerCount('documentSave')).toBe(0);
  });

  it('lets an exact disposer invalidate a listener already captured by an emit', async () => {
    const { manager, events } = makeManager();
    const gate = deferred();
    const started = deferred();
    const owned = vi.fn();
    let dispose: (() => void) | undefined;
    events.on('documentSave', async () => {
      started.resolve();
      await gate.promise;
    });
    await manager.register({
      name: 'exact-snapshot-disposer',
      init: (ctx) => {
        dispose = ctx.events.on('documentSave', owned);
      },
    });

    const emitting = events.emit('documentSave', { timestamp: 1 });
    await started.promise;
    if (dispose === undefined) throw new Error('event disposer was not captured');
    dispose();
    gate.resolve();
    await emitting;

    expect(owned).not.toHaveBeenCalled();
  });

  it('off removes matching owned on/once handlers but not an identical consumer handler', async () => {
    const { manager, events } = makeManager();
    const sharedHandler = vi.fn();
    events.on('documentSave', sharedHandler);
    await manager.register({
      name: 'scoped-off',
      init: (ctx) => {
        ctx.events.on('documentSave', sharedHandler);
        ctx.events.once('documentSave', sharedHandler);
        ctx.events.off('documentSave', sharedHandler);
        expect(ctx.events.listenerCount('documentSave')).toBe(0);
      },
    });

    await events.emit('documentSave', { timestamp: 1 });
    expect(sharedHandler).toHaveBeenCalledOnce();
  });

  it('does not run an owned listener already captured by an emit after unregister', async () => {
    const { manager, events } = makeManager();
    const gate = deferred();
    const started = deferred();
    const owned = vi.fn();
    events.on('documentSave', async () => {
      started.resolve();
      await gate.promise;
    });
    await manager.register({
      name: 'snapshot-race',
      init: (ctx) => {
        ctx.events.on('documentSave', owned);
      },
    });

    const emitting = events.emit('documentSave', { timestamp: 1 });
    await started.promise;
    await manager.unregister('snapshot-race');
    gate.resolve();
    await emitting;

    expect(owned).not.toHaveBeenCalled();
  });

  it('removes owned on/once listeners without touching consumer or other-plugin listeners', async () => {
    const { manager, events } = makeManager();
    const calls: string[] = [];
    events.on('documentSave', () => {
      calls.push('consumer');
    });
    await manager.register({
      name: 'owned',
      init: (ctx) => {
        ctx.events.on('documentSave', () => {
          calls.push('owned:on');
        });
        ctx.events.once('documentSave', () => {
          calls.push('owned:once');
        });
      },
    });
    await manager.register({
      name: 'other',
      init: (ctx) => {
        ctx.events.on('documentSave', () => {
          calls.push('other:on');
        });
        ctx.events.once('documentSave', () => {
          calls.push('other:once');
        });
      },
    });

    await manager.unregister('owned');
    await events.emit('documentSave', { timestamp: 1 });
    await events.emit('documentSave', { timestamp: 2 });

    expect(calls).toEqual(['consumer', 'other:on', 'other:once', 'consumer', 'other:on']);
  });

  it('owns identical handler references independently across plugins', async () => {
    const { manager, events } = makeManager();
    const sharedHandler = vi.fn();
    const plugin = (name: string): LivePreviewPlugin => ({
      name,
      init: (ctx) => {
        ctx.events.on('documentSave', sharedHandler);
      },
    });
    await manager.register(plugin('a'));
    await manager.register(plugin('b'));

    await manager.unregister('a');
    await events.emit('documentSave', { timestamp: 1 });
    expect(sharedHandler).toHaveBeenCalledOnce();

    await manager.unregister('b');
    await events.emit('documentSave', { timestamp: 2 });
    expect(sharedHandler).toHaveBeenCalledOnce();
  });

  it('deduplicates an identical handler within one scoped emitter bucket', async () => {
    const { manager, events } = makeManager();
    const sharedHandler = vi.fn();
    await manager.register({
      name: 'same-scope-dedupe',
      init: (ctx) => {
        const first = ctx.events.on('documentSave', sharedHandler);
        const second = ctx.events.on('documentSave', sharedHandler);
        expect(second).toBe(first);
        expect(ctx.events.listenerCount('documentSave')).toBe(1);
      },
    });

    await events.emit('documentSave', { timestamp: 1 });
    expect(sharedHandler).toHaveBeenCalledOnce();
  });

  it('does not duplicate listeners when a plugin is unregistered and registered again', async () => {
    const { manager, events } = makeManager();
    const listener = vi.fn();
    const plugin: LivePreviewPlugin = {
      name: 'repeatable',
      init: (ctx) => {
        ctx.events.on('documentSave', () => {
          listener();
        });
      },
    };

    await manager.register(plugin);
    await manager.unregister(plugin.name);
    await manager.register(plugin);
    await events.emit('documentSave', { timestamp: 1 });
    expect(listener).toHaveBeenCalledOnce();

    await manager.unregister(plugin.name);
    await events.emit('documentSave', { timestamp: 2 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('serializes registration, removal, and re-registration mutations', async () => {
    const { manager } = makeManager();
    let releaseInit: (() => void) | undefined;
    const initGate = new Promise<void>((resolve) => {
      releaseInit = resolve;
    });
    const calls: string[] = [];
    const first: LivePreviewPlugin = {
      name: 'serial',
      init: async () => {
        calls.push('first:init:start');
        await initGate;
        calls.push('first:init:end');
      },
      destroy: () => {
        calls.push('first:destroy');
      },
    };
    const second: LivePreviewPlugin = {
      name: 'serial',
      init: () => {
        calls.push('second:init');
      },
    };

    const registerFirst = manager.register(first);
    const removeFirst = manager.unregister(first.name);
    const registerSecond = manager.register(second);
    await Promise.resolve();
    expect(calls).toEqual(['first:init:start']);
    if (releaseInit === undefined) throw new Error('init gate was not created');
    releaseInit();
    await Promise.all([registerFirst, removeFirst, registerSecond]);

    expect(calls).toEqual(['first:init:start', 'first:init:end', 'first:destroy', 'second:init']);
    expect(manager.list()).toEqual(['serial']);
  });

  it('lets init await removal of its own pending registration without deadlocking', async () => {
    const { manager } = makeManager();
    const initStarted = deferred();
    let selfRemoval: Promise<void> | undefined;
    let resumed = false;
    const registration = manager.register({
      name: 'self-removing-init',
      init: async () => {
        initStarted.resolve();
        selfRemoval = manager.unregister('self-removing-init');
        await selfRemoval;
        resumed = true;
      },
    });
    await initStarted.promise;
    if (selfRemoval === undefined) throw new Error('self-removal was not started');

    expect(await settlesWithinMicrotaskDrain(selfRemoval)).toBe(true);
    await registration;
    expect(resumed).toBe(true);
    expect(manager.list()).toEqual([]);
  });

  it('lets init await registration of another plugin without deadlocking', async () => {
    const { manager } = makeManager();
    const initStarted = deferred();
    const calls: string[] = [];
    let nestedRegistration: Promise<void> | undefined;
    const registration = manager.register({
      name: 'registering-init',
      init: async () => {
        calls.push('parent:start');
        nestedRegistration = manager.register({
          name: 'nested-from-init',
          init: () => {
            calls.push('nested:init');
          },
        });
        initStarted.resolve();
        await nestedRegistration;
        calls.push('parent:end');
      },
    });
    await initStarted.promise;
    if (nestedRegistration === undefined) throw new Error('nested registration was not started');

    expect(await settlesWithinMicrotaskDrain(nestedRegistration)).toBe(true);
    await registration;
    expect(calls).toEqual(['parent:start', 'nested:init', 'parent:end']);
    expect(manager.list()).toEqual(['nested-from-init', 'registering-init']);
  });

  it('lets an external removal cancel a pending async init without rejecting', async () => {
    const { manager, events } = makeManager();
    const initStarted = deferred();
    const releaseInit = deferred();
    const listener = vi.fn();
    const registration = manager.register({
      name: 'externally-cancelled-init',
      init: async (ctx) => {
        ctx.events.on('documentSave', listener);
        initStarted.resolve();
        await releaseInit.promise;
      },
    });
    await initStarted.promise;

    const removal = manager.unregister('externally-cancelled-init');
    expect(await settlesWithinMicrotaskDrain(removal)).toBe(true);
    await expect(removal).resolves.toBeUndefined();
    releaseInit.resolve();
    await registration;
    await events.emit('documentSave', { timestamp: 1 });

    expect(listener).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
  });

  it('lets a destroy hook await removal of another plugin without deadlocking', async () => {
    const { manager } = makeManager();
    const destroyStarted = deferred();
    const calls: string[] = [];
    let nestedRemoval: Promise<void> | undefined;
    await manager.register({
      name: 'destroy-a',
      init: () => undefined,
      destroy: async () => {
        calls.push('a:start');
        nestedRemoval = manager.unregister('destroy-b');
        destroyStarted.resolve();
        await nestedRemoval;
        calls.push('a:end');
      },
    });
    await manager.register({
      name: 'destroy-b',
      init: () => undefined,
      destroy: () => {
        calls.push('b');
      },
    });

    const removal = manager.unregister('destroy-a');
    await destroyStarted.promise;
    if (nestedRemoval === undefined) throw new Error('nested removal was not started');
    expect(await settlesWithinMicrotaskDrain(nestedRemoval)).toBe(true);
    await removal;

    expect(calls).toEqual(['a:start', 'b', 'a:end']);
    expect(manager.list()).toEqual([]);
  });

  it('lets a destroy hook await registration of another plugin without deadlocking', async () => {
    const { manager } = makeManager();
    const destroyStarted = deferred();
    const calls: string[] = [];
    let nestedRegistration: Promise<void> | undefined;
    await manager.register({
      name: 'registering-destroy',
      init: () => undefined,
      destroy: async () => {
        calls.push('destroy:start');
        nestedRegistration = manager.register({
          name: 'nested-from-destroy',
          init: () => {
            calls.push('nested:init');
          },
        });
        destroyStarted.resolve();
        await nestedRegistration;
        calls.push('destroy:end');
      },
    });

    const removal = manager.unregister('registering-destroy');
    await destroyStarted.promise;
    if (nestedRegistration === undefined) throw new Error('nested registration was not started');
    expect(await settlesWithinMicrotaskDrain(nestedRegistration)).toBe(true);
    await removal;

    expect(calls).toEqual(['destroy:start', 'nested:init', 'destroy:end']);
    expect(manager.list()).toEqual(['nested-from-destroy']);
  });

  it('lets a destroy hook await redundant removal of itself without deadlocking', async () => {
    const { manager } = makeManager();
    const selfRemovalStarted = deferred();
    let nestedRemoval: Promise<void> | undefined;
    await manager.register({
      name: 'self-removing-destroy',
      init: () => undefined,
      destroy: async () => {
        await Promise.resolve();
        nestedRemoval = manager.unregister('self-removing-destroy');
        selfRemovalStarted.resolve();
        await nestedRemoval;
      },
    });

    const removal = manager.unregister('self-removing-destroy');
    await selfRemovalStarted.promise;
    if (nestedRemoval === undefined) throw new Error('nested self-removal was not started');

    expect(await settlesWithinMicrotaskDrain(nestedRemoval)).toBe(true);
    await expect(removal).resolves.toBeUndefined();
    expect(manager.list()).toEqual([]);
  });

  it('deduplicates removal promises before the target destroy hook starts', async () => {
    const { manager } = makeManager();
    const releaseInit = deferred();
    const initStarted = deferred();
    const releaseDestroy = deferred();
    await manager.register({
      name: 'duplicate-removal-target',
      init: () => undefined,
      destroy: async () => releaseDestroy.promise,
    });
    const blocker = manager.register({
      name: 'pending-unrelated-init',
      init: async () => {
        initStarted.resolve();
        await releaseInit.promise;
      },
    });
    await initStarted.promise;

    const first = manager.unregister('duplicate-removal-target');
    const second = manager.unregister('duplicate-removal-target');

    expect(second).toBe(first);
    expect(await settlesWithinMicrotaskDrain(first)).toBe(false);
    releaseDestroy.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    releaseInit.resolve();
    await blocker;
    await manager.unregister('pending-unrelated-init');
  });

  it('keeps a plugin name occupied until its pending teardown completes', async () => {
    const { manager } = makeManager();
    const releaseDestroy = deferred();
    const destroyStarted = deferred();
    const replacementInit = vi.fn();
    let replacementRegistration: Promise<void> | undefined;

    await manager.register({
      name: 'same-name-during-destroy',
      init: () => undefined,
      destroy: async () => {
        replacementRegistration = manager.register({
          name: 'same-name-during-destroy',
          init: replacementInit,
        });
        destroyStarted.resolve();
        await releaseDestroy.promise;
      },
    });

    const removal = manager.unregister('same-name-during-destroy');
    await destroyStarted.promise;
    if (replacementRegistration === undefined) {
      throw new Error('same-name replacement registration was not started');
    }
    expect(await settlesWithinMicrotaskDrain(replacementRegistration)).toBe(true);

    releaseDestroy.resolve();
    await Promise.all([removal, replacementRegistration]);

    expect(replacementInit).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
  });

  it('continues destroyAll after nested removal and a throwing destroy hook', async () => {
    const { manager } = makeManager();
    const destroyStarted = deferred();
    const calls: string[] = [];
    let nestedRemoval: Promise<void> | undefined;
    await manager.register({
      name: 'bulk-a',
      init: () => undefined,
      destroy: async () => {
        calls.push('a:start');
        nestedRemoval = manager.unregister('bulk-b');
        destroyStarted.resolve();
        await nestedRemoval;
        calls.push('a:end');
      },
    });
    await manager.register({
      name: 'bulk-b',
      init: () => undefined,
      destroy: () => {
        calls.push('b');
        throw new Error('nested destroy failed');
      },
    });
    await manager.register({
      name: 'bulk-c',
      init: () => undefined,
      destroy: () => {
        calls.push('c');
      },
    });

    const destruction = manager.destroyAll();
    await destroyStarted.promise;
    if (nestedRemoval === undefined) throw new Error('nested removal was not started');
    expect(await settlesWithinMicrotaskDrain(nestedRemoval)).toBe(true);
    await destruction;

    expect(calls).toEqual(['a:start', 'b', 'a:end', 'c']);
    expect(manager.list()).toEqual([]);
  });

  it('lets init await destroyAll and prevents its staged scope from committing', async () => {
    const { manager, events } = makeManager();
    const existingDestroy = vi.fn();
    const stagedListener = vi.fn();
    let nestedDestruction: Promise<void> | undefined;
    await manager.register({
      name: 'existing-before-bulk-init',
      init: () => undefined,
      destroy: existingDestroy,
    });

    const registration = manager.register({
      name: 'bulk-during-init',
      init: async (ctx) => {
        ctx.events.on('documentSave', stagedListener);
        nestedDestruction = manager.destroyAll();
        await nestedDestruction;
      },
    });
    await registration;
    if (nestedDestruction === undefined) throw new Error('nested destroyAll was not started');
    await nestedDestruction;
    await events.emit('documentSave', { timestamp: 1 });

    expect(existingDestroy).toHaveBeenCalledOnce();
    expect(stagedListener).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
  });

  it('publishes context resources atomically only after async init succeeds', async () => {
    const { manager, events, rendererSink } = makeManager();
    const initStarted = deferred();
    const releaseInit = deferred();
    const listener = vi.fn();
    const registration = manager.register({
      name: 'atomic-init',
      init: async (ctx) => {
        ctx.events.on('documentSave', listener);
        ctx.registerTransform('title', (value) => `${String(value)}-active`);
        ctx.registerFieldRenderer({ name: 'text', render: () => undefined });
        initStarted.resolve();
        await releaseInit.promise;
      },
    });
    await initStarted.promise;

    await events.emit('documentSave', { timestamp: 1 });
    expect(listener).not.toHaveBeenCalled();
    expect(
      manager.applyTransforms('title', 'original', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('original');
    expect(rendererSink).toEqual([]);
    expect(manager.list()).toEqual([]);

    releaseInit.resolve();
    await registration;
    await events.emit('documentSave', { timestamp: 2 });
    expect(listener).toHaveBeenCalledOnce();
    expect(
      manager.applyTransforms('title', 'original', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('original-active');
    expect(rendererSink).toHaveLength(1);
  });

  it('acquires retained-context resources and releases them with their scope', async () => {
    const { manager, events, rendererSink } = makeManager();
    const listener = vi.fn();
    let context: PluginContext | undefined;
    await manager.register({
      name: 'late-active-resources',
      init: (ctx) => {
        context = ctx;
      },
    });
    if (context === undefined) throw new Error('active context was not captured');

    const eventDisposer = context.events.on('documentSave', listener);
    context.registerTransform('title', (value) => `${String(value)}!`);
    context.registerFieldRenderer({
      name: 'text',
      render: () => undefined,
    });
    await events.emit('documentSave', { timestamp: 1 });
    expect(listener).toHaveBeenCalledOnce();
    expect(
      manager.applyTransforms('title', 'active', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('active!');
    expect(rendererSink).toHaveLength(1);

    eventDisposer();
    await events.emit('documentSave', { timestamp: 2 });
    expect(listener).toHaveBeenCalledOnce();
    await manager.unregister('late-active-resources');
    expect(
      manager.applyTransforms('title', 'active', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('active');
    expect(rendererSink).toEqual([]);
  });

  it('removes a failed late acquisition from an otherwise active scope', async () => {
    const logs: unknown[][] = [];
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: () => {
        throw new Error('late host failure');
      },
      log: (...args) => {
        logs.push(args);
      },
    });
    let context: PluginContext | undefined;
    await manager.register({
      name: 'late-acquisition-failure',
      init: (ctx) => {
        context = ctx;
      },
    });
    if (context === undefined) throw new Error('active context was not captured');
    const activeContext = context;

    expect(() =>
      activeContext.registerFieldRenderer({ name: 'text', render: () => undefined }),
    ).toThrow('late host failure');
    await expect(manager.unregister('late-acquisition-failure')).resolves.toBeUndefined();
    expect(logs.some((entry) => entry.join(' ').includes('cleanup failed'))).toBe(false);
  });

  it('rolls back every resource when async init fails after partial registration', async () => {
    const { manager, events, rendererSink } = makeManager();
    const listener = vi.fn();
    await manager.register({
      name: 'partial',
      init: async (ctx) => {
        ctx.events.on('documentSave', listener);
        ctx.registerTransform('title', (value) => `${String(value)}-partial`);
        ctx.registerFieldRenderer({ name: 'text', render: () => {} });
        await Promise.resolve();
        throw new Error('init failed');
      },
    });

    await events.emit('documentSave', { timestamp: 1 });
    expect(listener).not.toHaveBeenCalled();
    expect(
      manager.applyTransforms('title', 'original', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('original');
    expect(rendererSink).toEqual([]);
    expect(manager.size).toBe(0);
  });

  it('rolls back earlier resources when publishing a staged resource fails', async () => {
    const events = new EventEmitter();
    const rendererAttempts: FieldRenderer[] = [];
    const listener = vi.fn();
    const manager = new PluginManager({
      events,
      config: {},
      registerFieldRenderer: (renderer) => {
        rendererAttempts.push(renderer);
        throw new Error('renderer host rejected registration');
      },
      log: () => undefined,
    });

    await manager.register({
      name: 'commit-failure',
      init: (ctx) => {
        ctx.events.on('documentSave', listener);
        ctx.registerTransform('title', (value) => `${String(value)}-partial`);
        ctx.registerFieldRenderer({ name: 'text', render: () => undefined });
      },
    });

    await events.emit('documentSave', { timestamp: 1 });
    expect(listener).not.toHaveBeenCalled();
    expect(
      manager.applyTransforms('title', 'original', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('original');
    expect(rendererAttempts).toHaveLength(1);
    expect(manager.size).toBe(0);
  });

  it('prevents a retained context from registering resources after unregister', async () => {
    const { manager, events, rendererSink } = makeManager();
    let retainedContext: PluginContext | undefined;
    await manager.register({
      name: 'retained',
      init: (ctx) => {
        retainedContext = ctx;
      },
    });
    await manager.unregister('retained');
    if (retainedContext === undefined) throw new Error('plugin context was not captured');
    const closedContext = retainedContext;

    const listener = vi.fn();
    const registrations: readonly (() => void)[] = [
      () => {
        closedContext.events.on('documentSave', listener);
      },
      () => {
        closedContext.events.once('documentSave', listener);
      },
      () => {
        closedContext.registerTransform('title', () => 'late');
      },
      () => {
        closedContext.registerFieldRenderer({ name: 'text', render: () => {} });
      },
    ];
    for (const register of registrations) {
      try {
        register();
      } catch (error) {
        // A closed scope may reject explicitly or return an inert registration.
        expect(error).toBeInstanceOf(Error);
      }
    }

    await events.emit('documentSave', { timestamp: 1 });
    expect(listener).not.toHaveBeenCalled();
    expect(
      manager.applyTransforms('title', 'original', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('original');
    expect(rendererSink).toEqual([]);
  });

  it('runs destroy on unregister', async () => {
    const { manager } = makeManager();
    const destroy = vi.fn();
    await manager.register({ name: 'p', init: () => {}, destroy });
    await manager.unregister('p');
    expect(destroy).toHaveBeenCalledOnce();
    expect(manager.size).toBe(0);
  });

  it('unregister is a no-op for unknown plugins', async () => {
    const { manager } = makeManager();
    await expect(manager.unregister('mystery')).resolves.toBeUndefined();
  });

  it('destroyAll tears down every plugin', async () => {
    const { manager } = makeManager();
    const a = vi.fn();
    const b = vi.fn();
    await manager.register({ name: 'a', init: () => {}, destroy: a });
    await manager.register({ name: 'b', init: () => {}, destroy: b });
    await manager.destroyAll();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(manager.size).toBe(0);
  });

  it('revokes resources before a throwing destroy and continues destroyAll', async () => {
    const { manager, events, rendererSink } = makeManager();
    const badListener = vi.fn();
    const goodListener = vi.fn();
    const badDestroy = vi.fn(() => {
      throw new Error('x');
    });
    const goodDestroy = vi.fn();
    await manager.register({
      name: 'boom',
      init: (ctx) => {
        ctx.events.on('documentSave', badListener);
        ctx.registerTransform('title', (value) => `${String(value)}-bad`);
        ctx.registerFieldRenderer({ name: 'text', render: () => {} });
      },
      destroy: badDestroy,
    });
    await manager.register({
      name: 'ok',
      init: (ctx) => {
        ctx.events.on('documentSave', goodListener);
        ctx.registerTransform('title', (value) => `${String(value)}-good`);
        ctx.registerFieldRenderer({ name: 'text', render: () => {} });
      },
      destroy: goodDestroy,
    });

    await expect(manager.destroyAll()).resolves.toBeUndefined();
    await events.emit('documentSave', { timestamp: 1 });

    expect(badDestroy).toHaveBeenCalledOnce();
    expect(goodDestroy).toHaveBeenCalledOnce();
    expect(badListener).not.toHaveBeenCalled();
    expect(goodListener).not.toHaveBeenCalled();
    expect(
      manager.applyTransforms('title', 'original', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('original');
    expect(rendererSink).toEqual([]);
    expect(manager.size).toBe(0);
  });

  it('isolates a throwing cleanup and still runs every other cleanup', async () => {
    const { manager } = makeManager();
    const calls: string[] = [];
    await manager.register({
      name: 'cleanup-errors',
      init: (ctx) => {
        ctx.registerCleanup?.(() => {
          calls.push('first');
        });
        ctx.registerCleanup?.(() => {
          calls.push('throwing');
          throw new Error('cleanup failed');
        });
        ctx.registerCleanup?.(() => {
          calls.push('last');
        });
      },
    });

    await expect(manager.unregister('cleanup-errors')).resolves.toBeUndefined();
    expect(calls).toEqual(['last', 'throwing', 'first']);
  });

  it('finishes cleanup and destroy when the diagnostic logger itself throws', async () => {
    const calls: string[] = [];
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: () => undefined,
      log: (...args) => {
        if (String(args[0]).includes('failed')) throw new Error('logger failed');
      },
    });
    await manager.register({
      name: 'throwing-cleanup-logger',
      init: (ctx) => {
        ctx.registerCleanup?.(() => {
          calls.push('first');
        });
        ctx.registerCleanup?.(() => {
          calls.push('throwing');
          throw new Error('cleanup failed');
        });
        ctx.registerCleanup?.(() => {
          calls.push('last');
        });
      },
      destroy: () => {
        calls.push('destroy');
        throw new Error('destroy failed');
      },
    });

    await expect(manager.unregister('throwing-cleanup-logger')).resolves.toBeUndefined();
    expect(calls).toEqual(['last', 'throwing', 'first', 'destroy']);
    expect(manager.list()).toEqual([]);
  });

  it('keeps the mutation queue usable when every diagnostic log throws', async () => {
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: () => undefined,
      log: () => {
        throw new Error('logger failed');
      },
    });

    await expect(
      manager.register({ name: 'first-with-throwing-logger', init: () => undefined }),
    ).resolves.toBeUndefined();
    await expect(manager.unregister('first-with-throwing-logger')).resolves.toBeUndefined();
    await expect(
      manager.register({ name: 'second-with-throwing-logger', init: () => undefined }),
    ).resolves.toBeUndefined();
    await expect(manager.unregister('second-with-throwing-logger')).resolves.toBeUndefined();

    expect(manager.list()).toEqual([]);
  });

  it('observes a rejected Promise returned by an async diagnostic logger', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const invalidAsyncLogger = (): void => {
        return Promise.reject(new Error('async logger failed')) as never;
      };
      const manager = new PluginManager({
        events: new EventEmitter(),
        config: {},
        registerFieldRenderer: () => undefined,
        log: invalidAsyncLogger,
      });

      await manager.register({ name: 'async-rejecting-logger', init: () => undefined });
      await manager.unregister('async-rejecting-logger');
      await Promise.resolve();
      await Promise.resolve();

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('observes a rejected cleanup thenable without awaiting or interrupting teardown', async () => {
    const calls: string[] = [];
    const logs: unknown[][] = [];
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async cleanup failed'));
      },
    );
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: () => undefined,
      log: (...args) => {
        logs.push(args);
      },
    });
    await manager.register({
      name: 'async-cleanup',
      init: (ctx) => {
        ctx.registerCleanup?.(() => {
          calls.push('first');
        });
        const invalidAsyncCleanup = (): void => {
          calls.push('thenable');
          return { then } as never;
        };
        ctx.registerCleanup?.(invalidAsyncCleanup);
        ctx.registerCleanup?.(() => {
          calls.push('last');
        });
      },
    });

    await expect(manager.unregister('async-cleanup')).resolves.toBeUndefined();
    expect(calls).toEqual(['last', 'thenable', 'first']);
    await Promise.resolve();
    await Promise.resolve();

    expect(then).toHaveBeenCalledOnce();
    expect(logs.some((entry) => entry.join(' ').includes('must be synchronous'))).toBe(true);
  });

  it('ignores a non-function result from a legacy void renderer host callback', async () => {
    const logs: unknown[][] = [];
    const renderers: FieldRenderer[] = [];
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: (renderer) => renderers.push(renderer),
      log: (...args) => {
        logs.push(args);
      },
    });
    await manager.register({
      name: 'void-renderer-host',
      init: (ctx) => {
        ctx.registerFieldRenderer({ name: 'text', render: () => undefined });
      },
    });

    await manager.unregister('void-renderer-host');
    expect(renderers).toHaveLength(1);
    expect(logs.some((args) => args.join(' ').includes('cleanup failed'))).toBe(false);
  });
});

describe('PluginManager — renderer registration', () => {
  it('forwards renderer registrations to the host', async () => {
    const { manager, rendererSink } = makeManager();
    const renderer: FieldRenderer = {
      name: 'text',
      render: () => {},
    };
    await manager.register({
      name: 'r',
      init: (ctx) => {
        ctx.registerFieldRenderer(renderer);
      },
    });
    expect(rendererSink).toEqual([renderer]);
  });

  it('removes only renderer registrations owned by the unregistered plugin', async () => {
    const { manager, rendererSink } = makeManager();
    const rendererA: FieldRenderer = { name: 'text', render: () => {} };
    const rendererB: FieldRenderer = { name: 'text', render: () => {} };
    await manager.register({
      name: 'a',
      init: (ctx) => {
        ctx.registerFieldRenderer(rendererA);
      },
    });
    await manager.register({
      name: 'b',
      init: (ctx) => {
        ctx.registerFieldRenderer(rendererB);
      },
    });

    await manager.unregister('a');
    expect(rendererSink).toEqual([rendererB]);
    await manager.unregister('b');
    expect(rendererSink).toEqual([]);
  });
});

describe('PluginManager — transforms', () => {
  let setup: ReturnType<typeof makeManager>;
  beforeEach(() => {
    setup = makeManager();
  });

  it('applies a single transform', async () => {
    await setup.manager.register({
      name: 't',
      init: (ctx) => {
        ctx.registerTransform('title', (v) => `*${String(v)}*`);
      },
    });
    const result = setup.manager.applyTransforms('title', 'hi', {
      element: document.createElement('p'),
      allFields: {},
    });
    expect(result).toBe('*hi*');
  });

  it('chains transforms in registration order', async () => {
    await setup.manager.register({
      name: 't',
      init: (ctx) => {
        ctx.registerTransform('field', (v) => `${String(v)}A`);
        ctx.registerTransform('field', (v) => `${String(v)}B`);
      },
    });
    const result = setup.manager.applyTransforms('field', '', {
      element: document.createElement('p'),
      allFields: {},
    });
    expect(result).toBe('AB');
  });

  it('removes only owned transforms and preserves active registration order', async () => {
    const element = document.createElement('p');
    const apply = (): unknown =>
      setup.manager.applyTransforms('field', '', { element, allFields: {} });
    const plugin = (name: string, suffix: string): LivePreviewPlugin => ({
      name,
      init: (ctx) => {
        ctx.registerTransform('field', (value) => `${String(value)}${suffix}`);
      },
    });
    const a = plugin('a', 'A');
    const b = plugin('b', 'B');

    await setup.manager.register(a);
    await setup.manager.register(b);
    expect(apply()).toBe('AB');

    await setup.manager.unregister('a');
    expect(apply()).toBe('B');

    await setup.manager.register(a);
    expect(apply()).toBe('BA');

    await setup.manager.unregister('b');
    expect(apply()).toBe('A');
    await setup.manager.unregister('a');
    expect(apply()).toBe('');
  });

  it('keeps registration results void while the internal scope owns exact cleanup', async () => {
    const cleanup = vi.fn();
    const results: unknown[] = [];
    await setup.manager.register({
      name: 'void-registration-results',
      init: (ctx) => {
        results.push(ctx.registerTransform('field', (value) => `${String(value)}!`));
        results.push(
          ctx.registerFieldRenderer({ name: 'text', render: () => undefined }),
          ctx.registerCleanup?.(cleanup),
        );
      },
    });
    expect(results).toEqual([undefined, undefined, undefined]);
    expect(setup.rendererSink).toHaveLength(1);
    expect(
      setup.manager.applyTransforms('field', 'value', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('value!');

    await setup.manager.unregister('void-registration-results');
    expect(
      setup.manager.applyTransforms('field', 'value', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('value');
    expect(setup.rendererSink).toEqual([]);
    expect(cleanup).toHaveBeenCalledOnce();
    await setup.manager.unregister('void-registration-results');
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('isolates a throwing transform — returns input value', async () => {
    await setup.manager.register({
      name: 't',
      init: (ctx) => {
        ctx.registerTransform('field', () => {
          throw new Error('boom');
        });
      },
    });
    const result = setup.manager.applyTransforms('field', 'original', {
      element: document.createElement('p'),
      allFields: {},
    });
    expect(result).toBe('original');
  });

  it('stops a throwing transform chain and falls back to the original input', async () => {
    const afterThrow = vi.fn((value: unknown) => `${String(value)}C`);
    await setup.manager.register({
      name: 'fallback',
      init: (ctx) => {
        ctx.registerTransform('field', (value) => `${String(value)}A`);
        ctx.registerTransform('field', () => {
          throw new Error('boom');
        });
        ctx.registerTransform('field', afterThrow);
      },
    });

    const result = setup.manager.applyTransforms('field', 'original', {
      element: document.createElement('p'),
      allFields: { field: 'original' },
    });
    expect(result).toBe('original');
    expect(afterThrow).not.toHaveBeenCalled();
  });

  it('rejects a thenable transform result synchronously and reports the failure', async () => {
    const errors: Error[] = [];
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: () => undefined,
      log: () => undefined,
      onTransformError: (error) => {
        errors.push(error);
      },
    });
    await manager.register({
      name: 'async-transform',
      init: (ctx) => {
        ctx.registerTransform('field', () => Promise.resolve('too late'));
      },
    });

    const result = manager.applyTransforms('field', 'original', {
      element: document.createElement('p'),
      allFields: { field: 'original' },
    });
    expect(result).toBe('original');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('synchronous');
  });

  it('isolates a throwing transform error reporter', async () => {
    const logs: unknown[][] = [];
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: () => undefined,
      log: (...args) => {
        logs.push(args);
      },
      onTransformError: () => {
        throw new Error('reporter failed');
      },
    });
    await manager.register({
      name: 'throwing-transform-reporter',
      init: (ctx) => {
        ctx.registerTransform('field', () => {
          throw new Error('transform failed');
        });
      },
    });

    expect(
      manager.applyTransforms('field', 'original', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('original');
    expect(logs.some((entry) => entry.join(' ').includes('reporter'))).toBe(true);
  });

  it('observes a rejected thenable returned by the transform error reporter', async () => {
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async reporter failed'));
      },
    );
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: () => undefined,
      log: () => undefined,
      onTransformError: () => ({ then }),
    });
    await manager.register({
      name: 'async-transform-reporter',
      init: (ctx) => {
        ctx.registerTransform('field', () => {
          throw new Error('transform failed');
        });
      },
    });

    expect(
      manager.applyTransforms('field', 'original', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('original');
    await Promise.resolve();
    await Promise.resolve();

    expect(then).toHaveBeenCalledOnce();
  });

  it('contains a hostile then getter returned by the transform error reporter', async () => {
    const thenGetter = vi.fn(() => {
      throw new Error('reporter then getter failed');
    });
    const hostileReporterResult = Object.defineProperty({}, 'then', { get: thenGetter });
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: () => undefined,
      log: () => undefined,
      onTransformError: () => hostileReporterResult,
    });
    await manager.register({
      name: 'hostile-transform-reporter',
      init: (ctx) => {
        ctx.registerTransform('field', () => {
          throw new Error('transform failed');
        });
      },
    });

    expect(() =>
      manager.applyTransforms('field', 'original', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).not.toThrow();
    expect(thenGetter).toHaveBeenCalledOnce();
  });

  it('does not invoke transforms when a revision is already obsolete', async () => {
    const transform = vi.fn(() => 'changed');
    await setup.manager.register({
      name: 'already-obsolete',
      init: (ctx) => {
        ctx.registerTransform('field', transform);
      },
    });

    expect(
      setup.manager.applyTransforms(
        'field',
        'original',
        { element: document.createElement('p'), allFields: {} },
        () => false,
      ),
    ).toBe('original');
    expect(transform).not.toHaveBeenCalled();
  });

  it('suppresses errors thrown while a transform makes its revision obsolete', async () => {
    const errors: Error[] = [];
    let current = true;
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: () => undefined,
      log: () => undefined,
      onTransformError: (error) => {
        errors.push(error);
      },
    });
    await manager.register({
      name: 'obsolete-throwing-transform',
      init: (ctx) => {
        ctx.registerTransform('field', () => {
          current = false;
          throw new Error('obsolete failure');
        });
      },
    });

    expect(
      manager.applyTransforms(
        'field',
        'original',
        { element: document.createElement('p'), allFields: {} },
        () => current,
      ),
    ).toBe('original');
    expect(errors).toEqual([]);
  });

  it('observes a rejected Promise returned in violation of the transform contract', async () => {
    const errors: Error[] = [];
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: () => undefined,
      log: () => undefined,
      onTransformError: (error) => {
        errors.push(error);
      },
    });
    await manager.register({
      name: 'rejecting-transform',
      init: (ctx) => {
        ctx.registerTransform('field', () => Promise.reject(new Error('late rejection')));
      },
    });

    expect(
      manager.applyTransforms('field', 'original', {
        element: document.createElement('p'),
        allFields: {},
      }),
    ).toBe('original');
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toHaveLength(1);
  });

  it('observes but does not report a rejected transform Promise after supersession', async () => {
    const errors: Error[] = [];
    let current = true;
    const manager = new PluginManager({
      events: new EventEmitter(),
      config: {},
      registerFieldRenderer: () => undefined,
      log: () => undefined,
      onTransformError: (error) => {
        errors.push(error);
      },
    });
    await manager.register({
      name: 'obsolete-rejecting-transform',
      init: (ctx) => {
        ctx.registerTransform('field', () => {
          current = false;
          return Promise.reject(new Error('obsolete rejection'));
        });
      },
    });

    expect(
      manager.applyTransforms(
        'field',
        'original',
        { element: document.createElement('p'), allFields: {} },
        () => current,
      ),
    ).toBe('original');
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual([]);
  });

  it('passes the value through unchanged when no transforms are registered', () => {
    const result = setup.manager.applyTransforms('untouched', 42, {
      element: document.createElement('p'),
      allFields: {},
    });
    expect(result).toBe(42);
  });
});
