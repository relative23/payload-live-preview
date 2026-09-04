import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import type { LivePreviewPlugin, PluginContext, PluginEvents } from '@plugins/types';
import { deferred, makeManager } from './helpers';

describe('PluginManager — scoped events', () => {
  it('exposes the emitter surface without extending EventEmitter', async () => {
    const { manager, events } = makeManager();
    const consumer = vi.fn();
    const owned = vi.fn();
    let scoped: PluginEvents | undefined;
    events.on('documentSave', consumer);

    await manager.register({
      name: 'event-surface-compatibility',
      init: (ctx) => {
        scoped = ctx.events;
        expect(ctx.events).not.toBeInstanceOf(EventEmitter);
        ctx.events.on('documentSave', owned);
      },
    });
    if (scoped === undefined) throw new Error('plugin event facade was not captured');

    await events.emit('documentSave', { timestamp: 1 });
    expect(consumer).toHaveBeenCalledOnce();
    expect(owned).toHaveBeenCalledOnce();
    expect(scoped.listenerCount('documentSave')).toBe(1);

    await manager.unregister('event-surface-compatibility');
    await events.emit('documentSave', { timestamp: 2 });
    expect(consumer).toHaveBeenCalledTimes(2);
    expect(owned).toHaveBeenCalledOnce();
    expect(scoped.listenerCount('documentSave')).toBe(0);
  });

  it('scopes introspection and bulk removal to the plugin', async () => {
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
        // Registrations stay staged until init completes; emitting still works.
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
});
