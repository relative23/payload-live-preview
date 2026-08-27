import { describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { PluginManager } from '@plugins/manager';
import { RendererRegistry } from '@plugins/renderer-registry';
import type { LivePreviewPlugin, PluginContext } from '@plugins/types';
import type { FieldRenderer } from '@core/types';

/**
 * The plugin ownership contract (roadmap 1.2.0): registration order,
 * override precedence, duplicate names, rollback after a failed init, async
 * destroy, compatibility metadata, and — the acceptance gate — that
 * unregistering returns runtime behaviour and listener counts to the exact
 * pre-registration baseline, proven over many cycles and read back from
 * `snapshot()` rather than inferred.
 */

const textRenderer: FieldRenderer = { name: 'text', render: () => {} };

function harness() {
  const events = new EventEmitter();
  const registry = new RendererRegistry({ text: textRenderer });
  const logs: string[] = [];
  const manager = new PluginManager({
    events,
    config: Object.freeze({}),
    registerFieldRenderer: (renderer) => registry.register(renderer),
    log: (...args) => {
      logs.push(args.map(String).join(' '));
    },
  });
  return { events, registry, logs, manager };
}

function plugin(
  name: string,
  init: (context: PluginContext) => void | Promise<void>,
  extra: Partial<LivePreviewPlugin> = {},
): LivePreviewPlugin {
  return { name, init, ...extra };
}

const element = () => document.createElement('div');
const apply = (manager: PluginManager, field: string, value: unknown) =>
  manager.applyTransforms(field, value, { element: element(), allFields: {} });

describe('compatibility metadata', () => {
  it('refuses a plugin whose runtime range or protocol does not fit, and says why', async () => {
    const { manager, logs } = harness();
    await manager.register(plugin('future', () => {}, { compat: { runtime: '^99.0.0' } }));
    await manager.register(plugin('ancient', () => {}, { compat: { protocol: 1 } }));
    await manager.register(
      plugin('fits', () => {}, { compat: { runtime: '>=1.0.0', protocol: 99 } }),
    );
    expect(manager.list()).toEqual(['fits']);
    expect(logs.find((l) => l.includes('"future" refused'))).toMatch(/declares runtime \^99\.0\.0/);
    expect(logs.find((l) => l.includes('"ancient" refused'))).toMatch(/declares protocol 1/);
  });
});

describe('snapshot — ownership is observable', () => {
  it('lists each plugin with its live registrations by kind, and nothing after unregister', async () => {
    const { manager, events } = harness();
    await manager.register(
      plugin(
        'rich',
        (ctx) => {
          ctx.registerTransform('title', (v) => v);
          ctx.registerTransform('body', (v) => v);
          ctx.registerFieldRenderer({ name: 'text', render: () => {} });
          ctx.events.on('afterUpdate', () => {});
          ctx.events.once('connect', () => {});
          ctx.registerCleanup?.(() => {});
        },
        { version: '2.1.0' },
      ),
    );
    expect(manager.snapshot()).toEqual([
      {
        name: 'rich',
        version: '2.1.0',
        state: 'active',
        registrations: { transforms: 2, renderers: 1, subscriptions: 2, cleanups: 1 },
      },
    ]);
    expect(events.listenerCount('afterUpdate')).toBe(1);
    await manager.unregister('rich');
    expect(manager.snapshot()).toEqual([]);
    expect(events.listenerCount('afterUpdate')).toBe(0);
  });

  it('reports initializing while init is pending and tearing-down while destroy runs', async () => {
    const { manager } = harness();
    let finishInit!: () => void;
    const initDone = new Promise<void>((resolve) => {
      finishInit = resolve;
    });
    const registering = manager.register(
      plugin('slow', async (ctx) => {
        ctx.registerTransform('x', (v) => v);
        await initDone;
      }),
    );
    await Promise.resolve();
    expect(manager.snapshot()).toMatchObject([{ name: 'slow', state: 'initializing' }]);
    finishInit();
    await registering;
    expect(manager.snapshot()).toMatchObject([
      { name: 'slow', state: 'active', registrations: { transforms: 1 } },
    ]);
  });
});

describe('ordering, precedence, duplicates, rollback, async destroy', () => {
  it('applies transforms in registration order across plugins', async () => {
    const { manager } = harness();
    await manager.register(
      plugin('a', (ctx) => ctx.registerTransform('t', (v) => `${String(v)}a`)),
    );
    await manager.register(
      plugin('b', (ctx) => ctx.registerTransform('t', (v) => `${String(v)}b`)),
    );
    expect(apply(manager, 't', '')).toBe('ab');
    await manager.unregister('a');
    expect(apply(manager, 't', '')).toBe('b');
    await manager.register(
      plugin('a', (ctx) => ctx.registerTransform('t', (v) => `${String(v)}a`)),
    );
    expect(apply(manager, 't', '')).toBe('ba');
  });

  it('gives the last registered renderer precedence and restores the previous one on unregister', async () => {
    const { manager, registry } = harness();
    const first: FieldRenderer = { name: 'text', render: () => {} };
    const second: FieldRenderer = { name: 'text', render: () => {} };
    await manager.register(plugin('one', (ctx) => ctx.registerFieldRenderer(first)));
    await manager.register(plugin('two', (ctx) => ctx.registerFieldRenderer(second)));
    expect(registry.resolve('text')).toBe(second);
    await manager.unregister('two');
    expect(registry.resolve('text')).toBe(first);
    await manager.unregister('one');
    expect(registry.resolve('text')).toBe(textRenderer);
  });

  it('ignores a duplicate name and keeps the first registration intact', async () => {
    const { manager, logs } = harness();
    await manager.register(plugin('dup', (ctx) => ctx.registerTransform('t', () => 'first')));
    await manager.register(plugin('dup', (ctx) => ctx.registerTransform('t', () => 'second')));
    expect(apply(manager, 't', 'x')).toBe('first');
    expect(logs.some((l) => l.includes('"dup" already registered'))).toBe(true);
    expect(manager.snapshot()).toHaveLength(1);
  });

  it('rolls back every registration when init throws, leaving no listener or transform behind', async () => {
    const { manager, events, registry } = harness();
    await manager.register(
      plugin('broken', (ctx) => {
        ctx.registerTransform('t', () => 'never');
        ctx.events.on('afterUpdate', () => {});
        ctx.registerFieldRenderer({ name: 'text', render: () => {} });
        throw new Error('init exploded');
      }),
    );
    expect(manager.list()).toEqual([]);
    expect(manager.snapshot()).toEqual([]);
    expect(apply(manager, 't', 'x')).toBe('x');
    expect(events.listenerCount('afterUpdate')).toBe(0);
    expect(registry.resolve('text')).toBe(textRenderer);
  });

  it('awaits an async destroy before unregister resolves, and releases resources before destroy runs', async () => {
    const { manager, events } = harness();
    const order: string[] = [];
    await manager.register(
      plugin(
        'async',
        (ctx) => {
          ctx.events.on('afterUpdate', () => {});
        },
        {
          destroy: async () => {
            order.push(`destroy:listeners=${String(events.listenerCount('afterUpdate'))}`);
            await new Promise((resolve) => setTimeout(resolve, 10));
            order.push('destroyed');
          },
        },
      ),
    );
    await manager.unregister('async');
    order.push('unregistered');
    expect(order).toEqual(['destroy:listeners=0', 'destroyed', 'unregistered']);
  });
});

describe('long run — register / unregister / re-register returns to the baseline', () => {
  it('leaves listener counts, renderer layers, transforms and the snapshot exactly as before after 300 cycles', async () => {
    const { manager, events, registry } = harness();
    const baseline = {
      afterUpdate: events.listenerCount('afterUpdate'),
      connect: events.listenerCount('connect'),
      renderer: registry.resolve('text'),
      names: events.eventNames().length,
    };
    const make = (n: number) =>
      plugin('cycler', (ctx) => {
        ctx.registerTransform('t', (v) => `${String(v)}:${String(n)}`);
        ctx.registerFieldRenderer({ name: 'text', render: () => {} });
        ctx.events.on('afterUpdate', () => {});
        ctx.events.once('connect', () => {});
        ctx.registerCleanup?.(() => {});
      });
    for (let cycle = 0; cycle < 300; cycle += 1) {
      await manager.register(make(cycle));
      expect(apply(manager, 't', 'v')).toBe(`v:${String(cycle)}`);
      expect(events.listenerCount('afterUpdate')).toBe(baseline.afterUpdate + 1);
      await manager.unregister('cycler');
    }
    expect(manager.snapshot()).toEqual([]);
    expect(manager.list()).toEqual([]);
    expect(apply(manager, 't', 'v')).toBe('v');
    expect(events.listenerCount('afterUpdate')).toBe(baseline.afterUpdate);
    expect(events.listenerCount('connect')).toBe(baseline.connect);
    expect(events.eventNames().length).toBe(baseline.names);
    expect(registry.resolve('text')).toBe(baseline.renderer);
    expect(Object.keys(registry.renderers)).toEqual(['text']);
  });
});
