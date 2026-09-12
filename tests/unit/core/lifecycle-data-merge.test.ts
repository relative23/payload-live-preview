import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { deferred, fireMessage, makeRuntime } from './lifecycle-startup-harness';

/**
 * Every page here reads a populated value. Without one the runtime answers the
 * message from the panel's own values and never asks the server (LP-3), and
 * these cases are about what happens when it does ask: the URL it builds, the
 * answer it keeps, and the answer it throws away.
 */
const POPULATED = '<span data-payload-field="venue.title"></span>';

describe('dataMerge option (Payload 3.x REST merging)', () => {
  it('preserves an explicit API route and zero population depth', async () => {
    document.body.innerHTML = `<h1 data-payload-field="title">old</h1>${POPULATED}`;
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
    document.body.innerHTML = `<h1 data-payload-field="title">initial</h1>${POPULATED}`;
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
    document.body.innerHTML = `<h1 data-payload-field="title">initial</h1>${POPULATED}`;
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
    document.body.innerHTML = `<h1 data-payload-field="title">initial</h1>${POPULATED}`;
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
    document.body.innerHTML = `<h1 data-payload-field="title">initial</h1>${POPULATED}`;
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
      // The venue moves with the title: a message that changes nothing the
      // server populates is answered without asking it (LP-3).
      data: { id: '1', title: 'expired raw', venue: 'venue-1' },
    });
    const oldSignal = fetchFn.mock.calls[0]?.[1]?.signal;
    await vi.advanceTimersByTimeAsync(100);
    expect(oldSignal?.aborted).toBe(true);

    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'current raw', venue: 'venue-2' },
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
    document.body.innerHTML = `<h1 data-payload-field="title">old</h1>${POPULATED}`;
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
      data: { id: '1', title: 'raw A', venue: 'venue-1' },
    });
    await Promise.resolve();
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'raw B', venue: 'venue-2' },
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
    document.body.innerHTML = `<h1 data-payload-field="title">old</h1>${POPULATED}`;
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
    document.body.innerHTML = `<h1 data-payload-field="title">old</h1>${POPULATED}`;
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
  it('does not ask the server for a document a Payload 2.x admin populates itself', async () => {
    // A 2.x admin posts `fieldSchemaJSON` and populated relationships; a
    // request would only fetch what the message already carries.
    document.body.innerHTML = `<h1 data-payload-field="title">old</h1>${POPULATED}`;
    const fetchFn = vi.fn();
    const runtime = makeRuntime({
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      fieldSchemaJSON: [],
      data: { id: '1', title: 'populated by the admin' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(document.querySelector('h1')?.textContent).toBe('populated by the admin');
    runtime.destroy();
  });

  it('logs a refinement that fails after the shared merge lands, and keeps the leading write', async () => {
    // Inside a burst the page renders the message's own values and the one
    // request the burst shares refines them when the window closes. Nothing
    // awaits that refinement, so a throw in it has the same boundary as the
    // leading path: logged, never an unhandled rejection.
    document.body.innerHTML = `<h1 data-payload-field="title">old</h1>${POPULATED}`;
    const log = vi.fn();
    const fetchFn = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ id: '1', title: 'merged' }))),
      );
    let armed = false;
    const hostile: Record<string, readonly string[]> = {};
    Object.defineProperty(hostile, 'title', {
      enumerable: true,
      get(): readonly string[] {
        if (armed) throw new Error('dependency map exploded');
        return [];
      },
    });
    const runtime = makeRuntime({
      log,
      debounceMs: 50,
      dependencies: hostile,
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'first' },
    });
    // The leading write lands in a frame, well inside the 50 ms window.
    await vi.advanceTimersByTimeAsync(20);
    expect(document.querySelector('h1')?.textContent).toBe('merged');
    // Still inside the window: a structure the server may complete makes this
    // message ask, and the request it gets is the shared one.
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'leading', tags: ['x'] },
    });
    await vi.advanceTimersByTimeAsync(20);
    // Inside the window the page keeps what the leading write put there; the
    // burst's own values and its shared request both land when it closes.
    expect(document.querySelector('h1')?.textContent).toBe('merged');
    expect(log.mock.calls.flat().join(' ')).not.toContain('update failed');

    armed = true;
    await vi.advanceTimersByTimeAsync(100);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.flat().join(' ')).toContain('update failed');
    // The burst's own values flushed; the refinement that would have replaced
    // them failed before it scheduled anything.
    expect(document.querySelector('h1')?.textContent).toBe('leading');
    runtime.destroy();
  });

  it('shows a drawer edit whose message the panel superseded before the answer landed', async () => {
    // Measured against Payload 3.88 (test run C, finding C1). Saving inside a
    // relationship drawer posts the same document event twice, back to back.
    // The first message is the one the event is news on, so it forces the
    // render and asks the server; the second is the repeat, so it forces
    // nothing and asks nothing — and it supersedes the first before the
    // answer arrives. Measured before the fix: three revisions accepted, one
    // superseded, two fetches, and every write on the page belonged to the
    // repeat, carrying the document from before the drawer was opened.
    document.body.innerHTML =
      '<h1 data-payload-field="title">old</h1><span data-payload-field="author.name">old name</span>';
    let name = 'Ada Lovelace';
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ title: 'Typed in the admin', author: { id: 1, name } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const runtime = makeRuntime({
      debounceMs: 50,
      skipUnchanged: true,
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn },
    });
    runtime.start();
    const post = (event?: Record<string, unknown>): void => {
      fireMessage({
        type: 'payload-live-preview',
        globalSlug: 'homepage',
        data: { title: 'Typed in the admin', author: 1 },
        ...(event === undefined ? {} : { externallyUpdatedRelationship: event }),
      });
    };

    post();
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('span')?.textContent).toBe('Ada Lovelace');

    name = 'Edited in a drawer';
    const drawerSave = { entitySlug: 'authors', operation: 'update', id: 1, updatedAt: 'noon' };
    post(drawerSave);
    post(drawerSave);
    await vi.advanceTimersByTimeAsync(200);

    expect(document.querySelector('span')?.textContent).toBe('Edited in a drawer');
    expect(runtime.inspect().revisions.superseded).toBe(1);
    runtime.destroy();
  });

  it('skips merging entirely for messages without slugs', async () => {
    document.body.innerHTML = `<h1 data-payload-field="title">old</h1>${POPULATED}`;
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
