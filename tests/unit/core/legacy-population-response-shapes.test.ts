/**
 * A legacy answer needs a plain envelope and plain document records even when
 * an injected json-only response retains named array properties. Refusal keeps
 * the editor document and every planned population slot unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { fillLegacyPopulation, planLegacyPopulation } from '@core/legacy-population';
import { DataMerger } from '@core/data-merger';
import type { PayloadFieldSchema } from '@/types/payload-protocol';

const SERVER = 'https://cms.example.com';
const author: PayloadFieldSchema = { name: 'author', type: 'relationship', relationTo: 'authors' };
const malformed = [
  {
    name: 'an array envelope carrying its own docs',
    body: () => Object.assign([] as unknown[], { docs: [{ id: 'A', name: 'Ada' }] }),
  },
  {
    name: 'an array document carrying its own matching identity',
    body: () => ({ docs: [Object.assign([] as unknown[], { id: 'A', name: 'Ada' })] }),
  },
];
const jsonOnly = (body: unknown): Response =>
  ({ ok: true, body: null, json: () => Promise.resolve(body) }) as Response;

describe('legacy population — plain response ownership', () => {
  it.each(malformed)('refuses $name before filling any planned slot', ({ body }) => {
    const raw = { author: 'A', title: 'Typed' };
    const result = planLegacyPopulation(raw, [author], SERVER, '/api', 1);
    const request = result.requests[0];
    if (request === undefined) throw new Error('expected a pending author request');
    expect(() => fillLegacyPopulation(request, body())).toThrow();
    expect(result.doc).toEqual({ author: 'A', title: 'Typed' });
    expect(raw).toEqual({ author: 'A', title: 'Typed' });
  });

  it.each(malformed)('refuses $name returned by a json-only fetch caller', async ({ body }) => {
    const raw = { author: 'A', title: 'Typed' };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonOnly(body()));
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    try {
      await expect(merger.merge({ data: raw, schema: [author] })).resolves.toEqual({
        status: 'unavailable',
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [, init] = fetchFn.mock.calls[0] ?? [];
      expect(init?.method).toBe('GET');
      expect(init?.credentials).toBe('include');
      expect(init?.redirect).toBe('error');
      expect(raw).toEqual({ author: 'A', title: 'Typed' });
    } finally {
      merger.destroy();
    }
  });

  it('accepts a plain json-only envelope and retains independent populated values', async () => {
    const raw = { author: 'A', title: 'Typed' };
    const body = { docs: [{ id: 'A', name: 'Ada' }] };
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonOnly(body));
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    try {
      const result = await merger.merge({ data: raw, schema: [author] });
      expect(result).toEqual({
        status: 'merged',
        doc: { author: { id: 'A', name: 'Ada' }, title: 'Typed' },
      });
      body.docs[0]!.name = 'Retained response changed';
      expect(result).toEqual({
        status: 'merged',
        doc: { author: { id: 'A', name: 'Ada' }, title: 'Typed' },
      });
      expect(raw).toEqual({ author: 'A', title: 'Typed' });
    } finally {
      merger.destroy();
    }
  });
});
