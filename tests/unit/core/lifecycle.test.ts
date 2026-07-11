import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime, resolveFieldValue } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';

// Provide a controllable IntersectionObserver in jsdom.
class IO implements IntersectionObserver {
  readonly callback: IntersectionObserverCallback;
  readonly observed = new Set<Element>();
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.observed.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const TRUSTED = 'https://admin.example.com';

function fireMessage(data: unknown, origin: string = TRUSTED): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

function textRenderer(): FieldRenderer {
  return {
    name: 'text',
    render(target, value) {
      target.element.textContent =
        value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('LivePreviewRuntime — happy path', () => {
  it('builds cache, processes a valid update, applies via renderer', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'new' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('new');
    expect(runtime.status).toBe('connected');
    expect(runtime.updateCount).toBe(1);
    runtime.destroy();
  });

  it('emits init, connect, beforeUpdate, afterUpdate, elementUpdate', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    const seen: string[] = [];
    const push = (name: string) => () => {
      seen.push(name);
    };
    emitter.on('init', push('init'));
    emitter.on('connect', push('connect'));
    emitter.on('beforeUpdate', push('beforeUpdate'));
    emitter.on('elementUpdate', push('elementUpdate'));
    emitter.on('afterUpdate', push('afterUpdate'));
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'x' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toContain('init');
    expect(seen).toContain('connect');
    expect(seen).toContain('beforeUpdate');
    expect(seen).toContain('elementUpdate');
    expect(seen).toContain('afterUpdate');
    runtime.destroy();
  });

  it('allows beforeUpdate handlers to cancel the update', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    emitter.on('beforeUpdate', (e) => {
      e.cancel();
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'new' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('old');
    runtime.destroy();
  });

  it('emits documentSave for payload-document-event messages', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const emitter = new EventEmitter();
    const onDocumentSave = vi.fn();
    emitter.on('documentSave', onDocumentSave);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-document-event', action: 'updated' });
    await vi.advanceTimersByTimeAsync(50);
    expect(onDocumentSave).toHaveBeenCalledOnce();
    runtime.destroy();
  });
});

describe('LivePreviewRuntime — error handling', () => {
  it('surfaces renderer errors via the error event without aborting', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    const errors: string[] = [];
    emitter.on('error', (e) => {
      errors.push(e.error.message);
    });
    const failingRenderer: FieldRenderer = {
      name: 'text',
      render() {
        throw new Error('renderer boom');
      },
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: failingRenderer },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'x' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(errors).toContain('renderer boom');
    runtime.destroy();
  });

  it('start is idempotent', () => {
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [],
      emitter,
    });
    expect(runtime.start()).toBe(true);
    expect(runtime.start()).toBe(false);
    runtime.destroy();
  });

  it('destroy is idempotent', () => {
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [],
      emitter,
    });
    runtime.start();
    runtime.destroy();
    expect(() => {
      runtime.destroy();
    }).not.toThrow();
  });
});

describe('LivePreviewRuntime — disconnect / heartbeat', () => {
  it('invokes onHeartbeatTimeout hook on timeout', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const emitter = new EventEmitter();
    const onHeartbeatTimeout = vi.fn();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 50,
      disableVisibilityGate: true,
      onHeartbeatTimeout,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: '1' } });
    await vi.advanceTimersByTimeAsync(50);
    vi.advanceTimersByTime(100);
    expect(onHeartbeatTimeout).toHaveBeenCalled();
    runtime.destroy();
  });

  it('marks disconnected and emits when heartbeat times out', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const emitter = new EventEmitter();
    const disconnects: string[] = [];
    emitter.on('disconnect', (e) => {
      disconnects.push(e.reason);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 50,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: '1' } });
    await vi.advanceTimersByTimeAsync(50);
    vi.advanceTimersByTime(100);
    expect(disconnects).toContain('timeout');
    runtime.destroy();
  });

  it('destroy emits a "destroy" reason for in-flight connections', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const emitter = new EventEmitter();
    const disconnects: string[] = [];
    emitter.on('disconnect', (e) => {
      disconnects.push(e.reason);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: '1' } });
    await vi.advanceTimersByTimeAsync(50);
    runtime.destroy();
    expect(disconnects).toContain('destroy');
  });
});

describe('LivePreviewRuntime — cache refresh', () => {
  it('rebuilds the cache when a new tracked element is added', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    const span = document.createElement('span');
    span.setAttribute('data-payload-field', 'subtitle');
    document.body.appendChild(span);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(150);
    fireMessage({ type: 'payload-live-preview', data: { subtitle: 'fresh' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('span')?.textContent).toBe('fresh');
    runtime.destroy();
  });

  it('refreshCache rebuilds explicitly', () => {
    document.body.innerHTML = '<p data-payload-field="title">x</p>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      disableVisibilityGate: true,
    });
    runtime.start();
    expect(runtime.cache.fieldCount).toBe(1);
    document.body.innerHTML = '<p data-payload-field="a">x</p><p data-payload-field="b">y</p>';
    runtime.refreshCache();
    expect(runtime.cache.fieldCount).toBe(2);
    runtime.destroy();
  });
});

