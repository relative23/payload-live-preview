/**
 * A malformed legacy plan must stop before reading avoidable editor values or
 * sending credentialed requests. Valid records, printable identities and
 * selected block definitions still populate through the same caller.
 */
import { describe, expect, it, vi } from 'vitest';
import { copyLegacyData, planLegacyPopulation } from '@core/legacy-population';
import { DataMerger } from '@core/data-merger';
import { parseFieldSchema } from '@schema/parser';
import type { PayloadFieldSchema } from '@/types/payload-protocol';
import { populationURL } from '../../helpers/population';

const SERVER = 'https://cms.example.com';
const author: PayloadFieldSchema = { name: 'author', type: 'relationship', relationTo: 'authors' };
const plan = (data: Record<string, unknown>, schema: readonly PayloadFieldSchema[]) =>
  planLegacyPopulation(data, schema, SERVER, '/api', 1);

function cyclicRecord() {
  const data: Record<string, unknown> = {};
  let entered = false;
  let revisited = false;
  Object.defineProperty(data, 'self', {
    enumerable: true,
    get: () => {
      if (entered) revisited = true;
      entered = true;
      return data;
    },
  });
  return { data, revisited: () => revisited };
}

function cyclicSchema() {
  const schema: PayloadFieldSchema[] = [];
  let entered = false;
  let revisited = false;
  Object.defineProperty(schema, Symbol.iterator, {
    value: () => {
      if (entered) revisited = true;
      entered = true;
      return schema.values();
    },
  });
  schema.push({ name: 'layout', type: 'row', fields: schema });
  return { schema, revisited: () => revisited };
}

describe('legacy population — early rejection boundaries', () => {
  it('refuses an array document even when no field requests population', async () => {
    const raw = [] as unknown as Record<string, unknown>;
    const fetchFn = vi.fn<typeof fetch>();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    try {
      expect(() => plan(raw, [])).toThrow();
      expect(merger.canMerge({ data: raw, schema: [] })).toBe(false);
      await expect(merger.merge({ data: raw, schema: [] })).resolves.toEqual({
        status: 'unavailable',
      });
      await expect(merger.merge({ data: {}, schema: [] })).resolves.toEqual({
        status: 'merged',
        doc: {},
      });
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });

  it('refuses an oversized dense array before evaluating its editor values', async () => {
    const values: unknown[] = [];
    let evaluated = false;
    for (let index = 0; index < 10_001; index += 1) {
      Object.defineProperty(values, index, {
        enumerable: true,
        get: () => {
          evaluated = true;
          return null;
        },
      });
    }
    const raw = { values };
    const fetchFn = vi.fn<typeof fetch>();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    try {
      expect(() => copyLegacyData(raw)).toThrow();
      expect(merger.canMerge({ data: raw, schema: [] })).toBe(false);
      await expect(merger.merge({ data: raw, schema: [] })).resolves.toEqual({
        status: 'unavailable',
      });
      expect(evaluated).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });

  it('refuses an active document cycle without resolving the same property again', async () => {
    const direct = cyclicRecord();
    expect(() => copyLegacyData(direct.data)).toThrow();
    expect(direct.revisited()).toBe(false);
    const fetchFn = vi.fn<typeof fetch>();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    const candidate = cyclicRecord();
    const active = cyclicRecord();
    try {
      expect(merger.canMerge({ data: candidate.data, schema: [] })).toBe(false);
      expect(candidate.revisited()).toBe(false);
      await expect(merger.merge({ data: active.data, schema: [] })).resolves.toEqual({
        status: 'unavailable',
      });
      expect(active.revisited()).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });

  it('refuses an active schema cycle before entering its field sequence again', async () => {
    const direct = cyclicSchema();
    expect(() => plan({ title: 'Typed' }, direct.schema)).toThrow();
    expect(direct.revisited()).toBe(false);
    const fetchFn = vi.fn<typeof fetch>();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    const candidate = cyclicSchema();
    const active = cyclicSchema();
    try {
      expect(merger.canMerge({ data: { title: 'Typed' }, schema: candidate.schema })).toBe(false);
      expect(candidate.revisited()).toBe(false);
      await expect(
        merger.merge({ data: { title: 'Typed' }, schema: active.schema }),
      ).resolves.toEqual({ status: 'unavailable' });
      expect(active.revisited()).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });

  it('allows an acyclic field sequence reused by separate transparent containers', () => {
    const fields = [author];
    const schema: PayloadFieldSchema[] = [
      { name: 'first', type: 'row', fields },
      { name: 'second', type: 'collapsible', fields },
    ];
    const result = plan({ author: 'A' }, schema);
    expect(result.doc).toEqual({ author: 'A' });
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.ids).toEqual(new Set(['A']));
  });

  it.each(['Draft author!', 'Stryker was here!', 'literal spaces'])(
    'populates the nonempty printable identity %j instead of treating it as cleared',
    async (id) => {
      const raw = { author: id, title: 'Typed' };
      const fetchFn = vi.fn<typeof fetch>((input, init) => {
        const url = populationURL(input);
        expect(url.pathname).toBe('/api/authors');
        expect(url.searchParams.get('where[id][in]')).toBe(id);
        expect(init?.method).toBe('GET');
        expect(init?.credentials).toBe('include');
        expect(init?.redirect).toBe('error');
        return Promise.resolve(new Response(JSON.stringify({ docs: [{ id, name: 'Ada' }] })));
      });
      const merger = new DataMerger({ serverURL: SERVER, fetchFn });
      try {
        await expect(merger.merge({ data: raw, schema: [author] })).resolves.toEqual({
          status: 'merged',
          doc: { author: { id, name: 'Ada' }, title: 'Typed' },
        });
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(raw).toEqual({ author: id, title: 'Typed' });
      } finally {
        merger.destroy();
      }
    },
  );

  it('uses the selected parsed block definition alongside neutral container fields', async () => {
    const schema = parseFieldSchema([
      {
        name: 'layout',
        type: 'blocks',
        fields: [{ name: 'title', type: 'text' }],
        blocks: [{ slug: 'quote', fields: [author] }],
      },
    ]);
    const raw = { layout: [{ blockType: 'quote', author: 'A', title: 'Typed' }] };
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ docs: [{ id: 'A', name: 'Ada' }] })));
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    try {
      await expect(merger.merge({ data: raw, schema })).resolves.toEqual({
        status: 'merged',
        doc: { layout: [{ blockType: 'quote', author: { id: 'A', name: 'Ada' }, title: 'Typed' }] },
      });
      const [input, init] = fetchFn.mock.calls[0] ?? [];
      expect(populationURL(input).pathname).toBe('/api/authors');
      expect(init?.method).toBe('GET');
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(raw).toEqual({ layout: [{ blockType: 'quote', author: 'A', title: 'Typed' }] });
    } finally {
      merger.destroy();
    }
  });
});
