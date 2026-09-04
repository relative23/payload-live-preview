import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { deferred, fireMessage, makeRuntime } from './lifecycle-startup-harness';

describe('dataMerge option (Payload 3.x REST merging)', () => {
  it('preserves an explicit API route and zero population depth', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'post-1', title: 'merged title' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const runtime = makeRuntime({
      dataMerge: {
        serverURL: 'https://cms.example.com/',
        apiRoute: '/custom-api',
        depth: 0,
        fetchFn,
      },
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: 'post-1', title: 'raw title' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(fetchFn).toHaveBeenCalledOnce();
    const firstCall = fetchFn.mock.calls[0];
    expect(firstCall?.[0]).toBe('https://cms.example.com/custom-api/posts/post-1');
    const requestBody = firstCall?.[1]?.body;
    expect(typeof requestBody).toBe('string');
    const body: unknown = typeof requestBody === 'string' ? JSON.parse(requestBody) : null;
    expect(body).toMatchObject({ depth: 0 });
    expect(document.querySelector('h1')?.textContent).toBe('merged title');
    runtime.destroy();
  });
  it('stops cleanly when the merge is superseded, without an escaping rejection', async () => {
    // Dropping the early return here does not change what lands in the DOM —
    // the revision is superseded either way — so only the absence of a failure
    // tells a clean stop from one that throws its way out of the pipeline.
    document.body.innerHTML = '<h1 data-payload-field="title">initial</h1>';
    const response = deferred<Response>();
    const log = vi.fn();
    const runtime = makeRuntime({
      log,
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: () => response.promise },
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'first' },
    });
    runtime.destroy();
    response.resolve(new Response(JSON.stringify({ id: '1', title: 'merged' })));
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('h1')?.textContent).toBe('initial');
    expect(log.mock.calls.flat().join(' ')).not.toContain('update failed');
  });

  it('logs an unexpected failure in the update pipeline instead of letting it escape', async () => {
    // Nothing awaits the pipeline, so without a boundary a throw here would
    // surface as an unhandled rejection: a console error the host cannot
    // attribute, and a process exit under `--unhandled-rejections=strict`.
    document.body.innerHTML = '<h1 data-payload-field="title">initial</h1>';
    const log = vi.fn();
    const hostile: Record<string, readonly string[]> = {};
    Object.defineProperty(hostile, 'title', {
      enumerable: true,
      get(): readonly string[] {
        throw new Error('dependency map exploded');
      },
    });
    const runtime = makeRuntime({ log, dependencies: hostile });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'next' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(log.mock.calls.flat().join(' ')).toContain('update failed');
    expect(document.querySelector('h1')?.textContent).toBe('initial');
  });

  it('discards an abort-ignoring merge response after runtime destroy', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">initial</h1>';
    const response = deferred<Response>();
    const fetchFn = vi.fn<typeof fetch>(() => response.promise);
    const emitter = new EventEmitter();
    const elementUpdate = vi.fn();
    const afterUpdate = vi.fn();
    emitter.on('elementUpdate', elementUpdate);
    emitter.on('afterUpdate', afterUpdate);
    const runtime = makeRuntime({
      emitter,
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn },
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'zombie' },
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    const signal = fetchFn.mock.calls[0]?.[1]?.signal;
    runtime.destroy();
    expect(signal?.aborted).toBe(true);

    response.resolve(new Response(JSON.stringify({ id: '1', title: 'zombie merged' })));
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('h1')?.textContent).toBe('initial');
    expect(elementUpdate).not.toHaveBeenCalled();
    expect(afterUpdate).not.toHaveBeenCalled();
  });
  it('discards an abort-ignoring merge from an expired heartbeat generation', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">initial</h1>';
    const oldResponse = deferred<Response>();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '1', title: 'current merged' })));
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    const runtime = makeRuntime({
      emitter,
      heartbeatMs: 100,
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn },
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'expired raw' },
    });
    const oldSignal = fetchFn.mock.calls[0]?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(100);
    expect(oldSignal?.aborted).toBe(true);

    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'current raw' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('current merged');

    oldResponse.resolve(new Response(JSON.stringify({ id: '1', title: 'expired merged' })));
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('h1')?.textContent).toBe('current merged');
    expect(afterUpdate).toHaveBeenCalledOnce();
    expect(afterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { fields: { id: '1', title: 'current merged' }, collectionSlug: 'posts' },
        revision: 2,
      }),
    );
    runtime.destroy();
  });
  it('discards an older merge result even when fetch ignores its abort signal', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    const runtime = makeRuntime({
      emitter,
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'raw A' },
    });
    await Promise.resolve();
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'raw B' },
    });
    second.resolve(new Response(JSON.stringify({ id: '1', title: 'merged B' })));
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('merged B');

    first.resolve(new Response(JSON.stringify({ id: '1', title: 'merged A' })));
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('merged B');
    expect(afterUpdate).toHaveBeenCalledOnce();
    runtime.destroy();
  });
  it('renders the merged document instead of the raw form values', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '1', title: 'merged title' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const runtime = makeRuntime({
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'raw title' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(document.querySelector('h1')?.textContent).toBe('merged title');
    runtime.destroy();
  });
  it('falls back to raw values when the merge fetch fails', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('offline'));
    const runtime = makeRuntime({
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'raw title' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('raw title');
    runtime.destroy();
  });
  it('skips merging entirely for messages without slugs', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const fetchFn = vi.fn();
    const runtime = makeRuntime({
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'no slug' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(document.querySelector('h1')?.textContent).toBe('no slug');
    runtime.destroy();
  });
});
