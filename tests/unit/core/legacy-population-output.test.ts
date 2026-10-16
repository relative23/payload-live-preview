/**
 * A collection answer must account for every requested identity before any slot
 * is filled. Complete output checks cover repeated and cross-collection slots,
 * and retained response objects cannot later change the resolved editor data.
 */
import { describe, expect, it, vi } from 'vitest';
import { fillLegacyPopulation, planLegacyPopulation } from '@core/legacy-population';
import { DataMerger } from '@core/data-merger';
import type { PayloadFieldSchema } from '@/types/payload-protocol';
import { populationURL } from '../../helpers/population';

const SERVER = 'https://cms.example.com';
const field: PayloadFieldSchema = {
  name: 'authors',
  type: 'relationship',
  relationTo: 'authors',
  hasMany: true,
};

function pendingPlan() {
  return planLegacyPopulation({ authors: ['A', 'B'], title: 'Typed' }, [field], SERVER, '/api', 1);
}

describe('legacy population — complete response identity and independent output', () => {
  it.each([
    null,
    [],
    'body',
    0,
    {},
    { docs: null },
    { docs: {} },
    { docs: 0 },
    { docs: [] },
    { docs: [{ id: 'A' }] },
    { docs: [{ id: 'A' }, { id: 'C' }] },
    { docs: [{ id: 'A' }, { id: 'A' }] },
    { docs: [{ id: 'A' }, null] },
    { docs: [{ id: 'A' }, []] },
    { docs: [{ id: 'A' }, 0] },
    { docs: [{ id: 'A' }, {}] },
    { docs: [{ id: 'A' }, { id: null }] },
    { docs: [{ id: 'A' }, { id: true }] },
    { docs: [{ id: 'A' }, { id: {} }] },
  ])('refuses malformed or incomplete body %j without changing any planned slot', (body) => {
    const plan = pendingPlan();
    const request = plan.requests[0];
    if (request === undefined) throw new Error('expected a pending population request');
    expect(() => fillLegacyPopulation(request, body)).toThrow();
    expect(plan.doc).toEqual({ authors: ['A', 'B'], title: 'Typed' });
  });

  it('fills repeated slots from a complete reordered response and preserves its independent source', () => {
    const raw = { authors: ['A', 'B', 'A'], title: 'Typed' };
    const plan = planLegacyPopulation(raw, [field], SERVER, '/api', 1);
    const request = plan.requests[0];
    if (request === undefined) throw new Error('expected a pending population request');
    const body = {
      docs: [
        { id: 'B', name: 'Babbage' },
        { id: 'A', name: 'Ada' },
      ],
    };
    fillLegacyPopulation(request, body);
    expect(plan.doc).toEqual({
      authors: [
        { id: 'A', name: 'Ada' },
        { id: 'B', name: 'Babbage' },
        { id: 'A', name: 'Ada' },
      ],
      title: 'Typed',
    });
    expect(raw).toEqual({ authors: ['A', 'B', 'A'], title: 'Typed' });
    expect(plan.doc['authors']).not.toBe(raw.authors);
    const retained = body.docs[1];
    if (retained === undefined) throw new Error('expected the retained A response');
    retained.name = 'Changed response';
    body.docs.push({ id: 'C', name: 'Later response' });
    expect(plan.doc['authors']).toEqual([
      { id: 'A', name: 'Ada' },
      { id: 'B', name: 'Babbage' },
      { id: 'A', name: 'Ada' },
    ]);
  });

  it('accepts numeric 0 as the same REST identity while preserving the returned value', () => {
    const raw = { author: 0 };
    const plan = planLegacyPopulation(
      raw,
      [{ name: 'author', type: 'relationship', relationTo: 'authors' }],
      SERVER,
      '/api',
      1,
    );
    const request = plan.requests[0];
    if (request === undefined) throw new Error('expected a numeric-id request');
    expect(request.ids).toEqual(new Set(['0']));
    fillLegacyPopulation(request, { docs: [{ id: 0, name: 'Zero' }] });
    expect(plan.doc).toEqual({ author: { id: 0, name: 'Zero' } });
    expect(raw).toEqual({ author: 0 });
  });

  it('fills an entire two-chunk caller document and does not alias either retained response', async () => {
    const ids = Array.from({ length: 21 }, (_, index) => `id${index}`);
    const raw = { authors: [...ids, ids[0]], title: 'Typed' };
    const bodies: { docs: { id: string; name: string }[] }[] = [];
    const fetchFn = vi.fn<typeof fetch>((input, init) => {
      const url = populationURL(input);
      expect(init?.method).toBe('GET');
      expect(init?.credentials).toBe('include');
      expect(init?.redirect).toBe('error');
      expect(init?.body).toBeUndefined();
      const requested = url.searchParams.get('where[id][in]')?.split(',') ?? [];
      expect(url.pathname).toBe('/api/authors');
      expect(url.searchParams.get('limit')).toBe(String(requested.length));
      const body = {
        docs: requested
          .slice()
          .reverse()
          .map((id) => ({ id, name: `Ada ${id}` })),
      };
      bodies.push(body);
      return Promise.resolve({
        ok: true,
        body: null,
        json: () => Promise.resolve(body),
      } as Response);
    });
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    const result = await merger.merge({ data: raw, schema: [field] });
    const expected = {
      authors: [...ids, ids[0]].map((id) => ({ id, name: `Ada ${id}` })),
      title: 'Typed',
    };
    expect(result).toEqual({ status: 'merged', doc: expected });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(bodies.map((body) => body.docs.length)).toEqual([20, 1]);
    expect(raw).toEqual({ authors: [...ids, ids[0]], title: 'Typed' });
    for (const body of bodies) {
      for (const doc of body.docs) doc.name = 'Changed retained response';
    }
    expect(result).toEqual({ status: 'merged', doc: expected });
  });

  it('keeps the same raw ID isolated across collections and preserves comma-ID output', async () => {
    const schema: PayloadFieldSchema[] = [
      { name: 'author', type: 'relationship', relationTo: 'authors' },
      { name: 'media', type: 'upload', relationTo: 'media' },
      { name: 'selected', type: 'relationship', relationTo: ['authors', 'media'] },
    ];
    const raw = {
      author: 'same,A',
      media: 'same,A',
      selected: { relationTo: 'media', value: 'same,A' },
      title: 'Typed',
    };
    const fetchFn = vi.fn<typeof fetch>((input) => {
      const url = populationURL(input);
      expect(url.searchParams.get('where[id][equals]')).toBe('same,A');
      expect(url.searchParams.has('where[id][in]')).toBe(false);
      const collection = url.pathname.split('/').at(-1);
      return Promise.resolve(
        new Response(JSON.stringify({ docs: [{ id: 'same,A', name: `${collection}:same,A` }] })),
      );
    });
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    await expect(merger.merge({ data: raw, schema })).resolves.toEqual({
      status: 'merged',
      doc: {
        author: { id: 'same,A', name: 'authors:same,A' },
        media: { id: 'same,A', name: 'media:same,A' },
        selected: { relationTo: 'media', value: { id: 'same,A', name: 'media:same,A' } },
        title: 'Typed',
      },
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(raw).toEqual({
      author: 'same,A',
      media: 'same,A',
      selected: { relationTo: 'media', value: 'same,A' },
      title: 'Typed',
    });
  });
});
