import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager } from '@plugins/manager';
import { EventEmitter } from '@events/emitter';
import type { LivePreviewPlugin } from '@plugins/types';
import { makeManager } from './helpers';

function applyField(manager: PluginManager, value: unknown, isCurrent?: () => boolean): unknown {
  return manager.applyTransforms(
    'field',
    value,
    { element: document.createElement('p'), allFields: {} },
    isCurrent,
  );
}

function managerReporting(onTransformError: (error: Error) => unknown): PluginManager {
  return new PluginManager({
    events: new EventEmitter(),
    config: {},
    registerFieldRenderer: () => undefined,
    log: () => undefined,
    onTransformError,
  });
}

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
    expect(applyField(setup.manager, '')).toBe('AB');
  });

  it('removes only owned transforms and preserves active registration order', async () => {
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
    expect(applyField(setup.manager, '')).toBe('AB');

    await setup.manager.unregister('a');
    expect(applyField(setup.manager, '')).toBe('B');

    await setup.manager.register(a);
    expect(applyField(setup.manager, '')).toBe('BA');

    await setup.manager.unregister('b');
    expect(applyField(setup.manager, '')).toBe('A');
    await setup.manager.unregister('a');
    expect(applyField(setup.manager, '')).toBe('');
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
    expect(applyField(setup.manager, 'value')).toBe('value!');

    await setup.manager.unregister('void-registration-results');
    expect(applyField(setup.manager, 'value')).toBe('value');
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
    expect(applyField(setup.manager, 'original')).toBe('original');
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

    expect(applyField(setup.manager, 'original')).toBe('original');
    expect(afterThrow).not.toHaveBeenCalled();
  });

  it('rejects a thenable transform result synchronously and reports the failure', async () => {
    const errors: Error[] = [];
    const manager = managerReporting((error) => {
      errors.push(error);
    });
    await manager.register({
      name: 'async-transform',
      init: (ctx) => {
        ctx.registerTransform('field', () => Promise.resolve('too late'));
      },
    });

    expect(applyField(manager, 'original')).toBe('original');
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

    expect(applyField(manager, 'original')).toBe('original');
    expect(logs.some((entry) => entry.join(' ').includes('reporter'))).toBe(true);
  });

  it('observes a rejected thenable returned by the transform error reporter', async () => {
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async reporter failed'));
      },
    );
    const manager = managerReporting(() => ({ then }));
    await manager.register({
      name: 'async-transform-reporter',
      init: (ctx) => {
        ctx.registerTransform('field', () => {
          throw new Error('transform failed');
        });
      },
    });

    expect(applyField(manager, 'original')).toBe('original');
    await Promise.resolve();
    await Promise.resolve();

    expect(then).toHaveBeenCalledOnce();
  });

  it('contains a hostile then getter returned by the transform error reporter', async () => {
    const thenGetter = vi.fn(() => {
      throw new Error('reporter then getter failed');
    });
    const hostileReporterResult = Object.defineProperty({}, 'then', { get: thenGetter });
    const manager = managerReporting(() => hostileReporterResult);
    await manager.register({
      name: 'hostile-transform-reporter',
      init: (ctx) => {
        ctx.registerTransform('field', () => {
          throw new Error('transform failed');
        });
      },
    });

    expect(() => applyField(manager, 'original')).not.toThrow();
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

    expect(applyField(setup.manager, 'original', () => false)).toBe('original');
    expect(transform).not.toHaveBeenCalled();
  });

  it('suppresses errors thrown while a transform makes its revision obsolete', async () => {
    const errors: Error[] = [];
    let current = true;
    const manager = managerReporting((error) => {
      errors.push(error);
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

    expect(applyField(manager, 'original', () => current)).toBe('original');
    expect(errors).toEqual([]);
  });

  it('observes a rejected Promise returned in violation of the transform contract', async () => {
    const errors: Error[] = [];
    const manager = managerReporting((error) => {
      errors.push(error);
    });
    await manager.register({
      name: 'rejecting-transform',
      init: (ctx) => {
        ctx.registerTransform('field', () => Promise.reject(new Error('late rejection')));
      },
    });

    expect(applyField(manager, 'original')).toBe('original');
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toHaveLength(1);
  });

  it('observes but does not report a rejected transform Promise after supersession', async () => {
    const errors: Error[] = [];
    let current = true;
    const manager = managerReporting((error) => {
      errors.push(error);
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

    expect(applyField(manager, 'original', () => current)).toBe('original');
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
