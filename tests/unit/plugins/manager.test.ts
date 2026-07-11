import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager } from '@plugins/manager';
import { EventEmitter } from '@events/emitter';
import type { FieldRenderer } from '@core/types';
import type { LivePreviewPlugin } from '@plugins/types';

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
    },
    log: (...args) => {
      logs.push(args);
    },
  });
  return { events, rendererSink, logs, manager };
}

describe('PluginManager — register / unregister', () => {
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

  it('passes a context with bound config and event emitter', async () => {
    const { manager, events } = makeManager();
    let receivedConfig: unknown;
    let receivedEvents: unknown;
    await manager.register({
      name: 'ctx',
      init: (ctx) => {
        receivedConfig = ctx.getConfig();
        receivedEvents = ctx.events;
      },
    });
    expect(receivedConfig).toEqual({ key: 'value' });
    expect(receivedEvents).toBe(events);
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

  it('isolates destroy errors during destroyAll', async () => {
    const { manager } = makeManager();
    await manager.register({
      name: 'boom',
      init: () => {},
      destroy: () => {
        throw new Error('x');
      },
    });
    await manager.register({ name: 'ok', init: () => {} });
    await expect(manager.destroyAll()).resolves.toBeUndefined();
    expect(manager.size).toBe(0);
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

  it('passes the value through unchanged when no transforms are registered', () => {
    const result = setup.manager.applyTransforms('untouched', 42, {
      element: document.createElement('p'),
      allFields: {},
    });
    expect(result).toBe(42);
  });
});
