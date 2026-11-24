/**
 * A request target and response belong to the attempt that accepted them.
 * Refusal paths must preserve that ownership even when successful accessors start newer work.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataMerger, type MergeRequest, type MergeResult } from '@core/data-merger';
import { deferred, jsonResponse } from './data-merger-harness';

const SERVER = 'https://cms.example.com';
const request = (id = 'A'): MergeRequest => ({ collectionSlug: 'posts', data: { id } });
const mergedC = { status: 'merged', doc: { id: 'C', title: 'Newest' } };
afterEach(() => vi.unstubAllGlobals());

describe('v3 merge boundary ownership', () => {
  it('returns superseded when native fetch selection accepts newer work before returning no transport', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(mergedC.doc));
    const merger = new DataMerger({ serverURL: SERVER });
    let newer: Promise<MergeResult> | undefined;
    let accepted = false;
    vi.stubGlobal('fetch', undefined);
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      get() {
        if (accepted) return fetchFn;
        accepted = true;
        newer = merger.merge(request('C'));
        return undefined;
      },
    });
    try {
      await expect(merger.merge(request())).resolves.toEqual({ status: 'superseded' });
      await expect(newer).resolves.toEqual(mergedC);
      expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([`${SERVER}/api/posts/C`]);
    } finally {
      merger.destroy();
    }
  });

  it('does not read a late obsolete response whose getter could cancel the accepted successor', async () => {
    const first = deferred<Response>();
    const last = deferred<Response>();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => last.promise);
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    let staleResponseRead = false;
    const older = merger.merge(request());
    const newer = merger.merge(request('C'));
    try {
      first.resolve({
        get ok() {
          staleResponseRead = true;
          merger.destroy();
          return true;
        },
      } as Response);
      await expect(older).resolves.toEqual({ status: 'superseded' });
      expect(staleResponseRead).toBe(false);
      expect(fetchFn.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
      last.resolve(jsonResponse(mergedC.doc));
      await expect(newer).resolves.toEqual(mergedC);
    } finally {
      merger.destroy();
      first.resolve(jsonResponse({ id: 'A' }));
      last.resolve(jsonResponse(mergedC.doc));
      await Promise.all([older, newer]);
    }
  });

  it('does not read an obsolete refusal status after its ok getter accepts the successor', async () => {
    const last = deferred<Response>();
    let newer: Promise<MergeResult> | undefined;
    let staleStatusRead = false;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        get ok() {
          newer = merger.merge(request('C'));
          return false;
        },
        get status() {
          staleStatusRead = true;
          merger.destroy();
          return 403;
        },
      } as Response)
      .mockImplementationOnce(() => last.promise);
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    try {
      await expect(merger.merge(request())).resolves.toEqual({ status: 'superseded' });
      expect(staleStatusRead).toBe(false);
      expect(fetchFn.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
      last.resolve(jsonResponse(mergedC.doc));
      await expect(newer).resolves.toEqual(mergedC);
    } finally {
      merger.destroy();
      last.resolve(jsonResponse(mergedC.doc));
      await newer;
    }
  });

  it('aborts a merge request the server refuses, instead of leaving its unread body open', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('Access denied', { status: 403 }));
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
    try {
      await expect(merger.merge(request())).resolves.toEqual({ status: 'unavailable' });
      expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(log).toHaveBeenCalledExactlyOnceWith('merge HTTP', 403, `${SERVER}/api/posts/A`);
    } finally {
      merger.destroy();
    }
  });

  it('keeps a newer request that the abort of a refused one accepts', async () => {
    // The abort runs listeners, and a listener may start the next merge: the
    // refused attempt is obsolete then and reports nothing.
    let newer: Promise<MergeResult> | undefined;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((_url, init) => {
        init?.signal?.addEventListener('abort', () => {
          newer = merger.merge(request('C'));
        });
        return Promise.resolve(new Response('Access denied', { status: 403 }));
      })
      .mockResolvedValueOnce(jsonResponse(mergedC.doc));
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
    try {
      await expect(merger.merge(request())).resolves.toEqual({ status: 'superseded' });
      await expect(newer).resolves.toEqual(mergedC);
      expect(fetchFn.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
      expect(log).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });

  it('does not abort a refused attempt again after its status getter accepted a newer merge', async () => {
    // The newer merge aborted the obsolete controller already; a second abort
    // from the attempt it replaced must never reach a listener.
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    let merger: DataMerger | undefined;
    let newer: Promise<MergeResult> | undefined;
    try {
      const older = {
        ok: false,
        get status() {
          newer = merger?.merge(request('C'));
          return 503;
        },
      } as unknown as Response;
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(older)
        .mockResolvedValueOnce(jsonResponse(mergedC.doc));
      merger = new DataMerger({ serverURL: SERVER, fetchFn });
      await expect(merger.merge(request())).resolves.toEqual({ status: 'superseded' });
      expect(abort).toHaveBeenCalledTimes(1);
      await expect(newer).resolves.toEqual(mergedC);
    } finally {
      merger?.destroy();
      abort.mockRestore();
    }
  });
});
