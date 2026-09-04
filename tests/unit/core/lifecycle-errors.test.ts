import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import { IO, TRUSTED, fireMessage, flushMicrotasks, textRenderer } from './lifecycle-harness';

describe('LivePreviewRuntime — error handling', () => {
  it('reports a rejected preview token without connecting or rendering', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const errors: { context: string; error: Error }[] = [];
    emitter.on('error', (event) => {
      errors.push(event);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      validateToken: () => false,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      previewToken: 'rejected',
      data: { title: 'must not render' },
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(50);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('token');
    expect(errors[0]?.error).toBeInstanceOf(Error);
    expect(runtime.status).toBe('disconnected');
    expect(runtime.updateCount).toBe(0);
    expect(document.querySelector('p')?.textContent).toBe('initial');
    runtime.destroy();
  });
  it('rejects asynchronous transforms and renders the original value', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const errors: { context: string; error: Error }[] = [];
    emitter.on('error', (event) => {
      errors.push(event);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      transformValue: () => Promise.resolve('async replacement'),
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'original' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('original');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('transform');
    expect(errors[0]?.error).toBeInstanceOf(TypeError);
    runtime.destroy();
  });
  it('contains renderer-resolution failures and emits no successful batch', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const errors: { context: string; error: Error }[] = [];
    const afterUpdate = vi.fn();
    emitter.on('error', (event) => {
      errors.push(event);
    });
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      resolveRenderer: () => {
        throw new Error('resolution failed');
      },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'must not render' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('renderer');
    expect(errors[0]?.error).toBeInstanceOf(Error);
    expect(afterUpdate).not.toHaveBeenCalled();
    expect(document.querySelector('p')?.textContent).toBe('initial');
    runtime.destroy();
  });
  it('suppresses a resolver failure after that resolver accepts a newer revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const errors = vi.fn();
    const afterUpdate = vi.fn();
    emitter.on('error', errors);
    emitter.on('afterUpdate', afterUpdate);
    let firstResolution = true;
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      resolveRenderer: () => {
        if (firstResolution) {
          firstResolution = false;
          fireMessage({ type: 'payload-live-preview', data: { title: 'current' } });
          throw new Error('obsolete resolver failure');
        }
        return textRenderer();
      },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'obsolete' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(errors).not.toHaveBeenCalled();
    expect(document.querySelector('p')?.textContent).toBe('current');
    expect(afterUpdate).toHaveBeenCalledOnce();
    runtime.destroy();
  });
  it('treats a missing renderer as a no-write rather than a successful batch', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const errors = vi.fn();
    const afterUpdate = vi.fn();
    emitter.on('error', errors);
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'must not render' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(errors).not.toHaveBeenCalled();
    expect(afterUpdate).not.toHaveBeenCalled();
    expect(document.querySelector('p')?.textContent).toBe('initial');
    runtime.destroy();
  });
  it('continues complete teardown when an owned observer disconnect throws', () => {
    class ThrowingDisconnectIO extends IO {
      override disconnect(): void {
        super.disconnect();
        throw new Error('disconnect failed');
      }
    }
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const destroy = vi.fn();
    emitter.on('destroy', destroy);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      log: vi.fn(),
      enableA11y: false,
    });

    globalThis.IntersectionObserver = ThrowingDisconnectIO;
    try {
      runtime.start();
      expect(runtime.cache.elementCount).toBe(1);

      expect(() => runtime.destroy()).not.toThrow();

      expect(runtime.cache.elementCount).toBe(0);
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      globalThis.IntersectionObserver = IO;
      runtime.destroy();
    }
  });
  it('passes the configured intersection margin to the owned observer', () => {
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      intersectionRootMargin: '37px 11px',
      enableA11y: false,
    });

    runtime.start();

    expect(IO.latest?.rootMargin).toBe('37px 11px');
    runtime.destroy();
  });
  it('captures native form and image values before elementUpdate callbacks', async () => {
    document.body.innerHTML =
      '<input data-payload-field="input" data-payload-type="text" value="input before">' +
      '<textarea data-payload-field="textarea" data-payload-type="text">textarea before</textarea>' +
      '<img data-payload-field="image" data-payload-type="text" src="/image-before.jpg" alt="">';
    const textarea = document.querySelector('textarea');
    if (textarea === null) throw new Error('textarea binding missing');
    textarea.value = 'textarea live value';
    const emitter = new EventEmitter();
    const previousValues: unknown[] = [];
    emitter.on('elementUpdate', (event) => {
      previousValues.push(event.previousValue);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: { name: 'text', render: () => undefined } },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      data: { input: 'next', textarea: 'next', image: 'next' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(previousValues).toEqual([
      'input before',
      'textarea live value',
      'http://localhost:3000/image-before.jpg',
    ]);
    runtime.destroy();
  });
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
  it('rolls back a failed observer startup so the same runtime can retry', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    class FailingIntersectionObserver extends IO {
      constructor(callback: IntersectionObserverCallback) {
        super(callback);
        throw new Error('intersection observer unavailable');
      }
    }
    globalThis.IntersectionObserver = FailingIntersectionObserver;
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      debounceMs: 0,
      disableVisibilityGate: true,
    });

    try {
      expect(() => runtime.start()).toThrow('intersection observer unavailable');
      expect(runtime.cache.elementCount).toBe(0);

      globalThis.IntersectionObserver = originalIntersectionObserver;
      expect(runtime.start()).toBe(true);
      fireMessage({ type: 'payload-live-preview', data: { title: 'after retry' } });
      await vi.advanceTimersByTimeAsync(50);

      expect(document.querySelector('p')?.textContent).toBe('after retry');
      expect(runtime.updateCount).toBe(1);
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver;
      runtime.destroy();
    }
  });
  it('rolls back bus, observers, cache, and ready timers when initial sendReady throws', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const sendReady = vi.fn<(origins: readonly string[]) => void>().mockImplementationOnce(() => {
      throw new Error('ready transport failed');
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      sendReady,
      debounceMs: 0,
      disableVisibilityGate: true,
    });

    try {
      expect(() => runtime.start()).toThrow('ready transport failed');
      const failedObserver = IO.latest;
      expect(failedObserver?.observed.size).toBe(0);
      expect(runtime.cache.elementCount).toBe(0);

      fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
      await vi.advanceTimersByTimeAsync(2500);
      expect(document.querySelector('p')?.textContent).toBe('old');
      expect(sendReady).toHaveBeenCalledOnce();

      expect(runtime.start()).toBe(true);
      fireMessage({ type: 'payload-live-preview', data: { title: 'after retry' } });
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector('p')?.textContent).toBe('after retry');
    } finally {
      runtime.destroy();
    }
  });
});
