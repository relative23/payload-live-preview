/**
 * Draft-aware preview fetching for initial page loads.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchPreviewDocument, fetchPreviewGlobal } from '@/preview-fetch';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchPreviewDocument', () => {
  it('fetches by id with draft=true and depth by default', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ id: '1', title: 'Draft' }));
    const doc = await fetchPreviewDocument({
      serverURL: 'https://cms.example.com/',
      collection: 'pages',
      id: '1',
      fetchFn: fetchFn as typeof fetch,
    });
    expect(doc).toEqual({ id: '1', title: 'Draft' });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://cms.example.com');
    expect(parsed.pathname).toBe('/api/pages/1');
    expect(parsed.searchParams.get('draft')).toBe('true');
    expect(parsed.searchParams.get('depth')).toBe('1');
    expect(init.credentials).toBe('include');
  });

  it('fetches the first match of a where clause', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ docs: [{ slug: 'about', title: 'About' }] }));
    const doc = await fetchPreviewDocument({
      serverURL: 'https://cms.example.com',
      collection: 'pages',
      where: { slug: { equals: 'about' } },
      locale: 'de',
      depth: 2,
      fetchFn: fetchFn as typeof fetch,
    });
    expect(doc).toEqual({ slug: 'about', title: 'About' });
    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/api/pages');
    expect(url.searchParams.get('where[slug][equals]')).toBe('about');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('locale')).toBe('de');
    expect(url.searchParams.get('depth')).toBe('2');
  });

  it('returns null when no document matches', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ docs: [] }));
    const doc = await fetchPreviewDocument({
      serverURL: 'https://cms.example.com',
      collection: 'pages',
      where: { slug: { equals: 'missing' } },
      fetchFn: fetchFn as typeof fetch,
    });
    expect(doc).toBeNull();
  });

  it('omits draft when draft: false (published fallback for normal traffic)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ id: '1' }));
    await fetchPreviewDocument({
      serverURL: 'https://cms.example.com',
      collection: 'pages',
      id: '1',
      draft: false,
      fetchFn: fetchFn as typeof fetch,
    });
    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.searchParams.has('draft')).toBe(false);
  });

  it('passes auth headers through', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ id: '1' }));
    await fetchPreviewDocument({
      serverURL: 'https://cms.example.com',
      collection: 'pages',
      id: '1',
      headers: { Authorization: 'users API-Key secret' },
      fetchFn: fetchFn as typeof fetch,
    });
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('users API-Key secret');
  });

  it('returns null on HTTP errors and network failures', async () => {
    const failing = vi.fn().mockResolvedValue(jsonResponse({}, 403));
    expect(
      await fetchPreviewDocument({
        serverURL: 'https://cms.example.com',
        collection: 'pages',
        id: '1',
        fetchFn: failing as typeof fetch,
      }),
    ).toBeNull();

    const throwing = vi.fn().mockRejectedValue(new TypeError('offline'));
    expect(
      await fetchPreviewDocument({
        serverURL: 'https://cms.example.com',
        collection: 'pages',
        id: '1',
        fetchFn: throwing as typeof fetch,
      }),
    ).toBeNull();
  });
});

describe('fetchPreviewGlobal', () => {
  it('targets the globals endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ heroTitle: 'Hi' }));
    const doc = await fetchPreviewGlobal({
      serverURL: 'https://cms.example.com',
      global: 'homepage',
      fetchFn: fetchFn as typeof fetch,
    });
    expect(doc).toEqual({ heroTitle: 'Hi' });
    const url = new URL(fetchFn.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/api/globals/homepage');
    expect(url.searchParams.get('draft')).toBe('true');
  });
});
