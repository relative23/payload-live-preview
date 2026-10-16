/**
 * Shared legacy transport boundaries, independent of either rendering consumer.
 * These are unit-shaped adversarial inputs and response seams, not native wire claims.
 */
import { describe, expect, it, vi } from 'vitest';
import { DataMerger } from '@core/data-merger';
import { parseFieldSchema } from '@schema/parser';
import { populationURL } from '../../helpers/population';

const SERVER = 'https://cms.example.com';
const schema = parseFieldSchema([
  { name: 'title', type: 'text' },
  { name: 'author', type: 'relationship', relationTo: 'authors' },
]);
const response = (docs: unknown[], status = 200): Response =>
  new Response(JSON.stringify({ docs }), { status });
const request = (author: unknown = 'A') => ({
  schema,
  data: { author, title: 'Typed' },
});
describe('v2 read refusal and identity', () => {
  it.each([401, 403, 500])('refuses HTTP %s without a partial document', async (status) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response([], status));
    expect(await new DataMerger({ serverURL: SERVER, fetchFn }).merge(request())).toEqual({
      status: 'unavailable',
    });
  });
  it.each([
    { docs: [] },
    { docs: [{ id: 'B' }] },
    { docs: [{ name: 'No identity' }] },
    { docs: [{ id: 'A' }, { id: 'A' }] },
    { docs: [null] },
    { docs: [{ id: null }] },
  ])('refuses unresolved/foreign/duplicate malformed docs $docs', async ({ docs }) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response(docs));
    expect(await new DataMerger({ serverURL: SERVER, fetchFn }).merge(request())).toEqual({
      status: 'unavailable',
    });
  });
  it('refuses a partial multi-collection result without mutating raw input or response docs', async () => {
    const fields = parseFieldSchema([
      { name: 'author', type: 'relationship', relationTo: 'authors' },
      { name: 'asset', type: 'upload', relationTo: 'media' },
    ]);
    const data = { author: 'A', asset: 'M' };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([{ id: 'A', name: 'Ada' }]))
      .mockResolvedValueOnce(response([], 403));
    expect(
      await new DataMerger({ serverURL: SERVER, fetchFn }).merge({
        schema: fields,
        data,
      }),
    ).toEqual({ status: 'unavailable' });
    expect(data).toEqual({ author: 'A', asset: 'M' });
    expect(
      fetchFn.mock.calls.every(
        ([, init]) =>
          init?.method === 'GET' && init.redirect === 'error' && init.body === undefined,
      ),
    ).toBe(true);
  });
  it.each(['../writes', 'https://evil.example', 'foo/bar', 'foo%2fbar', '__proto__'])(
    'refuses unsafe collection %s before fetching',
    async (relationTo) => {
      const fetchFn = vi.fn<typeof fetch>();
      const merger = new DataMerger({ serverURL: SERVER, fetchFn });
      const input = {
        schema: parseFieldSchema([{ name: 'author', type: 'relationship', relationTo }]),
        data: { author: 'A' },
      };
      expect(merger.canMerge(input)).toBe(false);
      expect(await merger.merge(input)).toEqual({ status: 'unavailable' });
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );
  it('refuses a polymorphic collection outside the schema list', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const input = {
      schema: parseFieldSchema([{ name: 'author', type: 'relationship', relationTo: ['authors'] }]),
      data: { author: { relationTo: 'secrets', value: 'A' } },
    };
    expect(await new DataMerger({ serverURL: SERVER, fetchFn }).merge(input)).toEqual({
      status: 'unavailable',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('handles a throwing schema accessor as refusal for canMerge and merge', async () => {
    const input = {
      data: {},
      get schema(): never {
        throw new Error('host accessor');
      },
    };
    const merger = new DataMerger({ serverURL: SERVER });
    expect(merger.canMerge(input)).toBe(false);
    expect(await merger.merge(input)).toEqual({ status: 'unavailable' });
  });
});

describe('v2 batch and field shapes', () => {
  it('sets limit for eleven IDs and keys response identity independently of order', async () => {
    const ids = Array.from({ length: 11 }, (_, index) => String(index));
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([...ids].reverse().map((id) => ({ id, name: id }))));
    const fields = parseFieldSchema([
      {
        name: 'authors',
        type: 'relationship',
        relationTo: 'authors',
        hasMany: true,
      },
    ]);
    const result = await new DataMerger({ serverURL: SERVER, fetchFn }).merge({
      schema: fields,
      data: { authors: ids },
    });
    expect(result).toEqual({
      status: 'merged',
      doc: { authors: ids.map((id) => ({ id, name: id })) },
    });
    expect(populationURL(fetchFn.mock.calls[0]?.[0]).searchParams.get('limit')).toBe('11');
  });
  it('preserves ID zero and does not ask any API at depth zero', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    expect(
      await new DataMerger({ serverURL: SERVER, depth: 0, fetchFn }).merge(request(0)),
    ).toEqual({ status: 'merged', doc: { author: 0, title: 'Typed' } });
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('uses equals for a comma-bearing ID rather than select two documents', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([{ id: 'a,b', name: 'Comma' }]));
    expect(
      (await new DataMerger({ serverURL: SERVER, fetchFn }).merge(request('a,b'))).status,
    ).toBe('merged');
    const url = populationURL(fetchFn.mock.calls[0]?.[0]);
    expect(url.searchParams.get('where[id][equals]')).toBe('a,b');
    expect(url.searchParams.has('where[id][in]')).toBe(false);
  });
  it('places the same ID from two collections in their own monomorphic and polymorphic slots', async () => {
    const fields = parseFieldSchema([
      { name: 'author', type: 'relationship', relationTo: 'authors' },
      {
        name: 'media',
        type: 'upload',
        relationTo: ['media', 'authors'],
        hasMany: true,
      },
    ]);
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([{ id: 'A', name: 'Author' }]))
      .mockResolvedValueOnce(response([{ id: 'A', filename: 'image.jpg' }]));
    expect(
      await new DataMerger({ serverURL: SERVER, fetchFn }).merge({
        schema: fields,
        data: { author: 'A', media: [{ relationTo: 'media', value: 'A' }] },
      }),
    ).toEqual({
      status: 'merged',
      doc: {
        author: { id: 'A', name: 'Author' },
        media: [{ relationTo: 'media', value: { id: 'A', filename: 'image.jpg' } }],
      },
    });
  });
  it('walks group, named tab, reordered arrays and real v2 block records without mutating input', async () => {
    const relation = {
      name: 'author',
      type: 'relationship',
      relationTo: 'authors',
    };
    const fields = parseFieldSchema([
      { name: 'hero', type: 'tabs', fields: [relation] },
      { name: 'group', type: 'group', fields: [relation] },
      { name: 'rows', type: 'array', fields: [relation] },
      {
        name: 'layout',
        type: 'blocks',
        blocks: { byline: { fields: [relation] } },
      },
    ]);
    const data = {
      hero: { author: 'A' },
      group: { author: 'A' },
      rows: [
        { id: 'r2', author: 'B' },
        { id: 'r1', author: 'A' },
      ],
      layout: [{ id: 'b2', blockType: 'byline', author: 'B' }],
    };
    const before = JSON.stringify(data);
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response([{ id: 'A' }, { id: 'B' }]));
    const result = await new DataMerger({ serverURL: SERVER, fetchFn }).merge({
      schema: fields,
      data,
    });
    expect(result).toEqual({
      status: 'merged',
      doc: {
        hero: { author: { id: 'A' } },
        group: { author: { id: 'A' } },
        rows: [
          { id: 'r2', author: { id: 'B' } },
          { id: 'r1', author: { id: 'A' } },
        ],
        layout: [{ id: 'b2', blockType: 'byline', author: { id: 'B' } }],
      },
    });
    expect(JSON.stringify(data)).toBe(before);
    expect(fetchFn).toHaveBeenCalledOnce();
  });
  it.each([{ author: null }, { author: [] }])(
    'preserves clearing a reference $author',
    async ({ author }) => {
      const fields = parseFieldSchema([
        {
          name: 'author',
          type: 'relationship',
          relationTo: 'authors',
          hasMany: Array.isArray(author),
        },
      ]);
      const fetchFn = vi.fn<typeof fetch>();
      expect(
        await new DataMerger({ serverURL: SERVER, fetchFn }).merge({
          schema: fields,
          data: { author },
        }),
      ).toEqual({ status: 'merged', doc: { author } });
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );
});

