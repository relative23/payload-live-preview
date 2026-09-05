import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { TRUSTED, fireMessage, flushMicrotasks, textRenderer } from './lifecycle-harness';

describe('LivePreviewRuntime — error handling during startup and teardown', () => {
  it('refuses to construct without a document and names the option to pass', () => {
    vi.stubGlobal('document', undefined);
    try {
      expect(
        () =>
          new LivePreviewRuntime({
            renderers: { text: textRenderer() },
            originMatcher: (origin) => origin === TRUSTED,
            readyTargets: [TRUSTED],
            emitter: new EventEmitter(),
            sendReady: () => undefined,
          }),
      ).toThrow('LivePreviewRuntime: no document; pass options.root');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('contains a later ready-retry failure and keeps the runtime operational', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    const readyErrors: string[] = [];
    emitter.on('error', ({ error, context }) => {
      if (context === 'ready') readyErrors.push(error.message);
    });
    const sendReady = vi
      .fn<(origins: readonly string[]) => void>()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('retry transport failed');
      });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      debounceMs: 0,
      disableVisibilityGate: true,
    });

    try {
      expect(runtime.start()).toBe(true);
      await vi.advanceTimersByTimeAsync(500);
      expect(readyErrors).toEqual(['retry transport failed']);

      fireMessage({ type: 'payload-live-preview', data: { title: 'still active' } });
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector('p')?.textContent).toBe('still active');
    } finally {
      runtime.destroy();
    }
  });
  it('completes startup and remains update-capable when its diagnostic logger throws', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      debounceMs: 0,
      disableVisibilityGate: true,
      log: () => {
        throw new Error('consumer logger failed');
      },
    });

    try {
      expect(() => runtime.start()).not.toThrow();
      fireMessage({ type: 'payload-live-preview', data: { title: 'updated' } });
      await vi.advanceTimersByTimeAsync(50);

      expect(document.querySelector('p')?.textContent).toBe('updated');
      expect(runtime.updateCount).toBe(1);
    } finally {
      runtime.destroy();
    }
  });
  it('observes rejected logger thenables without interrupting startup', async () => {
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async logger failed'));
      },
    );
    const log = (): void => {
      return { then } as never;
    };
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      log,
    });

    try {
      expect(runtime.start()).toBe(true);
      await flushMicrotasks();

      expect(then).toHaveBeenCalled();
    } finally {
      runtime.destroy();
    }
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
  it('does not schedule ready retries after sendReady destroys the runtime', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const sendReady = vi.fn(() => {
      runtime.destroy();
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      disableVisibilityGate: true,
    });

    runtime.start();
    await vi.advanceTimersByTimeAsync(2500);
    fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(sendReady).toHaveBeenCalledOnce();
    expect(runtime.cache.elementCount).toBe(0);
    expect(runtime.updateCount).toBe(0);
    expect(document.querySelector('p')?.textContent).toBe('initial');
  });
  it('finishes teardown when cacheRefresh destroys during startup', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const init = vi.fn();
    const sendReady = vi.fn();
    emitter.on('cacheRefresh', () => {
      runtime.destroy();
    });
    emitter.on('init', init);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      disableVisibilityGate: true,
    });

    runtime.start();
    await flushMicrotasks();
    fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
    await vi.advanceTimersByTimeAsync(2500);

    expect(init).not.toHaveBeenCalled();
    expect(sendReady).not.toHaveBeenCalled();
    expect(runtime.cache.elementCount).toBe(0);
    expect(runtime.updateCount).toBe(0);
    expect(document.querySelector('p')?.textContent).toBe('initial');
  });
  it('does not continue startup when init destroys the runtime', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const sendReady = vi.fn();
    emitter.on('init', () => {
      runtime.destroy();
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      disableVisibilityGate: true,
    });

    runtime.start();
    await flushMicrotasks();
    fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
    await vi.advanceTimersByTimeAsync(2500);

    expect(sendReady).not.toHaveBeenCalled();
    expect(runtime.cache.elementCount).toBe(0);
    expect(runtime.updateCount).toBe(0);
    expect(document.querySelector('p')?.textContent).toBe('initial');
  });
});
