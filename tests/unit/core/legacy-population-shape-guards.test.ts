/**
 * Direct callers can supply malformed names outside the validated wire schema.
 * Reject those shapes without coercion while preserving
 * valid plain records and independent editor values.
 */
import { describe, expect, it, vi } from 'vitest';
import { copyLegacyData, planLegacyPopulation } from '@core/legacy-population';
import { DataMerger } from '@core/data-merger';
import type { PayloadFieldSchema } from '@/types/payload-protocol';

const SERVER = 'https://cms.example.com';
const author: PayloadFieldSchema = { name: 'author', type: 'relationship', relationTo: 'authors' };
const plan = (data: Record<string, unknown>, schema: readonly PayloadFieldSchema[]) =>
  planLegacyPopulation(data, schema, SERVER, '/api', 1);

describe('legacy population — direct schema and structured-data shapes', () => {
  it('refuses boxed ownership names and collection targets instead of coercing them', async () => {
    const fields: readonly unknown[] = [
      { ...author, name: Object('author') as unknown },
      { ...author, relationTo: Object('authors') as unknown },
    ];
    for (const field of fields) {
      const raw = { author: 'A' };
      const schema = [field as PayloadFieldSchema];
      const fetchFn = vi.fn<typeof fetch>();
      const merger = new DataMerger({ serverURL: SERVER, fetchFn });
      try {
        expect(() => plan(raw, schema)).toThrow();
        expect(merger.canMerge({ schema, data: raw })).toBe(false);
        await expect(merger.merge({ schema, data: raw })).resolves.toEqual({
          status: 'unavailable',
        });
        expect(fetchFn).not.toHaveBeenCalled();
        expect(raw).toEqual({ author: 'A' });
      } finally {
        merger.destroy();
      }
    }
  });

  it('preserves a plain record whose length field exceeds an array work bound', async () => {
    const raw = { length: 10_001, title: 'Typed' };
    const copied = copyLegacyData(raw);
    expect(copied).toEqual(raw);
    expect(copied).not.toBe(raw);
    expect(plan(raw, [])).toEqual({ doc: raw, requests: [] });
    const fetchFn = vi.fn<typeof fetch>();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    const request = { schema: [], data: raw };
    try {
      expect(merger.canMerge(request)).toBe(true);
      const result = await merger.merge(request);
      expect(result).toEqual({ status: 'merged', doc: raw });
      if (result.status === 'merged') expect(result.doc).not.toBe(raw);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(raw).toEqual({ length: 10_001, title: 'Typed' });
    } finally {
      merger.destroy();
    }
  });

  it.each([null, undefined, ''])(
    'refuses an empty allowed-target declaration even when its selected value is cleared to %j',
    async (cleared) => {
      const raw = { author: cleared };
      const schema = [{ ...author, relationTo: [] }];
      const fetchFn = vi.fn<typeof fetch>();
      const merger = new DataMerger({ serverURL: SERVER, fetchFn });
      try {
        expect(() => plan(raw, schema)).toThrow();
        expect(merger.canMerge({ schema, data: raw })).toBe(false);
        await expect(merger.merge({ schema, data: raw })).resolves.toEqual({
          status: 'unavailable',
        });
        expect(fetchFn).not.toHaveBeenCalled();
        expect(raw).toEqual({ author: cleared });
      } finally {
        merger.destroy();
      }
    },
  );
});
