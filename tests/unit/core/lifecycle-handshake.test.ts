import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { IO, TRUSTED, fireMessage, flushMicrotasks, textRenderer } from './lifecycle-harness';

describe('LivePreviewRuntime — the ready handshake and revision metadata', () => {
  it('emits no success for deferred-only work and attributes a later replay correctly', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      visibilityGateThreshold: 0,
    });
    runtime.start();
    expect(IO.latest?.observed.has(element)).toBe(true);

    fireMessage({ type: 'payload-live-preview', data: { title: 'A', marker: 1 } });
    await vi.advanceTimersByTimeAsync(50);
    expect(element.textContent).toBe('initial');
    expect(afterUpdate).not.toHaveBeenCalled();

    fireMessage({ type: 'payload-live-preview', data: { title: 'B', marker: 2 } });
    await vi.advanceTimersByTimeAsync(50);
    expect(afterUpdate).not.toHaveBeenCalled();

    IO.latest?.setVisible(element, true);
    await flushMicrotasks();
    expect(element.textContent).toBe('B');
    expect(afterUpdate).toHaveBeenCalledOnce();
    expect(afterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { fields: { title: 'B', marker: 2 } },
        revision: 2,
        updatedCount: 1,
      }),
    );
    runtime.destroy();
  });
  it('reports visible and replayed writes as truthful batches of the same revision', async () => {
    document.body.innerHTML =
      '<p data-payload-field="title">old title</p><p data-payload-field="subtitle">old subtitle</p>';
    const [visible, deferredElement] = [...document.querySelectorAll('p')];
    if (visible === undefined || deferredElement === undefined) throw new Error('bindings missing');
    const emitter = new EventEmitter();
    const after: {
      readonly data: { readonly fields: Record<string, unknown> };
      readonly revision?: number;
      readonly updatedCount: number;
    }[] = [];
    emitter.on('afterUpdate', (event) => {
      after.push(event);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      visibilityGateThreshold: 0,
    });
    runtime.start();
    IO.latest?.setVisible(visible, true);

    const fields = { title: 'new title', subtitle: 'new subtitle', marker: 'same snapshot' };
    fireMessage({ type: 'payload-live-preview', data: fields });
    await vi.advanceTimersByTimeAsync(50);

    expect(visible.textContent).toBe('new title');
    expect(deferredElement.textContent).toBe('old subtitle');
    expect(after).toEqual([
      {
        data: { fields },
        revision: 1,
        updatedCount: 1,
        durationMs: 0,
        receivedAt: expect.any(Number) as number,
        source: 'patch',
      },
    ]);

    IO.latest?.setVisible(deferredElement, true);
    await flushMicrotasks();

    expect(deferredElement.textContent).toBe('new subtitle');
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ data: { fields }, revision: 1, updatedCount: 1 });
    runtime.destroy();
  });
  it('negotiates a data-less ready handshake without consuming an update revision', () => {
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter: new EventEmitter(),
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', ready: true, protocolVersion: 3 });

    expect(runtime.updateCount).toBe(0);
    expect(runtime.protocol).toMatchObject({ ours: 4, theirs: 3, negotiated: 3 });
    expect([...runtime.protocol.capabilities]).toEqual([
      'basic',
      'schema-json',
      'locale',
      'preview-token',
    ]);
    runtime.destroy();
  });
  it('uses the default ready broadcaster for a parent window', () => {
    const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');
    const postMessage = vi.fn();
    const parent = { postMessage } as unknown as Window;
    Object.defineProperty(window, 'parent', { configurable: true, value: parent });
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      enableA11y: false,
    });

    try {
      runtime.start();

      expect(postMessage).toHaveBeenCalledWith(
        { type: 'payload-live-preview', ready: true, protocolVersion: 4 },
        TRUSTED,
      );
    } finally {
      runtime.destroy();
      if (parentDescriptor === undefined) Reflect.deleteProperty(window, 'parent');
      else Object.defineProperty(window, 'parent', parentDescriptor);
    }
  });
  it('uses the default ready broadcaster for a valid opener window', () => {
    const openerDescriptor = Object.getOwnPropertyDescriptor(window, 'opener');
    const postMessage = vi.fn();
    const opener = Object.create(Window.prototype) as Window;
    Object.defineProperty(opener, 'postMessage', { configurable: true, value: postMessage });
    Object.defineProperty(window, 'opener', { configurable: true, value: opener });
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      enableA11y: false,
    });

    try {
      runtime.start();

      expect(postMessage).toHaveBeenCalledWith(
        { type: 'payload-live-preview', ready: true, protocolVersion: 4 },
        TRUSTED,
      );
    } finally {
      runtime.destroy();
      if (openerDescriptor === undefined) Reflect.deleteProperty(window, 'opener');
      else Object.defineProperty(window, 'opener', openerDescriptor);
    }
  });
  it('does not resume a protocol-bearing revision superseded by reentrant diagnostics', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    let reentered = false;
    const log = (kind: unknown): void => {
      if (kind === 'protocol' && !reentered) {
        reentered = true;
        fireMessage({ type: 'payload-live-preview', data: { title: 'current' } });
      }
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      log,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      protocolVersion: 2,
      data: { title: 'obsolete' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('current');
    expect(runtime.updateCount).toBe(2);
    expect(afterUpdate).toHaveBeenCalledOnce();
    expect(afterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fields: { title: 'current' } }, revision: 2 }),
    );
    runtime.destroy();
  });
  it('does not resume a connecting revision superseded by reentrant diagnostics', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    let reentered = false;
    const log = (kind: unknown): void => {
      if (kind === 'connection' && !reentered) {
        reentered = true;
        fireMessage({ type: 'payload-live-preview', data: { title: 'current' } });
      }
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      log,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'obsolete' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('current');
    expect(runtime.updateCount).toBe(2);
    expect(afterUpdate).toHaveBeenCalledOnce();
    expect(afterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fields: { title: 'current' } }, revision: 2 }),
    );
    runtime.destroy();
  });
  it('stops obsolete field resolution after a data getter accepts a newer revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    let reentered = false;
    const fields = Object.defineProperty({}, 'title', {
      enumerable: true,
      get(): string {
        if (!reentered) {
          reentered = true;
          fireMessage({ type: 'payload-live-preview', data: { title: 'current' } });
        }
        return 'obsolete';
      },
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: fields });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('current');
    expect(afterUpdate).toHaveBeenCalledOnce();
    expect(afterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fields: { title: 'current' } }, revision: 2 }),
    );
    runtime.destroy();
  });
  it('keeps schema, slug, and locale metadata attached to their applied revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const applied: unknown[] = [];
    emitter.on('afterUpdate', (event) => {
      applied.push(event);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();
    const schema = [{ name: 'title', type: 'text' }] as const;

    fireMessage({
      type: 'payload-live-preview',
      globalSlug: 'homepage',
      locale: 'de',
      fieldSchemaJSON: schema,
      data: { title: 'global' },
    });
    await vi.advanceTimersByTimeAsync(50);
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { title: 'collection' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(applied).toMatchObject([
      {
        data: { fields: { title: 'global' }, schema, globalSlug: 'homepage', locale: 'de' },
        revision: 1,
      },
      {
        data: { fields: { title: 'collection' }, schema, collectionSlug: 'posts', locale: 'de' },
        revision: 2,
      },
    ]);
    runtime.destroy();
  });
  it('keeps malformed Lexical-like objects on the ordinary text path', async () => {
    document.body.innerHTML =
      '<p data-payload-field="missingRoot">initial</p>' +
      '<p data-payload-field="nullRoot">initial</p>';
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      data: { missingRoot: {}, nullRoot: { root: null } },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('[data-payload-field="missingRoot"]')?.textContent).toBe('{}');
    expect(document.querySelector('[data-payload-field="nullRoot"]')?.textContent).toBe(
      '{"root":null}',
    );
    runtime.destroy();
  });
});
