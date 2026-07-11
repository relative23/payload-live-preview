/**
 * DataMerger — REST-based server-side merging (Payload 3.x strategy).
 */
import { describe, expect, it, vi } from 'vitest';
import { DataMerger } from '@core/data-merger';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('DataMerger.canMerge', () => {
  const merger = new DataMerger({ serverURL: 'https://cms.example.com' });

  it('accepts globals by slug alone', () => {
    expect(merger.canMerge({ globalSlug: 'homepage', data: {} })).toBe(true);
  });

  it('accepts collections only when the form values carry an id', () => {
    expect(merger.canMerge({ collectionSlug: 'posts', data: { id: '42' } })).toBe(true);
    expect(merger.canMerge({ collectionSlug: 'posts', data: { id: 42 } })).toBe(true);
    expect(merger.canMerge({ collectionSlug: 'posts', data: {} })).toBe(false);
  });

  it('rejects messages without any slug', () => {
    expect(merger.canMerge({ data: { id: '42' } })).toBe(false);
  });
});

describe('DataMerger.merge', () => {
  it('replicates the official request shape for collections', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ title: 'merged' }));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com/',
      fetchFn: fetchFn,
    });
    const result = await merger.merge({
      collectionSlug: 'posts',
      data: { id: '42', title: 'raw' },
      locale: 'de',
    });
    expect(result).toEqual({ status: 'merged', doc: { title: 'merged' } });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cms.example.com/api/posts/42');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-Payload-HTTP-Method-Override']).toBe('GET');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['data']).toEqual({ id: '42', title: 'raw' });
    expect(body['depth']).toBe(1);
    expect(body['flattenLocales']).toBe(false);
    expect(body['locale']).toBe('de');
  });

  it('targets the globals endpoint for globals', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      apiRoute: 'api', // missing leading slash is normalised
      depth: 2,
      fetchFn: fetchFn,
    });
    await merger.merge({ globalSlug: 'homepage', data: {} });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cms.example.com/api/globals/homepage');
    expect(JSON.parse(init.body as string)).toMatchObject({ depth: 2 });
  });

  it('returns unavailable on HTTP errors so callers fall back to raw values', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn: fetchFn,
    });
    const result = await merger.merge({ globalSlug: 'homepage', data: {} });
    expect(result).toEqual({ status: 'unavailable' });
  });

  it('returns unavailable on network errors', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('network down'));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn: fetchFn,
    });
    const result = await merger.merge({ globalSlug: 'homepage', data: {} });
    expect(result).toEqual({ status: 'unavailable' });
  });

  it('returns unavailable for non-object response bodies', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([1, 2, 3]));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn: fetchFn,
    });
    const result = await merger.merge({ globalSlug: 'homepage', data: {} });
    expect(result).toEqual({ status: 'unavailable' });
  });

  it('aborts the in-flight request when a newer merge starts', async () => {
    let firstSignal: AbortSignal | undefined;
    const fetchFn = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        firstSignal = init.signal!;
        return new Promise((_resolve, reject) => {
          (init.signal!).addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      })
      .mockResolvedValueOnce(jsonResponse({ title: 'second' }));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn: fetchFn,
    });

    const first = merger.merge({ globalSlug: 'homepage', data: { title: 'a' } });
    const second = merger.merge({ globalSlug: 'homepage', data: { title: 'b' } });

    expect(await first).toEqual({ status: 'superseded' });
    expect(firstSignal?.aborted).toBe(true);
    expect(await second).toEqual({ status: 'merged', doc: { title: 'second' } });
  });

  it('destroy aborts any in-flight request', async () => {
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          (init.signal!).addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn: fetchFn,
    });
    const pending = merger.merge({ globalSlug: 'homepage', data: {} });
    merger.destroy();
    expect(await pending).toEqual({ status: 'superseded' });
  });
});
