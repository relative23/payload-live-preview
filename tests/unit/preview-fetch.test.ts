/**
 * Draft-aware preview fetching for initial page loads.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchPreviewDocument, fetchPreviewGlobal } from '@/preview-fetch';
import { authorizePreviewRequest } from '@security/preview-authorization';

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

describe('authorization option (1.1.0)', () => {
  async function context(payloadHeaders: Record<string, string>) {
    const result = await authorizePreviewRequest(new Request('https://site.example.com/'), {
      type: 'verifier',
      verify: () => ({ payloadHeaders }),
    });
    if (!result.authorized) throw new Error('expected authorization');
    return result.context;
  }
  function capture() {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
      return Promise.resolve(jsonResponse({ docs: [{ id: 1 }] }));
    });
    return { calls, fetchFn: fetchFn as unknown as typeof fetch };
  }

  it('reads the draft and forwards the context headers when authorized', async () => {
    const { calls, fetchFn } = capture();
    await fetchPreviewDocument({
      serverURL: 'https://cms.example.com',
      collection: 'pages',
      authorization: await context({ cookie: 'payload-token=abc' }),
      fetchFn,
    });
    expect(calls[0]?.url).toContain('draft=true');
    expect(calls[0]?.headers['cookie']).toBe('payload-token=abc');
  });

  it('reads the published document and forwards nothing for null, whatever draft says', async () => {
    const { calls, fetchFn } = capture();
    await fetchPreviewGlobal({
      serverURL: 'https://cms.example.com',
      global: 'homepage',
      authorization: null,
      draft: true,
      headers: { 'x-app': 'kept' },
      fetchFn,
    });
    expect(calls[0]?.url).not.toContain('draft=true');
    expect(calls[0]?.headers['cookie']).toBeUndefined();
    expect(calls[0]?.headers['x-app']).toBe('kept');
  });

  it('treats a look-alike context as public', async () => {
    const { calls, fetchFn } = capture();
    const real = await context({ cookie: 'payload-token=abc' });
    await fetchPreviewDocument({
      serverURL: 'https://cms.example.com',
      collection: 'pages',
      authorization: { ...real },
      fetchFn,
    });
    expect(calls[0]?.url).not.toContain('draft=true');
    expect(calls[0]?.headers['cookie']).toBeUndefined();
  });

  it('keeps the 1.x default (draft) when no authorization is given', async () => {
    const { calls, fetchFn } = capture();
    await fetchPreviewDocument({
      serverURL: 'https://cms.example.com',
      collection: 'pages',
      fetchFn,
    });
    expect(calls[0]?.url).toContain('draft=true');
  });
});
