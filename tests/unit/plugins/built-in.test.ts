import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { PluginManager } from '@plugins/manager';
import { highlightPlugin } from '@plugins/built-in/highlight';
import { debugPlugin } from '@plugins/built-in/debug';
import { createAnalyticsPlugin } from '@plugins/built-in/analytics';
import type { PluginContext } from '@plugins/types';

function setup() {
  const events = new EventEmitter();
  const logs: unknown[][] = [];
  const manager = new PluginManager({
    events,
    config: {},
    registerFieldRenderer: () => () => {},
    log: (...args) => {
      logs.push(args);
    },
  });
  return { events, logs, manager };
}

describe('highlight plugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.getElementById('payload-live-preview-highlight')?.remove();
  });

  it('adds and removes the lp-highlight class on elementUpdate', async () => {
    const { manager, events } = setup();
    await manager.register(highlightPlugin);
    const element = document.createElement('p');
    document.body.appendChild(element);
    await events.emit('elementUpdate', {
      element,
      fieldName: 'f',
      previousValue: null,
      nextValue: 'x',
      revision: 1,
    });
    expect(element.classList.contains('lp-highlight')).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(element.classList.contains('lp-highlight')).toBe(false);
  });

  it('appends only one style tag even after re-registration', async () => {
    const { manager } = setup();
    await manager.register(highlightPlugin);
    await manager.unregister('highlight');
    await manager.register(highlightPlugin);
    expect(document.querySelectorAll('style#payload-live-preview-highlight')).toHaveLength(1);
  });

  it('removes the style tag on destroy', async () => {
    const { manager } = setup();
    await manager.register(highlightPlugin);
    await manager.unregister('highlight');
    expect(document.getElementById('payload-live-preview-highlight')).toBeNull();
  });

  it('releases an active highlight timer and ignores later events after unregister', async () => {
    const { manager, events } = setup();
    await manager.register(highlightPlugin);
    const element = document.createElement('p');
    document.body.appendChild(element);
    const event = {
      element,
      fieldName: 'f',
      previousValue: null,
      nextValue: 'x',
      revision: 1,
    };
    await events.emit('elementUpdate', event);
    expect(element.classList.contains('lp-highlight')).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    await manager.unregister('highlight');
    expect(element.classList.contains('lp-highlight')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    await events.emit('elementUpdate', event);
    expect(element.classList.contains('lp-highlight')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not remove an existing consumer-owned style element', async () => {
    const style = document.createElement('style');
    style.id = 'payload-live-preview-highlight';
    style.textContent = '.consumer-owned{}';
    document.head.appendChild(style);
    const { manager } = setup();

    await manager.register(highlightPlugin);
    await manager.unregister('highlight');

    expect(document.getElementById(style.id)).toBe(style);
    expect(style.textContent).toBe('.consumer-owned{}');
  });

  it('does not remove a pre-existing consumer highlight class', async () => {
    const { manager, events } = setup();
    const element = document.createElement('p');
    element.classList.add('lp-highlight');
    document.body.appendChild(element);
    await manager.register(highlightPlugin);

    await events.emit('elementUpdate', {
      element,
      fieldName: 'f',
      previousValue: null,
      nextValue: 'x',
      revision: 1,
    });
    await manager.unregister('highlight');

    expect(element.classList.contains('lp-highlight')).toBe(true);
  });

  it('keeps the shared style until every client registration releases it', async () => {
    const first = setup().manager;
    const second = setup().manager;
    await first.register(highlightPlugin);
    await second.register(highlightPlugin);

    await first.unregister('highlight');
    expect(document.getElementById('payload-live-preview-highlight')).not.toBeNull();

    await second.unregister('highlight');
    expect(document.getElementById('payload-live-preview-highlight')).toBeNull();
  });

  it('keeps a shared highlight class until every client lease is released', async () => {
    const first = setup();
    const second = setup();
    const element = document.createElement('p');
    document.body.appendChild(element);
    const event = {
      element,
      fieldName: 'f',
      previousValue: null,
      nextValue: 'x',
      revision: 1,
    };
    await first.manager.register(highlightPlugin);
    await second.manager.register(highlightPlugin);
    await first.events.emit('elementUpdate', event);
    await second.events.emit('elementUpdate', event);

    await first.manager.unregister('highlight');
    expect(element.classList.contains('lp-highlight')).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(element.classList.contains('lp-highlight')).toBe(false);
    await second.manager.unregister('highlight');
  });

  it('uses a non-animated style and longer lease for reduced-motion users', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }) as MediaQueryList),
    );
    const { manager, events } = setup();
    await manager.register(highlightPlugin);
    const element = document.createElement('p');

    expect(document.getElementById('payload-live-preview-highlight')?.textContent).not.toContain(
      '@keyframes',
    );
    await events.emit('elementUpdate', {
      element,
      fieldName: 'f',
      previousValue: null,
      nextValue: 'x',
      revision: 1,
    });
    vi.advanceTimersByTime(999);
    expect(element.classList.contains('lp-highlight')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(element.classList.contains('lp-highlight')).toBe(false);
  });

  it('restarts the lease timer when the same element updates again', async () => {
    const { manager, events } = setup();
    await manager.register(highlightPlugin);
    const element = document.createElement('p');
    const event = {
      element,
      fieldName: 'f',
      previousValue: null,
      nextValue: 'x',
      revision: 1,
    };

    await events.emit('elementUpdate', event);
    vi.advanceTimersByTime(300);
    await events.emit('elementUpdate', event);

    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(599);
    expect(element.classList.contains('lp-highlight')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(element.classList.contains('lp-highlight')).toBe(false);
  });

  it('replaces a disconnected owned style without disturbing the new lease', async () => {
    const first = setup().manager;
    const second = setup().manager;
    await first.register(highlightPlugin);
    const disconnectedStyle = document.getElementById('payload-live-preview-highlight');
    disconnectedStyle?.remove();

    await second.register(highlightPlugin);
    const replacementStyle = document.getElementById('payload-live-preview-highlight');
    expect(replacementStyle).not.toBeNull();
    expect(replacementStyle).not.toBe(disconnectedStyle);

    await first.unregister('highlight');
    expect(document.getElementById('payload-live-preview-highlight')).toBe(replacementStyle);
    await second.unregister('highlight');
    expect(document.getElementById('payload-live-preview-highlight')).toBeNull();
  });

  it('supports legacy plugin contexts without a cleanup registrar', async () => {
    const events = new EventEmitter();
    const context: PluginContext = {
      events,
      registerFieldRenderer: () => undefined,
      registerTransform: () => undefined,
      getConfig: () => ({}),
      log: () => undefined,
    };
    const element = document.createElement('p');

    await highlightPlugin.init(context);
    await events.emit('elementUpdate', {
      element,
      fieldName: 'f',
      previousValue: null,
      nextValue: 'x',
      revision: 1,
    });
    vi.advanceTimersByTime(600);

    expect(element.classList.contains('lp-highlight')).toBe(false);
  });

  it('is inert when browser globals are unavailable', async () => {
    const events = new EventEmitter();
    const context: PluginContext = {
      events,
      registerFieldRenderer: () => undefined,
      registerTransform: () => undefined,
      getConfig: () => ({}),
      log: () => undefined,
    };
    vi.stubGlobal('window', undefined);

    await highlightPlugin.init(context);

    expect(events.listenerCount('elementUpdate')).toBe(0);
  });
});

