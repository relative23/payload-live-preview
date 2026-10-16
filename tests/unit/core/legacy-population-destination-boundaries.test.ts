/**
 * A legacy request must parse as a valid destination before an injected fetch
 * receives it. Base URL parsing alone does not validate the concatenated path.
 */
import { describe, expect, it, vi } from 'vitest';
import { DataMerger } from '@core/data-merger';
import type { PayloadFieldSchema } from '@/types/payload-protocol';

const author: PayloadFieldSchema = { name: 'author', type: 'relationship', relationTo: 'authors' };
const request = { data: { author: 'A', title: 'Typed' }, schema: [author] };
const response = () => new Response(JSON.stringify({ docs: [{ id: 'A', name: 'Ada' }] }));

describe('legacy population — destination parsing', () => {
  it('refuses an invalid concatenated URL before calling an injected fetch', async () => {
    const serverURL = 'https://cms.example.com ';
    expect(new URL(serverURL).origin).toBe('https://cms.example.com');
    expect(() => new URL(`${serverURL}/api/authors`)).toThrow();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response());
    const merger = new DataMerger({ serverURL, fetchFn });
    try {
      const possible = merger.canMerge(request);
      const result = await merger.merge(request);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(possible).toBe(false);
      expect(result).toEqual({ status: 'unavailable' });
      expect(request.data).toEqual({ author: 'A', title: 'Typed' });
    } finally {
      merger.destroy();
    }
  });

  it('keeps normalized route and trailing slash compatibility for a valid destination', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response());
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com///',
      apiRoute: 'cms.v2/api/',
      fetchFn,
    });
    try {
      expect(merger.canMerge(request)).toBe(true);
      await expect(merger.merge(request)).resolves.toEqual({
        status: 'merged',
        doc: { author: { id: 'A', name: 'Ada' }, title: 'Typed' },
      });
      const [url, init] = fetchFn.mock.calls[0] ?? [];
      if (typeof url !== 'string') throw new Error('expected a string population URL');
      expect(new URL(url).pathname).toBe('/cms.v2/api/authors');
      expect(init).toMatchObject({ method: 'GET', credentials: 'include', redirect: 'error' });
      expect(request.data).toEqual({ author: 'A', title: 'Typed' });
    } finally {
      merger.destroy();
    }
  });
});
