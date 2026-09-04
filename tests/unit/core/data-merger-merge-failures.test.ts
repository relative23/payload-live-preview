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
});