describe('debug plugin', () => {
  it('logs lifecycle events through the plugin context', async () => {
    const { manager, events, logs } = setup();
    await manager.register(debugPlugin);
    await events.emit('init', { timestamp: 1 });
    await events.emit('connect', { origin: 'https://x.example.com', timestamp: 1 });
    await events.emit('disconnect', { reason: 'timeout', timestamp: 1 });
    await events.emit('cacheRefresh', { elementCount: 1, fieldCount: 1, durationMs: 0 });
    await events.emit('beforeUpdate', {
      data: { fields: { title: 'Updated' } },
      revision: 1,
      cancel: () => undefined,
    });
    await events.emit('afterUpdate', {
      data: { fields: {} },
      updatedCount: 2,
      durationMs: 1.5,
      revision: 1,
    });
    await events.emit('error', {
      error: new Error('oops'),
      context: 'renderer',
      code: 'LP0603',
    });
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe('analytics plugin', () => {
  it('accumulates summary statistics', async () => {
    const { manager, events } = setup();
    const plugin = createAnalyticsPlugin();
    await manager.register(plugin);
    await events.emit('afterUpdate', {
      data: { fields: {} },
      updatedCount: 3,
      durationMs: 2,
      revision: 1,
    });
    await events.emit('afterUpdate', {
      data: { fields: {} },
      updatedCount: 1,
      durationMs: 4,
      revision: 2,
    });
    const stats = plugin.getStats();
    expect(stats.updateCount).toBe(2);
    expect(stats.totalElements).toBe(4);
    expect(stats.totalDurationMs).toBe(6);
    expect(stats.averageDurationMs).toBe(3);
  });

  it('returns zeros before any updates', () => {
    const plugin = createAnalyticsPlugin();
    expect(plugin.getStats()).toEqual({
      updateCount: 0,
      totalElements: 0,
      totalDurationMs: 0,
      averageDurationMs: 0,
    });
  });
});
