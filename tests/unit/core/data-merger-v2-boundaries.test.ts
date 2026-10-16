/**
 * Legacy plans must stop at the first boundary that accepts newer work.
 * Exercise real planners and native cancellation so an obsolete getter cannot cancel its successor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataMerger, type MergeRequest, type MergeResult } from '@core/data-merger';
import { parseFieldSchema } from '@schema/parser';
import { deferred, jsonResponse } from './data-merger-harness';

const SERVER = 'https://cms.example.com';
const schema = parseFieldSchema([{ name: 'author', type: 'relationship', relationTo: 'authors' }]);
const textSchema = parseFieldSchema([{ name: 'title', type: 'text' }]);
const request = (author = 'A'): MergeRequest => ({ schema, data: { author } });
const response = (id = 'C'): Response => jsonResponse({ docs: [{ id, name: `Name ${id}` }] });
const mergedC = { status: 'merged', doc: { author: { id: 'C', name: 'Name C' } } };
afterEach(() => vi.unstubAllGlobals());

describe('v2 merge boundary ownership', () => {
  it('leaves the accepted successor alone when abort reentry supersedes the waiting schema', async () => {
    const first = deferred<Response>();
    const last = deferred<Response>();
    let newer: Promise<MergeResult> | undefined;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((_url, init) => {
        init?.signal?.addEventListener('abort', () => {
          newer = merger.merge(request('C'));
        });
        return first.promise;
      })
      .mockImplementationOnce(() => last.promise);
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    let staleSchemaRead = false;
    const older = merger.merge(request());
    try {
      await expect(
        merger.merge({
          get schema() {
            staleSchemaRead = true;
            merger.destroy();
            return schema;
          },
          data: { author: 'B' },
        }),
      ).resolves.toEqual({ status: 'superseded' });
      expect(staleSchemaRead).toBe(false);
      expect(fetchFn.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
      last.resolve(response());
      await expect(newer).resolves.toEqual(mergedC);
      first.resolve(response('A'));
      await expect(older).resolves.toEqual({ status: 'superseded' });
    } finally {
      merger.destroy();
      first.resolve(response('A'));
      last.resolve(response());
      await Promise.all([older, newer]);
    }
  });

  it('cannot publish an obsolete scalar-only plan after its value getter accepts newer work', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response());
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    let newer: Promise<MergeResult> | undefined;
    try {
      await expect(
        merger.merge({
          schema: textSchema,
          data: {
            get title() {
              newer = merger.merge(request('C'));
              return 'Older';
            },
          },
        }),
      ).resolves.toEqual({ status: 'superseded' });
      await expect(newer).resolves.toEqual(mergedC);
    } finally {
      merger.destroy();
    }
  });

  it('merges a local scalar plan when no native fetch is available', async () => {
    vi.stubGlobal('fetch', undefined);
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, log });
    const data = { title: 'Local draft' };
    try {
      await expect(merger.merge({ schema: textSchema, data })).resolves.toEqual({
        status: 'merged',
        doc: data,
      });
      expect(log).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });

  it('treats a non-callable native fetch as unavailable without a transport exception', async () => {
    vi.stubGlobal('fetch', {});
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, log });
    try {
      await expect(merger.merge(request())).resolves.toEqual({ status: 'unavailable' });
      expect(log).not.toHaveBeenCalled();
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
      last.resolve(response());
      await expect(newer).resolves.toEqual(mergedC);
    } finally {
      merger.destroy();
      first.resolve(response('A'));
      last.resolve(response());
      await Promise.all([older, newer]);
    }
  });
  it.each([0, 1, 2, 3, 4])(
    'keeps body getters with their accepted attempt at completion handoff %s',
    async (turns) => {
      const body = deferred<unknown>();
      const readStarted = deferred<undefined>();
      const successorStarted = deferred<undefined>();
      const last = deferred<Response>();
      let newer: Promise<MergeResult> | undefined;
      let successorAccepted = false;
      let obsoleteDocsAccess = false;
      let currentDocsRead = false;
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce({
          ok: true,
          body: null,
          json() {
            readStarted.resolve(undefined);
            return body.promise;
          },
        } as Response)
        .mockImplementationOnce(() => last.promise);
      const merger = new DataMerger({ serverURL: SERVER, fetchFn });
      const older = merger.merge(request('A'));
      try {
        await readStarted.promise;
        void body.promise.then(() => {
          const accept = (remaining: number): void => {
            if (remaining > 0) queueMicrotask(() => accept(remaining - 1));
            else {
              successorAccepted = true;
              newer = merger.merge(request('C'));
              successorStarted.resolve(undefined);
            }
          };
          accept(turns);
        });
        body.resolve({
          get docs() {
            if (successorAccepted) {
              obsoleteDocsAccess = true;
              merger.destroy();
            } else currentDocsRead = true;
            return [{ id: 'A', name: 'Name A' }];
          },
        });
        const result = await older;
        await successorStarted.promise;
        expect(obsoleteDocsAccess).toBe(false);
        if (result.status === 'merged') {
          expect(currentDocsRead).toBe(true);
          expect(result.doc).toEqual({ author: { id: 'A', name: 'Name A' } });
        } else {
          expect(currentDocsRead).toBe(false);
          expect(result).toEqual({ status: 'superseded' });
        }
        expect(fetchFn.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
        last.resolve(response());
        await expect(newer).resolves.toEqual(mergedC);
      } finally {
        merger.destroy();
        last.resolve(response());
        await Promise.all([older, newer]);
      }
    },
  );
});
