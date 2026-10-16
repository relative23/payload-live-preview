/**
 * Transport safety: a schema-owned legacy read must never reach a v3 POST.
 * Malformed shape, response identity and cancellation stay atomic.
 */
import { describe, expect, it, vi } from 'vitest';
import { DataMerger } from '@core/data-merger';
import { parseFieldSchema } from '@schema/parser';
import { populationURL } from '../../helpers/population';

const schema = parseFieldSchema([
  { name: 'title', type: 'text' },
  {
    name: 'author',
    type: 'relationship',
    relationTo: 'authors',
    hasMany: false,
  },
]);
const response = (docs: unknown[]): Response => new Response(JSON.stringify({ docs }));
describe('DataMerger — schema-owned Payload 2 transport', () => {
  it('merges local scalar values without a v3 target or fetch', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn,
    });
    expect(await merger.merge({ schema, data: { title: 'Unsaved', author: null } })).toEqual({
      status: 'merged',
      doc: { title: 'Unsaved', author: null },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never uses v3 POST even if a custom sender also supplies a global slug', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response([{ id: 'A', name: 'Ada' }]));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn,
    });
    const result = await merger.merge({
      schema,
      globalSlug: 'homepage',
      data: { author: 'A', title: 'Unsaved' },
    });
    expect(fetchFn.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(result).toEqual({
      status: 'merged',
      doc: { author: { id: 'A', name: 'Ada' }, title: 'Unsaved' },
    });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(populationURL(url).pathname).toBe('/api/authors');
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
  });
});

// Payload 2's form-state sender emits exact numeric 0 for empty arrays and blocks.
// These inputs reconstruct that source contract; they are not captured browser packets.
const emptyContainers = [
  {
    name: 'tags',
    field: { name: 'tags', type: 'array', fields: [{ name: 'label', type: 'text' }] },
  },
  {
    name: 'layout',
    field: {
      name: 'layout',
      type: 'blocks',
      blocks: [{ slug: 'quote', fields: [{ name: 'label', type: 'text' }] }],
    },
  },
] as const;

describe('DataMerger — Payload 2 empty-container form sentinel', () => {
  it.each(emptyContainers)(
    'merges schema-owned $name:0 as an empty array without a relationship read',
    async ({ name, field }) => {
      const fields = parseFieldSchema([...schema, field]);
      const raw = { title: 'Unsaved fixture title', author: null, [name]: 0 };
      const before = JSON.stringify(raw);
      const fetchFn = vi.fn<typeof fetch>();
      const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
      try {
        const result = await merger.merge({ schema: fields, data: raw });
        expect(result).toEqual({
          status: 'merged',
          doc: { title: 'Unsaved fixture title', author: null, [name]: [] },
        });
        expect(merger.canMerge({ schema: fields, data: raw })).toBe(true);
        expect(fetchFn).not.toHaveBeenCalled();
        expect(JSON.stringify(raw)).toBe(before);
        if (result.status === 'merged') expect(result.doc).not.toBe(raw);
      } finally {
        merger.destroy();
      }
    },
  );

  it.each(emptyContainers)(
    'populates only author by one GET beside schema-owned $name:0',
    async ({ name, field }) => {
      const fields = parseFieldSchema([...schema, field]);
      const raw = { title: 'Unsaved fixture title', author: 'A', [name]: 0 };
      const before = JSON.stringify(raw);
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response([{ id: 'A', name: 'Ada' }]));
      const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
      try {
        const result = await merger.merge({ schema: fields, data: raw });
        expect(fetchFn).toHaveBeenCalledOnce();
        expect(result).toEqual({
          status: 'merged',
          doc: { title: 'Unsaved fixture title', author: { id: 'A', name: 'Ada' }, [name]: [] },
        });
        const [input, init] = fetchFn.mock.calls[0] ?? [];
        const url = populationURL(input);
        expect(url.origin).toBe('https://cms.example.com');
        expect(url.pathname).toBe('/api/authors');
        expect(Object.fromEntries(url.searchParams)).toEqual({
          depth: '1',
          limit: '1',
          'where[id][in]': 'A',
        });
        expect(init?.method).toBe('GET');
        expect(init?.credentials).toBe('include');
        expect(init?.redirect).toBe('error');
        expect(init?.body).toBeUndefined();
        expect(new Headers(init?.headers).has('X-Payload-HTTP-Method-Override')).toBe(false);
        expect(JSON.stringify(raw)).toBe(before);
      } finally {
        merger.destroy();
      }
    },
  );

  it.each(emptyContainers)(
    'refuses other invalid $name shapes atomically before any author GET',
    async ({ name, field }) => {
      const fields = parseFieldSchema([...schema, field]);
      const fetchFn = vi.fn<typeof fetch>();
      const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
      try {
        for (const value of [1, -1, '0', false, {}, [0], [null], ['A']]) {
          const raw = { title: 'Unsaved fixture title', author: 'A', [name]: value };
          const before = JSON.stringify(raw);
          expect(merger.canMerge({ schema: fields, data: raw })).toBe(false);
          expect(await merger.merge({ schema: fields, data: raw })).toEqual({
            status: 'unavailable',
          });
          expect(fetchFn).not.toHaveBeenCalled();
          expect(JSON.stringify(raw)).toBe(before);
        }
      } finally {
        merger.destroy();
      }
    },
  );

  it('keeps scalar, opaque and relationship-ID zero distinct from the container sentinel', async () => {
    const fields = parseFieldSchema([
      ...schema,
      { name: 'count', type: 'number' },
      { name: 'metadata', type: 'json' },
    ]);
    const raw = { title: 'Unsaved fixture title', count: 0, metadata: 0, unowned: 0, author: 0 };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response([{ id: 0, name: 'Zero ID' }]));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
    try {
      expect(await merger.merge({ schema: fields, data: raw })).toEqual({
        status: 'merged',
        doc: { ...raw, author: { id: 0, name: 'Zero ID' } },
      });
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(populationURL(fetchFn.mock.calls[0]?.[0]).searchParams.get('where[id][in]')).toBe('0');
      expect(raw.author).toBe(0);
      fetchFn.mockClear();
      for (const type of ['group', 'tabs', 'relationship'] as const) {
        const rejecting = parseFieldSchema([
          { name: 'value', type, fields: [], relationTo: 'authors', hasMany: true },
        ]);
        expect(await merger.merge({ schema: rejecting, data: { value: 0 } })).toEqual({
          status: 'unavailable',
        });
        expect(fetchFn).not.toHaveBeenCalled();
      }
    } finally {
      merger.destroy();
    }
  });
});
