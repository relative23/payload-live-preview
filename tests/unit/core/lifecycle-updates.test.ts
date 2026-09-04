import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { TRUSTED, fireMessage, textRenderer } from './lifecycle-harness';

describe('LivePreviewRuntime — applying an update and emitting its events', () => {
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
  it('leases accessibility regions in each runtime root document', async () => {
    document.body.innerHTML = '<p data-payload-field="title">main</p>';
    const otherDocument = document.implementation.createHTMLDocument('other');
    otherDocument.body.innerHTML = '<p data-payload-field="title">other</p>';
    const base = {
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    } as const;
    const main = new LivePreviewRuntime({ ...base, root: document, emitter: new EventEmitter() });
    const other = new LivePreviewRuntime({
      ...base,
      root: otherDocument.body,
      emitter: new EventEmitter(),
    });
    main.start();
    other.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'updated' } });
    await vi.advanceTimersByTimeAsync(50);

    const regionId = 'payload-live-preview-a11y';
    expect(document.getElementById(regionId)).not.toBeNull();
    expect(otherDocument.getElementById(regionId)).not.toBeNull();
    main.destroy();
    expect(document.getElementById(regionId)).toBeNull();
    expect(otherDocument.getElementById(regionId)).not.toBeNull();
    other.destroy();
  });
  it('releases the final accessibility lease without publishing a transient destroy announcement', async () => {
    document.body.innerHTML =
      '<div id="payload-live-preview-a11y"><span>Consumer baseline</span></div>' +
      '<p data-payload-field="title">initial</p>';
    const region = document.getElementById('payload-live-preview-a11y');
    const consumerChild = region?.firstChild;
    if (region === null || consumerChild === null) throw new Error('test live region missing');

    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'updated' } });
    await vi.advanceTimersByTimeAsync(50);

    const observer = new MutationObserver(() => undefined);
    observer.observe(region, { characterData: true, subtree: true });
    runtime.destroy();
    const teardownMutations = observer.takeRecords();
    observer.disconnect();

    // Destroy releases the package-owned message node synchronously. It does
    // not briefly overwrite it with a disconnect message that cannot remain
    // mounted long enough to be a reliable screen-reader announcement.
    expect(teardownMutations).toHaveLength(0);
    expect(region.firstChild).toBe(consumerChild);
    expect(region.childNodes).toHaveLength(1);
    expect(region.textContent).toBe('Consumer baseline');
    expect(vi.getTimerCount()).toBe(0);
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
  it('skips guarded update events and the pre-render DOM snapshot when nobody listens', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('test binding missing');

    const readSnapshot = vi.fn(() => 'old');
    Object.defineProperty(element, 'textContent', {
      configurable: true,
      get: readSnapshot,
      set: () => undefined,
    });

    const render = vi.fn();
    const emitter = new EventEmitter();
    const emitWhile = vi.spyOn(emitter, 'emitWhile');
    const runtime = new LivePreviewRuntime({
      renderers: { text: { name: 'text', render } },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();
    emitWhile.mockClear();

    fireMessage({ type: 'payload-live-preview', data: { title: 'new' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(render).toHaveBeenCalledOnce();
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(emitWhile.mock.calls.map(([event]) => event)).not.toEqual(
      expect.arrayContaining(['beforeUpdate', 'elementUpdate', 'afterUpdate']),
    );
    runtime.destroy();
  });
  it('retains event data and one pre-render snapshot when update listeners exist', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('test binding missing');

    const readSnapshot = vi.fn(() => 'old snapshot');
    Object.defineProperty(element, 'textContent', {
      configurable: true,
      get: readSnapshot,
      set: () => undefined,
    });

    const beforeUpdate = vi.fn();
    const elementUpdate = vi.fn();
    const afterUpdate = vi.fn();
    const emitter = new EventEmitter();
    emitter.on('beforeUpdate', beforeUpdate);
    emitter.on('elementUpdate', elementUpdate);
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: { name: 'text', render: vi.fn() } },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'new' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(readSnapshot).toHaveBeenCalledOnce();
    expect(beforeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fields: { title: 'new' } }, revision: 1 }),
    );
    expect(elementUpdate).toHaveBeenCalledWith({
      element,
      fieldName: 'title',
      previousValue: 'old snapshot',
      nextValue: 'new',
      revision: 1,
      receivedAt: expect.any(Number) as number,
      source: 'patch',
    });
    expect(afterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { fields: { title: 'new' } },
        updatedCount: 1,
        revision: 1,
      }),
    );
    runtime.destroy();
  });
  it('starts an elementUpdate listener registered by a renderer with the next write', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    const elementUpdate = vi.fn();
    let registered = false;
    const runtime = new LivePreviewRuntime({
      renderers: {
        text: {
          name: 'text',
          render: (target, value) => {
            if (!registered) {
              registered = true;
              emitter.on('elementUpdate', elementUpdate);
            }
            target.element.textContent = String(value);
          },
        },
      },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'first' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(elementUpdate).not.toHaveBeenCalled();

    fireMessage({ type: 'payload-live-preview', data: { title: 'second' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(elementUpdate).toHaveBeenCalledOnce();
    expect(elementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ previousValue: 'first', nextValue: 'second', revision: 2 }),
    );
    runtime.destroy();
  });
  it('discards an update superseded by a reentrant element snapshot getter', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('test binding missing');

    let superseded = false;
    Object.defineProperty(element, 'textContent', {
      configurable: true,
      get: () => {
        if (!superseded) {
          superseded = true;
          fireMessage({ type: 'payload-live-preview', data: { title: 'newer' } });
        }
        return 'old';
      },
      set: () => undefined,
    });

    const rendered: unknown[] = [];
    const emitter = new EventEmitter();
    emitter.on('elementUpdate', vi.fn());
    const runtime = new LivePreviewRuntime({
      renderers: {
        text: {
          name: 'text',
          render: (_target, value) => {
            rendered.push(value);
          },
        },
      },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'older' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(rendered).toEqual(['newer']);
    runtime.destroy();
  });
});
