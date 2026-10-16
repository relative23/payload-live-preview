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
});
