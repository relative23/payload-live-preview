/**
 * Configured HTTP origins and dotted API-prefix segments remain valid alongside
 * the planner's destination checks. Preserve their path and selected identities
 * rather than rejecting safe configurations while tightening unsafe ones.
 */
import { describe, expect, it, vi } from 'vitest';
import { planLegacyPopulation } from '@core/legacy-population';
import { DataMerger } from '@core/data-merger';
import type { PayloadFieldSchema } from '@/types/payload-protocol';

const author: PayloadFieldSchema = { name: 'author', type: 'relationship', relationTo: 'authors' };

function checkDestination(serverURL: string, apiRoute: string): void {
  const planned = planLegacyPopulation({ author: 'A' }, [author], serverURL, apiRoute, 1);
  expect(planned.requests).toHaveLength(1);
  const url = new URL(planned.requests[0]?.url ?? '');
  expect(url.origin).toBe(serverURL);
  expect(url.pathname).toBe(`${apiRoute}/authors`);
  expect(url.searchParams.get('where[id][in]')).toBe('A');
  expect(url.searchParams.get('limit')).toBe('1');
  expect(planned.requests[0]?.ids).toEqual(new Set(['A']));
  expect(planned.doc).toEqual({ author: 'A' });
}

describe('legacy population — configured URL compatibility', () => {
  it.each(['http://cms.example.com', 'https://cms.example.com'])(
    'preserves the configured %s origin and query identity',
    (serverURL) => {
      checkDestination(serverURL, '/api');
    },
  );

  it.each(['/cms.v2/api', '/cms..v2/api'])(
    'keeps the dotted API-prefix segment in %s without treating it as a dot segment',
    (apiRoute) => {
      checkDestination('https://cms.example.com', apiRoute);
    },
  );

  it('requires a prefix in direct plans while preserving the normalized root API route', async () => {
    const serverURL = 'https://cms.example.com';
    const raw = { author: 'A' };
    expect(() => planLegacyPopulation(raw, [author], serverURL, '', 1)).toThrow(
      /invalid or oversized legacy population/u,
    );
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ docs: [{ id: 'A', name: 'Ada' }] })));
    const merger = new DataMerger({ serverURL, apiRoute: '', fetchFn });
    try {
      expect(merger.canMerge({ data: raw, schema: [author] })).toBe(true);
      await expect(merger.merge({ data: raw, schema: [author] })).resolves.toEqual({
        status: 'merged',
        doc: { author: { id: 'A', name: 'Ada' } },
      });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      const sent = fetchFn.mock.calls[0]?.[0];
      expect(typeof sent).toBe('string');
      const url = new URL(sent as string);
      expect(url.origin).toBe(serverURL);
      expect(url.pathname).toBe('/authors');
      expect(url.searchParams.get('depth')).toBe('1');
      expect(url.searchParams.get('limit')).toBe('1');
      expect(url.searchParams.get('where[id][in]')).toBe('A');
      expect(raw).toEqual({ author: 'A' });
    } finally {
      merger.destroy();
    }
  });
});