describe('resolveFieldValue', () => {
  it('reads top-level fields', () => {
    expect(resolveFieldValue({ a: 1 }, 'a', undefined)).toBe(1);
  });

  it('reads nested dotted paths', () => {
    expect(resolveFieldValue({ hero: { title: 'x' } }, 'hero.title', undefined)).toBe('x');
  });

  it('falls back to locale-suffixed key when present', () => {
    expect(resolveFieldValue({ title_de: 'DE' }, 'title', 'de')).toBe('DE');
  });

  it('blocks prototype pollution keys', () => {
    expect(resolveFieldValue({}, '__proto__', undefined)).toBeUndefined();
    expect(resolveFieldValue({}, 'constructor', undefined)).toBeUndefined();
    expect(resolveFieldValue({}, 'a.__proto__.x', undefined)).toBeUndefined();
  });

  it('returns undefined for missing fields', () => {
    expect(resolveFieldValue({}, 'missing', undefined)).toBeUndefined();
  });

  it('returns undefined when intermediate path segment is not an object', () => {
    expect(resolveFieldValue({ a: 'x' }, 'a.b', undefined)).toBeUndefined();
  });
});

describe('LivePreviewRuntime — orphan-field diagnostic', () => {
  function setupRuntime(html: string, warn: (...args: unknown[]) => void): LivePreviewRuntime {
    document.body.innerHTML = html;
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      warn,
    });
    runtime.start();
    return runtime;
  }

  function joinLog(log: ReturnType<typeof vi.fn>): string {
    return log.mock.calls.map((c) => c.map((a) => String(a)).join(' ')).join('\n');
  }

  it('warns when an update arrives for a field with no [data-payload-field] anchor', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<h1 data-payload-field="title">old</h1>', log);
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'new', shortDescription: 'no anchor here' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(log)).toMatch(
      /update arrived for field "shortDescription".*no .* element exists/s,
    );
    runtime.destroy();
  });

  it('does not warn when the field has a binding', async () => {
    const log = vi.fn();
    const runtime = setupRuntime(
      '<h1 data-payload-field="title">old</h1><p data-payload-field="shortDescription">old</p>',
      log,
    );
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'x', shortDescription: 'y' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(log)).not.toMatch(/update arrived for field/);
    runtime.destroy();
  });

  it('dedupes — the same orphan field only warns once', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<h1 data-payload-field="title">old</h1>', log);
    for (let i = 0; i < 5; i += 1) {
      fireMessage({
        type: 'payload-live-preview',
        data: { title: `t${String(i)}`, missing: `m${String(i)}` },
      });
      await vi.advanceTimersByTimeAsync(50);
    }
    const matches = joinLog(log).match(/update arrived for field "missing"/g) ?? [];
    expect(matches).toHaveLength(1);
    runtime.destroy();
  });

  it('skips system fields (id, createdAt, _status, …)', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<h1 data-payload-field="title">x</h1>', log);
    fireMessage({
      type: 'payload-live-preview',
      data: {
        title: 'new',
        id: 42,
        _id: 'abc',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
        _status: 'draft',
        globalType: 'homepage',
        locale: 'de',
      },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(log)).not.toMatch(/update arrived for field/);
    runtime.destroy();
  });

  it('skips non-scalar values (Lexical objects, relationship arrays)', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<h1 data-payload-field="title">x</h1>', log);
    fireMessage({
      type: 'payload-live-preview',
      data: {
        title: 'new',
        description: { root: { children: [] } }, // Lexical
        relatedItems: [{ id: 1 }, { id: 2 }],
        media: null,
      },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(log)).not.toMatch(/update arrived for field/);
    runtime.destroy();
  });

  it('treats locale-suffixed names as the base name when matching bindings', async () => {
    const log = vi.fn();
    document.body.innerHTML = '<p data-payload-field="title">x</p>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      log,
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      locale: 'de',
      data: { title_de: 'localised value' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(log)).not.toMatch(/update arrived for field/);
    runtime.destroy();
  });

  it('does not warn when the cache is empty (page has no bindings yet)', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<div>no bindings here</div>', log);
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'x', shortDescription: 'y' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(log)).not.toMatch(/update arrived for field/);
    runtime.destroy();
  });

  it('fires through the warn channel even when debug-log is the noop default', async () => {
    const warn = vi.fn();
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      // no `log` — production default is noop; diagnostic should still fire.
      warn,
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'x', someOrphan: 'value' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(warn)).toMatch(/update arrived for field "someOrphan"/);
    runtime.destroy();
  });

  it('defaults the warn channel to console.warn when no override is given', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'x', orphanField: 'no anchor' },
    });
    await vi.advanceTimersByTimeAsync(50);
    const all = consoleWarnSpy.mock.calls
      .flatMap((c) => c)
      .map((a) => String(a))
      .join(' ');
    expect(all).toMatch(/update arrived for field "orphanField"/);
    consoleWarnSpy.mockRestore();
    runtime.destroy();
  });
});
