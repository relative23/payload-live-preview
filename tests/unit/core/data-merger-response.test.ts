/**
 * HTTP success is not enough to replace a document. These cases bind explicit
 * response identities to the dispatched target. Projected documents remain
 * compatible, including an errors-only record a Payload global may return.
 */
import { describe, expect, it, vi } from 'vitest';
import { DataMerger, type MergeRequest } from '@core/data-merger';
import { deferred, jsonResponse } from './data-merger-harness';

const SERVER = 'https://cms.example.com';
const POST: MergeRequest = { collectionSlug: 'posts', data: { id: '42' } };
const GLOBAL: MergeRequest = { globalSlug: 'homepage', data: {} };

describe('DataMerger response identity', () => {
  it.each([
    ['a different collection document', POST, { id: '43', title: 'Wrong document' }],
    ['a null collection identity', POST, { id: null, title: 'Wrong document' }],
    ['a compound collection identity', POST, { id: ['42'], title: 'Wrong document' }],
    ['a boolean collection identity', POST, { id: true }],
    ['a different global', GLOBAL, { globalType: 'settings', title: 'Wrong global' }],
    ['a null global identity', GLOBAL, { globalType: null }],
    ['a numeric global identity', GLOBAL, { globalType: 42 }],
    [
      'a numeric identity for a numeric-looking global slug',
      { globalSlug: '42', data: {} },
      { globalType: 42 },
    ],
  ] as const)('refuses HTTP 200 carrying %s', async (_name, request, doc) => {
    const log = vi.fn();
    const merger = new DataMerger({
      serverURL: SERVER,
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(doc)),
      log,
    });

    await expect(merger.merge(request)).resolves.toEqual({ status: 'unavailable' });
    expect(log.mock.calls.flat()).not.toContain(doc);
    expect(log).toHaveBeenCalledWith('merge invalid', expect.any(String));
  });

  it.each([
    ['a projected errors-only collection field', POST, { errors: [{ message: 'Content' }] }],
    ['an errors-only global field', GLOBAL, { errors: [{ message: 'Content' }] }],
    ['a matching collection ID', POST, { id: '42', title: 'Typed' }],
    ['the numeric form of the same REST ID', POST, { id: 42, title: 'Typed' }],
    ['a matching global', GLOBAL, { globalType: 'homepage', title: 'Typed' }],
    ['a projected collection document', POST, { title: 'Typed' }],
    ['a projected global document', GLOBAL, { title: 'Typed' }],
    ['a collection field named errors', POST, { id: '42', errors: [{ message: 'Content' }] }],
    ['a global field named errors', GLOBAL, { globalType: 'homepage', errors: ['Content'] }],
    ['an empty projected errors field', POST, { errors: [] }],
    ['a projected scalar errors field', GLOBAL, { errors: 'Content' }],
    ['an unrelated global field in a collection', POST, { id: '42', globalType: 'Content' }],
    ['a global document with its own database ID', GLOBAL, { id: 'unrelated-global-id' }],
  ] as const)('preserves %s', async (_name, request, doc) => {
    const merger = new DataMerger({
      serverURL: SERVER,
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(doc)),
    });

    await expect(merger.merge(request)).resolves.toEqual({ status: 'merged', doc });
  });

  it('captures the dispatched target before mutable request data changes', async () => {
    const response = deferred<Response>();
    const fetchFn = vi.fn<typeof fetch>().mockReturnValue(response.promise);
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    const request = { collectionSlug: 'posts', data: { id: '42' } };
    const pending = merger.merge(request);
    request.data.id = '43';
    response.resolve(jsonResponse({ id: '43', title: 'A different document' }));

    await expect(pending).resolves.toEqual({ status: 'unavailable' });
    expect(fetchFn.mock.calls[0]?.[0]).toBe(`${SERVER}/api/posts/42`);
  });

  it('does not commit a response getter that starts a newer merge', async () => {
    const newer = deferred<Response>();
    let reentrant: Promise<unknown> | undefined;
    const doc = {
      get id(): string {
        reentrant = merger.merge(POST);
        return '42';
      },
    };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(doc) } as Response)
      .mockReturnValueOnce(newer.promise);
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });

    await expect(merger.merge(POST)).resolves.toEqual({ status: 'superseded' });
    newer.resolve(jsonResponse({ id: '42', title: 'Newest' }));
    await expect(reentrant).resolves.toEqual({
      status: 'merged',
      doc: { id: '42', title: 'Newest' },
    });
  });
});
