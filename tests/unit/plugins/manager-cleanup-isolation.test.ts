import { describe, expect, it, vi } from 'vitest';
import { PluginManager } from '@plugins/manager';
import { EventEmitter } from '@events/emitter';
import { applyTitle, makeManager } from './helpers';

describe('PluginManager — teardown isolation', () => {
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
    expect(applyTitle(manager)).toBe('original');
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
});
