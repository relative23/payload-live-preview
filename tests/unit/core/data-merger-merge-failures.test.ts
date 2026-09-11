import { describe, expect, it, vi } from 'vitest';
import { DataMerger } from '@core/data-merger';
import { deferred, jsonResponse } from './data-merger-harness';

describe('DataMerger.merge — failure paths', () => {
  it('rejects a merge started by destroy abort listeners but remains reusable afterwards', async () => {
    const firstResponse = deferred<Response>();
    const context: { merger?: DataMerger } = {};
    let reentrant!: Promise<Awaited<ReturnType<DataMerger['merge']>>>;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((_url, init) => {
        if (init?.signal === undefined || init.signal === null) {
          throw new Error('expected an AbortSignal');
        }
        init.signal.addEventListener('abort', () => {
          if (context.merger === undefined) {
            throw new Error('expected the merger to be initialized');
          }
          context.merger.destroy();
          reentrant = context.merger.merge({
            globalSlug: 'homepage',
            data: { title: 'reentrant' },
          });
        });
        return firstResponse.promise;
      })
      .mockResolvedValueOnce(jsonResponse({ title: 'after-destroy' }));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
    context.merger = merger;
    const first = merger.merge({ globalSlug: 'homepage', data: { title: 'first' } });

    merger.destroy();

    expect(fetchFn).toHaveBeenCalledOnce();
    await expect(reentrant).resolves.toEqual({ status: 'superseded' });
    firstResponse.resolve(jsonResponse({ title: 'first' }));
    await expect(first).resolves.toEqual({ status: 'superseded' });

    await expect(
      merger.merge({ globalSlug: 'homepage', data: { title: 'after-destroy' } }),
    ).resolves.toEqual({ status: 'merged', doc: { title: 'after-destroy' } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it('supersedes an in-flight request even when the newer request is not mergeable', async () => {
    let firstSignal: AbortSignal | undefined;
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          firstSignal = init.signal ?? undefined;
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn: fetchFn,
    });
    const first = merger.merge({ globalSlug: 'homepage', data: { title: 'old' } });
    const second = merger.merge({ data: { title: 'new' } });

    expect(await second).toEqual({ status: 'unavailable' });
    expect(firstSignal?.aborted).toBe(true);
    expect(await first).toEqual({ status: 'superseded' });
  });
  it('discards a response when fetch ignores an intervening abort', async () => {
    const oldResponse = deferred<Response>();
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ title: 'new' }));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn: fetchFn });

    const oldMerge = merger.merge({ globalSlug: 'homepage', data: { title: 'old' } });
    const newMerge = merger.merge({ globalSlug: 'homepage', data: { title: 'new' } });
    expect(await newMerge).toEqual({ status: 'merged', doc: { title: 'new' } });

    oldResponse.resolve(jsonResponse({ title: 'old' }));
    await expect(oldMerge).resolves.toEqual({ status: 'superseded' });
  });
  it('discards parsed JSON when response.json ignores an intervening abort', async () => {
    const oldBody = deferred<unknown>();
    const oldResponse = {
      ok: true,
      status: 200,
      json: () => oldBody.promise,
    } as Response;
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(oldResponse)
      .mockResolvedValueOnce(jsonResponse({ title: 'new' }));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn: fetchFn });

    const oldMerge = merger.merge({ globalSlug: 'homepage', data: { title: 'old' } });
    await Promise.resolve();
    const newMerge = merger.merge({ globalSlug: 'homepage', data: { title: 'new' } });
    expect(await newMerge).toEqual({ status: 'merged', doc: { title: 'new' } });

    oldBody.resolve({ title: 'old' });
    await expect(oldMerge).resolves.toEqual({ status: 'superseded' });
  });
  it('does not deliver a response from before a stop after the restart', async () => {
    // A stop/start cycle sits between two merges, and the older response
    // arrives through a fetch shim that ignored its abort signal. Only the
    // attempt counter tells the two apart, so it has to move one way.
    const oldResponse = deferred<Response>();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ title: 'after-restart' }));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });

    const before = merger.merge({ globalSlug: 'homepage', data: { title: 'before' } });
    merger.destroy();
    const after = merger.merge({ globalSlug: 'homepage', data: { title: 'after' } });
    oldResponse.resolve(jsonResponse({ title: 'before' }));

    await expect(before).resolves.toEqual({ status: 'superseded' });
    await expect(after).resolves.toEqual({ status: 'merged', doc: { title: 'after-restart' } });
  });
  it('stays superseded when its late response is an HTTP error, rather than reporting it', async () => {
    const oldResponse = deferred<Response>();
    const log = vi.fn();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ title: 'new' }));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn, log });

    const oldMerge = merger.merge({ globalSlug: 'homepage', data: { title: 'old' } });
    await expect(merger.merge({ globalSlug: 'homepage', data: { title: 'new' } })).resolves.toEqual(
      { status: 'merged', doc: { title: 'new' } },
    );
    oldResponse.resolve(jsonResponse({}, 500));

    await expect(oldMerge).resolves.toEqual({ status: 'superseded' });
    expect(log).not.toHaveBeenCalled();
  });
  it('leaves a completed request alone when the next merge starts', async () => {
    // A merge aborts its predecessor. Once the predecessor completed there is
    // nothing to abort, and an abort listener a fetch shim left on its signal
    // must not fire for it.
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      if (init?.signal === undefined || init.signal === null) {
        throw new Error('expected an AbortSignal');
      }
      signals.push(init.signal);
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });

    await merger.merge({ globalSlug: 'homepage', data: { title: 'first' } });
    await merger.merge({ globalSlug: 'homepage', data: { title: 'second' } });

    expect(signals.map((signal) => signal.aborted)).toEqual([false, false]);
  });
  it('keeps aborting the request in flight after a stale response has left', async () => {
    // A superseded attempt returning must not forget its successor's
    // controller, or the merge after that could no longer abort it.
    const first = deferred<Response>();
    const second = deferred<Response>();
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      if (init?.signal === undefined || init.signal === null) {
        throw new Error('expected an AbortSignal');
      }
      signals.push(init.signal);
      if (signals.length === 1) return first.promise;
      if (signals.length === 2) return second.promise;
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });

    const stale = merger.merge({ globalSlug: 'homepage', data: { title: 'stale' } });
    const inFlight = merger.merge({ globalSlug: 'homepage', data: { title: 'in-flight' } });
    first.resolve(jsonResponse({ title: 'stale' }));
    await expect(stale).resolves.toEqual({ status: 'superseded' });
    const newest = merger.merge({ globalSlug: 'homepage', data: { title: 'newest' } });

    expect(signals.map((signal) => signal.aborted)).toEqual([true, true, false]);
    second.resolve(jsonResponse({ title: 'in-flight' }));
    await expect(inFlight).resolves.toEqual({ status: 'superseded' });
    await expect(newest).resolves.toEqual({ status: 'merged', doc: { ok: true } });
  });
});
