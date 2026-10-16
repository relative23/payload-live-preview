/**
 * Diagnostics describe current failures without cancelling unrelated accepted work.
 * An unclassified request retains its original exception, and obsolete failures stay silent.
 */
import { describe, expect, it, vi } from 'vitest';
import { DataMerger, type MergeRequest, type MergeResult } from '@core/data-merger';
import { deferred, jsonResponse } from './data-merger-harness';

const SERVER = 'https://cms.example.com';
const request = (id = 'A'): MergeRequest => ({ collectionSlug: 'posts', data: { id } });
const mergedC = { status: 'merged', doc: { id: 'C', title: 'Newest' } };

describe('merge diagnostic ownership', () => {
  it('reports the original schema-access exception before choosing a merge protocol', async () => {
    const error = new Error('schema unavailable');
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(mergedC.doc));
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
    try {
      await expect(
        merger.merge({
          get schema(): MergeRequest['schema'] {
            throw error;
          },
          data: {},
        }),
      ).resolves.toEqual({ status: 'unavailable' });
      expect(log.mock.calls).toEqual([['merge exception', error]]);
      expect(fetchFn).not.toHaveBeenCalled();
      await expect(merger.merge(request('C'))).resolves.toEqual(mergedC);
    } finally {
      merger.destroy();
    }
  });

  it('does not diagnose an obsolete v3 fetch rejection after accepting a newer request', async () => {
    const first = deferred<Response>();
    const error = new Error('old transport failure');
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => first.promise.then(() => Promise.reject(error)))
      .mockResolvedValueOnce(jsonResponse(mergedC.doc));
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
    const older = merger.merge(request());
    try {
      await expect(merger.merge(request('C'))).resolves.toEqual(mergedC);
      first.resolve(jsonResponse({ id: 'A' }));
      await expect(older).resolves.toEqual({ status: 'superseded' });
      expect(log).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
      first.resolve(jsonResponse({ id: 'A' }));
      await older;
    }
  });

  it('reports a current v3 failure without triggering an unsolicited abort callback', async () => {
    const error = new Error('current transport failure');
    let newer: Promise<MergeResult> | undefined;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((_url, init) => {
        init?.signal?.addEventListener('abort', () => {
          newer = merger.merge(request('C'));
        });
        return Promise.reject(error);
      })
      .mockResolvedValueOnce(jsonResponse(mergedC.doc));
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
    try {
      await expect(merger.merge(request())).resolves.toEqual({ status: 'unavailable' });
      expect(newer).toBeUndefined();
      expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
      expect(log.mock.calls).toEqual([['merge exception', error]]);
      await expect(merger.merge(request('C'))).resolves.toEqual(mergedC);
    } finally {
      merger.destroy();
      await newer;
    }
  });
});

describe('v3 refusal diagnostic reentry', () => {
  it.each([
    ['http', 'replace'],
    ['http', 'destroy'],
    ['invalid shape', 'replace'],
    ['invalid shape', 'destroy'],
    ['wrong identity', 'replace'],
    ['wrong identity', 'destroy'],
  ] as const)(
    'drops the obsolete %s verdict after its logger chooses %s',
    async (fault, action) => {
      const refused =
        fault === 'http'
          ? jsonResponse({}, 403)
          : jsonResponse(fault === 'invalid shape' ? null : { id: 'different' });
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(refused)
        .mockResolvedValueOnce(jsonResponse(mergedC.doc));
      let newer: Promise<MergeResult> | undefined;
      const log = vi.fn(() => {
        if (action === 'replace') newer = merger.merge(request('C'));
        else merger.destroy();
      });
      const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
      try {
        const older = await merger.merge(request());
        if (action === 'replace') await expect(newer).resolves.toEqual(mergedC);
        expect(older).toEqual({ status: 'superseded' });
      } finally {
        merger.destroy();
        await newer;
      }
    },
  );
});
