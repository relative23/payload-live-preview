/**
 * Follow-up boundaries found by independent review: locale and live body teardown.
 * Rich-text targets mirror the published v2 traverser only inside schema-richText.
 * Array shape and enumerable payload values have separate bounds.
 */
import { describe, expect, it, vi } from 'vitest';
import { DataMerger } from '@core/data-merger';
import { parseFieldSchema } from '@schema/parser';
import { populationURL } from '../../helpers/population';
const schema = parseFieldSchema([{ name: 'author', type: 'relationship', relationTo: 'authors' }]);
const response = (id: string): Response => new Response(JSON.stringify({ docs: [{ id }] }));
const request = (id: string) => ({ schema, data: { author: id } });

function boundaryArray(enumerable: boolean): number[] {
  const items: number[] = [];
  for (let index = 0; index < 10_000; index += 1) {
    Object.defineProperty(items, index, {
      value: 0,
      enumerable,
      configurable: true,
      writable: true,
    });
  }
  return items;
}

describe('v2 independent review cases', () => {
  it('aborts the legacy read when the server denies it instead of leaving its body active', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('Access denied', { status: 403 }));
    expect(
      await new DataMerger({
        serverURL: 'https://cms.example.com',
        fetchFn,
      }).merge(request('A')),
    ).toEqual({ status: 'unavailable' });
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
  it('forwards an explicitly supplied locale in the relation GET', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response('A'));
    await new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn,
    }).merge({ ...request('A'), locale: 'de' });
    expect(populationURL(fetchFn.mock.calls[0]?.[0]).searchParams.get('locale')).toBe('de');
  });
  it('does not interpret a root/JSON relationTo-value pair as a collection request', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const fields = parseFieldSchema([
      { name: 'metadata', type: 'json' },
      { name: 'body', type: 'richText' },
    ]);
    const data = {
      relationTo: 'users',
      value: 'private',
      metadata: { relationTo: 'users', value: 'private' },
      body: [{ text: 'plain content' }],
    };
    expect(
      await new DataMerger({
        serverURL: 'https://cms.example.com',
        fetchFn,
      }).merge({ schema: fields, data }),
    ).toEqual({ status: 'merged', doc: data });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('recognizes an owned rich-text relationTo-value node as the published traverser does', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response('A'));
    const fields = parseFieldSchema([{ name: 'body', type: 'richText' }]);
    expect(
      await new DataMerger({
        serverURL: 'https://cms.example.com',
        fetchFn,
      }).merge({
        schema: fields,
        data: {
          body: [
            {
              type: 'relationship',
              relationTo: 'authors',
              value: 'A',
              children: [{ text: '' }],
            },
          ],
        },
      }),
    ).toEqual({
      status: 'merged',
      doc: {
        body: [
          {
            type: 'relationship',
            relationTo: 'authors',
            value: { id: 'A' },
            children: [{ text: '' }],
          },
        ],
      },
    });
  });
  it('refuses hostile rich-text collection names rather than request outside the CMS', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const fields = parseFieldSchema([{ name: 'body', type: 'richText' }]);
    expect(
      await new DataMerger({
        serverURL: 'https://cms.example.com',
        fetchFn,
      }).merge({
        schema: fields,
        data: { body: { relationTo: '../private', value: 'A' } },
      }),
    ).toEqual({ status: 'unavailable' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('refuses sparse/oversized relationship arrays before planning any request', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const fields = parseFieldSchema([
      {
        name: 'authors',
        type: 'relationship',
        relationTo: 'authors',
        hasMany: true,
      },
    ]);
    const input = { schema: fields, data: { authors: new Array(10_001) } };
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn,
    });
    expect(merger.canMerge(input)).toBe(false);
    expect(await merger.merge(input)).toEqual({ status: 'unavailable' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('populates a relationship beside dense array indices that are not enumerable', async () => {
    const items = boundaryArray(false);
    const input = {
      ...request('A'),
      collectionSlug: 'pages',
      data: { id: '1', author: 'A', items },
    };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response('A'));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
    try {
      expect(merger.canMerge(input)).toBe(true);
      expect(await merger.merge(input)).toMatchObject({
        status: 'merged',
        doc: { id: '1', author: { id: 'A' } },
      });
      expect(fetchFn).toHaveBeenCalledOnce();
      const [url, init] = fetchFn.mock.calls[0] ?? [];
      const target = populationURL(url);
      expect(target.origin + target.pathname).toBe('https://cms.example.com/api/authors');
      expect(target.searchParams.get('where[id][in]')).toBe('A');
      expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
      expect(init?.body).toBeUndefined();
      expect(items).toHaveLength(10_000);
      expect(Object.keys(items)).toEqual([]);
      expect(Object.hasOwn(items, 0)).toBe(true);
      expect(Object.hasOwn(items, 9_999)).toBe(true);
    } finally {
      merger.destroy();
    }
  });

  it('refuses the same dense length when enumerable values exceed the complete node budget', async () => {
    const items = boundaryArray(true);
    const input = {
      ...request('A'),
      collectionSlug: 'pages',
      data: { id: '1', author: 'A', items },
    };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response('A'));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
    try {
      expect(merger.canMerge(input)).toBe(false);
      expect(await merger.merge(input)).toEqual({ status: 'unavailable' });
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });

  it('does not acquire an old reader after the body getter starts a newer merge', async () => {
    const getReader = vi.fn();
    let newer: Promise<unknown> | undefined;
    const old = {
      ok: true,
      get body() {
        newer = merger.merge(request('B'));
        return { getReader };
      },
    } as unknown as Response;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(response('B'));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn,
    });
    expect(await merger.merge(request('A'))).toEqual({ status: 'superseded' });
    await newer;
    expect(getReader).not.toHaveBeenCalled();
  });
  it('cancels without calling read when getReader starts a newer merge', async () => {
    const reader = {
      read: vi.fn().mockResolvedValue({ done: true }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    let newer: Promise<unknown> | undefined;
    const old = {
      ok: true,
      body: {
        getReader() {
          newer = merger.merge(request('B'));
          return reader;
        },
      },
    } as unknown as Response;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(response('B'));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn,
    });
    expect(await merger.merge(request('A'))).toEqual({ status: 'superseded' });
    await newer;
    expect(reader.read).not.toHaveBeenCalled();
    expect(reader.cancel).toHaveBeenCalledOnce();
  });
  it('ends a pending old read chain when fetch/reader ignore the abort signal', async () => {
    let finishRead: ((value: { done: boolean }) => void) | undefined;
    const reader = {
      read: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finishRead = resolve;
          }),
      ),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const old = {
      ok: true,
      body: { getReader: () => reader },
    } as unknown as Response;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(response('B'));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn,
    });
    const older = merger.merge(request('A'));
    try {
      await vi.waitFor(() => expect(reader.read).toHaveBeenCalledOnce());
      expect((await merger.merge(request('B'))).status).toBe('merged');
      expect(reader.cancel).toHaveBeenCalledOnce();
      expect(await older).toEqual({ status: 'superseded' });
      expect(reader.read).toHaveBeenCalledOnce();
    } finally {
      finishRead?.({ done: true });
      await older;
    }
  });
});
