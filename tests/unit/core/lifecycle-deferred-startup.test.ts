import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { IO, fireMessage, makeRuntime } from './lifecycle-startup-harness';

describe('deferred startup while the document is parsing', () => {
  it('rolls back when a ready document has no body so startup can retry', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const body = document.body;
    const bodyGetter = vi.spyOn(document, 'body', 'get').mockReturnValue(null as never);
    const runtime = makeRuntime();

    expect(() => runtime.start()).toThrow();
    expect(runtime.cache.elementCount).toBe(0);
    bodyGetter.mockReturnValue(body);

    expect(runtime.start()).toBe(true);
    fireMessage({ type: 'payload-live-preview', data: { title: 'after retry' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('after retry');

    runtime.destroy();
    bodyGetter.mockRestore();
  });
  it('rolls back a failed DOM-ready listener acquisition so startup can retry', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const addEventListener = vi.spyOn(document, 'addEventListener').mockImplementationOnce(() => {
      throw new Error('listener unavailable');
    });
    const runtime = makeRuntime();

    expect(() => runtime.start()).toThrow('listener unavailable');
    addEventListener.mockRestore();
    readyState.mockReturnValue('interactive');

    expect(runtime.start()).toBe(true);
    fireMessage({ type: 'payload-live-preview', data: { title: 'after retry' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('after retry');

    runtime.destroy();
    readyState.mockRestore();
  });
  it('waits for DOMContentLoaded when readyState is loading', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

    const runtime = makeRuntime();
    expect(runtime.start()).toBe(true);

    // Not yet listening: a message before DOMContentLoaded is ignored.
    fireMessage({ type: 'payload-live-preview', data: { title: 'early' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('old');

    readyState.mockReturnValue('interactive');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    fireMessage({ type: 'payload-live-preview', data: { title: 'after ready' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('after ready');

    runtime.destroy();
    readyState.mockRestore();
  });
  it('reports LP0605 when the deferred startup itself fails', () => {
    // start() has already returned by the time DOMContentLoaded fires, so a
    // failure here cannot reach its caller and must surface as an error event.
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const emitter = new EventEmitter();
    const codes: string[] = [];
    const contexts: string[] = [];
    emitter.on('error', (e) => {
      codes.push(e.code);
      contexts.push(e.context);
    });

    const runtime = makeRuntime({
      emitter,
      // Fails only once the deferred startup runs, not while start() is on the
      // stack: the observer is acquired during #startNow().
      resolveRenderer: () => {
        throw new Error('resolution exploded');
      },
    });
    expect(runtime.start()).toBe(true);

    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = function broken(): never {
      throw new Error('observer unavailable');
    } as unknown as typeof IntersectionObserver;
    readyState.mockReturnValue('interactive');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    globalThis.IntersectionObserver = original;

    expect(codes).toContain('LP0605');
    expect(contexts).toContain('startup');

    runtime.destroy();
    readyState.mockRestore();
  });
  it('destroy() before DOMContentLoaded cancels the pending startup', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

    const runtime = makeRuntime();
    runtime.start();
    runtime.destroy();

    readyState.mockReturnValue('complete');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('old');
    readyState.mockRestore();
  });
  it('reports and rolls back a deferred startup failure so it can retry', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    class FailingIntersectionObserver extends IO {
      constructor(_callback: IntersectionObserverCallback) {
        super();
        throw new Error('deferred observer unavailable');
      }
    }
    globalThis.IntersectionObserver = FailingIntersectionObserver;
    const emitter = new EventEmitter();
    const startupErrors: string[] = [];
    emitter.on('error', ({ error, context }) => {
      if (context === 'startup') startupErrors.push(error.message);
    });
    const runtime = makeRuntime({ emitter });

    try {
      expect(runtime.start()).toBe(true);
      readyState.mockReturnValue('interactive');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      await Promise.resolve();

      expect(startupErrors).toEqual(['deferred observer unavailable']);
      expect(runtime.cache.elementCount).toBe(0);

      globalThis.IntersectionObserver = originalIntersectionObserver;
      expect(runtime.start()).toBe(true);
      fireMessage({ type: 'payload-live-preview', data: { title: 'after retry' } });
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector('h1')?.textContent).toBe('after retry');
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver;
      runtime.destroy();
      readyState.mockRestore();
    }
  });
});
