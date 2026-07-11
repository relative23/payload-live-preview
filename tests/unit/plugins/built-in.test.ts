import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { PluginManager } from '@plugins/manager';
import { highlightPlugin } from '@plugins/built-in/highlight';
import { debugPlugin } from '@plugins/built-in/debug';
import { createAnalyticsPlugin } from '@plugins/built-in/analytics';

function setup() {
  const events = new EventEmitter();
  const logs: unknown[][] = [];
  const manager = new PluginManager({
    events,
    config: {},
    registerFieldRenderer: () => {},
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
});

describe('debug plugin', () => {
  it('logs lifecycle events through the plugin context', async () => {
    const { manager, events, logs } = setup();
    await manager.register(debugPlugin);
    await events.emit('init', { timestamp: 1 });
    await events.emit('connect', { origin: 'https://x.example.com', timestamp: 1 });
    await events.emit('cacheRefresh', { elementCount: 1, fieldCount: 1, durationMs: 0 });
    await events.emit('afterUpdate', {
      data: { fields: {} },
      updatedCount: 2,
      durationMs: 1.5,
    });
    await events.emit('error', {
      error: new Error('oops'),
      context: 'renderer',
    });
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe('analytics plugin', () => {
  it('accumulates summary statistics', async () => {
    const { manager, events } = setup();
    const plugin = createAnalyticsPlugin();
    await manager.register(plugin);
    await events.emit('afterUpdate', { data: { fields: {} }, updatedCount: 3, durationMs: 2 });
    await events.emit('afterUpdate', { data: { fields: {} }, updatedCount: 1, durationMs: 4 });
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
