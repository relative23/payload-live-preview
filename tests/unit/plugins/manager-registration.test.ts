import { describe, expect, it, vi } from 'vitest';
import { PluginManager } from '@plugins/manager';
import { EventEmitter } from '@events/emitter';
import type { FieldRenderer } from '@core/types';
import type { LivePreviewPlugin, PluginContext } from '@plugins/types';
import { applyTitle, deferred, makeManager } from './helpers';

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

  it('reports a refused plugin on the error event, not only in the log', async () => {
    const { manager, events, logs } = makeManager();
    const onError = vi.fn();
    events.on('error', onError);

    await manager.register({ name: 'future', init: () => {}, compat: { runtime: '^99.0.0' } });

    expect(manager.size).toBe(0);
    expect(onError).toHaveBeenCalledOnce();
    const reported = onError.mock.calls[0]?.[0] as {
      error: Error;
      context: string;
      code: string;
    };
    expect(reported.code).toBe('LP0103');
    expect(reported.context).toBe('plugin');
    expect(reported.error.message).toMatch(/plugin "future" refused: declares runtime \^99\.0\.0/);
    expect(logs.flat().join(' ')).toContain('"future" refused');
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
});

describe('PluginManager — staged resources and rollback', () => {
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
    expect(applyTitle(manager)).toBe('original');
    expect(rendererSink).toEqual([]);
    expect(manager.list()).toEqual([]);

    releaseInit.resolve();
    await registration;
    await events.emit('documentSave', { timestamp: 2 });
    expect(listener).toHaveBeenCalledOnce();
    expect(applyTitle(manager)).toBe('original-active');
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
    context.registerFieldRenderer({ name: 'text', render: () => undefined });
    await events.emit('documentSave', { timestamp: 1 });
    expect(listener).toHaveBeenCalledOnce();
    expect(applyTitle(manager, 'active')).toBe('active!');
    expect(rendererSink).toHaveLength(1);

    eventDisposer();
    await events.emit('documentSave', { timestamp: 2 });
    expect(listener).toHaveBeenCalledOnce();
    await manager.unregister('late-active-resources');
    expect(applyTitle(manager, 'active')).toBe('active');
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
    expect(applyTitle(manager)).toBe('original');
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
    expect(applyTitle(manager)).toBe('original');
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
        expect(error).toBeInstanceOf(Error);
      }
    }

    await events.emit('documentSave', { timestamp: 1 });
    expect(listener).not.toHaveBeenCalled();
    expect(applyTitle(manager)).toBe('original');
    expect(rendererSink).toEqual([]);
  });
});

describe('PluginManager — renderer registration', () => {
  it('forwards renderer registrations to the host', async () => {
    const { manager, rendererSink } = makeManager();
    const renderer: FieldRenderer = { name: 'text', render: () => {} };
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
