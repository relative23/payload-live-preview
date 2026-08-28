import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { TRUSTED, fireMessage, textRenderer } from './lifecycle-harness';

describe('LivePreviewRuntime — the orphan-field diagnostic', () => {
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
    expect(joinLog(log)).toMatch(/for field "shortDescription"/);
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
    const matches = joinLog(log).match(/for field "missing"/g) ?? [];
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
        createdBy: 'admin-1',
        updatedBy: 'admin-2',
        _status: 'draft',
        globalType: 'homepage',
        collection: 'posts',
        locale: 'de',
        localized: true,
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
  it('diagnoses every supported scalar kind while ignoring nullish values', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<h1 data-payload-field="title">x</h1>', log);
    fireMessage({
      type: 'payload-live-preview',
      data: {
        title: 'new',
        textOrphan: 'text',
        numberOrphan: 42,
        booleanOrphan: false,
        bigintOrphan: 42n,
        nullValue: null,
        undefinedValue: undefined,
      },
    });
    await vi.advanceTimersByTimeAsync(50);

    const output = joinLog(log);
    for (const field of ['textOrphan', 'numberOrphan', 'booleanOrphan', 'bigintOrphan']) {
      expect(output).toContain(`field "${field}"`);
    }
    expect(output).not.toContain('nullValue');
    expect(output).not.toContain('undefinedValue');
    runtime.destroy();
  });
  it('treats locale-suffixed names as the base name when matching bindings', async () => {
    const warn = vi.fn();
    document.body.innerHTML = '<p data-payload-field="title">x</p>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      warn,
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      locale: 'de',
      data: { title_de: 'localised value' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(warn)).not.toMatch(/update arrived for field/);
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
    expect(joinLog(warn)).toMatch(/for field "someOrphan"/);
    runtime.destroy();
  });
  it('keeps later updates functional when the warning callback throws', async () => {
    let warningCalls = 0;
    const runtime = setupRuntime('<h1 data-payload-field="title">old</h1>', () => {
      warningCalls += 1;
      throw new Error('consumer warning callback failed');
    });

    try {
      fireMessage({
        type: 'payload-live-preview',
        data: { title: 'first', firstOrphan: 'missing' },
      });
      await vi.advanceTimersByTimeAsync(50);
      fireMessage({
        type: 'payload-live-preview',
        data: { title: 'second', secondOrphan: 'missing' },
      });
      await vi.advanceTimersByTimeAsync(50);

      expect(warningCalls).toBe(2);
      expect(document.querySelector('h1')?.textContent).toBe('second');
      expect(runtime.updateCount).toBe(2);
    } finally {
      runtime.destroy();
    }
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
    expect(all).toMatch(/for field "orphanField"/);
    consoleWarnSpy.mockRestore();
    runtime.destroy();
  });
});