describe('v2 attempt ownership', () => {
  it('drops an older result when fetch ignores abort and the newer result settles first', async () => {
    const resolve: ((value: Response) => void)[] = [];
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise<Response>((accept) => resolve.push(accept)));
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    const older = merger.merge(request('A'));
    const newer = merger.merge(request('B'));
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    resolve[1]?.(response([{ id: 'B' }]));
    expect(await newer).toEqual({
      status: 'merged',
      doc: { author: { id: 'B' }, title: 'Typed' },
    });
    resolve[0]?.(response([{ id: 'A' }]));
    expect(await older).toEqual({ status: 'superseded' });
  });
  it('refuses a reentrant merge during destroy and permits a clean later restart', async () => {
    let resolve: ((value: Response) => void) | undefined;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((accept) => {
            resolve = accept;
            init?.signal?.addEventListener('abort', () => {
              duringDestroy = merger.merge(request('B'));
            });
          }),
      )
      .mockResolvedValue(response([{ id: 'C' }]));
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    let duringDestroy: Promise<unknown> | undefined;
    const older = merger.merge(request('A'));
    merger.destroy();
    expect(await duringDestroy).toEqual({ status: 'superseded' });
    resolve?.(response([{ id: 'A' }]));
    expect(await older).toEqual({ status: 'superseded' });
    expect((await merger.merge(request('C'))).status).toBe('merged');
  });
  it('never reads an old body after a response ok getter accepts a newer merge', async () => {
    const json = vi.fn();
    let newer: Promise<unknown> | undefined;
    const old = {
      get ok() {
        newer = merger.merge(request('B'));
        return true;
      },
      json,
    } as unknown as Response;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(response([{ id: 'B' }]));
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    expect(await merger.merge(request('A'))).toEqual({ status: 'superseded' });
    expect(((await newer) as { status: string }).status).toBe('merged');
    expect(json).not.toHaveBeenCalled();
  });
  it('refuses an oversize native response rather than publish any requested slot', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([{ id: 'A', text: 'x'.repeat(1_048_577) }]));
    expect(await new DataMerger({ serverURL: SERVER, fetchFn }).merge(request())).toEqual({
      status: 'unavailable',
    });
  });
});
