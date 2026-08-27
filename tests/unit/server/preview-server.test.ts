import { describe, expect, it, vi } from 'vitest';
import {
  PreviewFetchError,
  authorizePreviewRequest,
  definePreview,
  type PreviewFetchDiagnostic,
  type PreviewFetchFunction,
} from '@/server/index';

/**
 * The server subpath's read contract (roadmap 1.2.0): one depth for fetch
 * and merge, an explicit authorization verdict as the draft decision, and a
 * failure that is a typed result — or a typed error, when asked.
 */

const CMS = 'https://cms.example.com';

async function context(headers: Record<string, string> = { cookie: 'payload-token=abc' }) {
  const result = await authorizePreviewRequest(new Request('https://site.example.com/'), {
    type: 'verifier',
    verify: () => ({ payloadHeaders: headers }),
  });
  if (!result.authorized) throw new Error('expected authorization');
  return result.context;
}

function capture(body: unknown = { docs: [{ id: 1 }] }, status = 200) {
  const calls: { url: string; headers: Record<string, string>; signal: AbortSignal }[] = [];
  const fetch: PreviewFetchFunction = (url, init) => {
    calls.push({ url, headers: init.headers, signal: init.signal });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  };
  return { calls, fetch };
}

describe('definePreview — configuration', () => {
  it('binds origin, route and depth once and hands the runtime the same depth', () => {
    const preview = definePreview({ serverURL: `${CMS}/`, apiRoute: 'api', depth: 2 });
    expect(preview.config).toEqual({ serverURL: CMS, apiRoute: '/api', depth: 2, timeoutMs: 5000 });
    expect(preview.runtimeOptions).toEqual({ serverURL: CMS, apiRoute: '/api', mergeDepth: 2 });
    expect(Object.isFrozen(preview.runtimeOptions)).toBe(true);
  });

  it('refuses a relative origin, a non-http scheme and a negative depth', () => {
    expect(() => definePreview({ serverURL: 'cms.example.com', depth: 1 })).toThrow(/absolute URL/);
    expect(() => definePreview({ serverURL: 'ftp://cms.example.com', depth: 1 })).toThrow(/http/);
    expect(() => definePreview({ serverURL: CMS, depth: -1 })).toThrow(/depth/);
    expect(() => definePreview({ serverURL: CMS, depth: 1.5 })).toThrow(/depth/);
  });
});

describe('definePreview — reads', () => {
  it('reads the draft and forwards the context headers with a real context', async () => {
    const { calls, fetch } = capture();
    const preview = definePreview({ serverURL: CMS, depth: 2, fetch });
    const result = await preview.fetchDocument<{ id: number }>({
      collection: 'pages',
      where: { slug: { equals: 'about' } },
      locale: 'de',
      authorization: await context(),
    });
    expect(result).toEqual({ ok: true, data: { id: 1 }, draft: true, status: 200 });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/api/pages');
    expect(url.searchParams.get('draft')).toBe('true');
    expect(url.searchParams.get('depth')).toBe('2');
    expect(url.searchParams.get('locale')).toBe('de');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('where[slug][equals]')).toBe('about');
    expect(calls[0]?.headers['cookie']).toBe('payload-token=abc');
  });

  it('reads the published document and forwards nothing for null or a look-alike', async () => {
    const { calls, fetch } = capture({ title: 'home' });
    const preview = definePreview({ serverURL: CMS, depth: 0, fetch });
    const real = await context();
    for (const authorization of [null, { ...real }, JSON.parse(JSON.stringify(real))]) {
      const result = await preview.fetchGlobal({
        global: 'homepage',
        authorization: authorization as typeof real | null,
        headers: { 'x-app': 'kept' },
      });
      expect(result).toEqual({ ok: true, data: { title: 'home' }, draft: false, status: 200 });
    }
    for (const call of calls) {
      expect(call.url).toBe(`${CMS}/api/globals/homepage?depth=0`);
      expect(call.headers['cookie']).toBeUndefined();
      expect(call.headers['x-app']).toBe('kept');
    }
  });

  it('lets the context headers win over per-read headers', async () => {
    const { calls, fetch } = capture();
    const preview = definePreview({ serverURL: CMS, depth: 1, fetch });
    await preview.fetchDocument({
      collection: 'pages',
      authorization: await context({ cookie: 'payload-token=real' }),
      headers: { cookie: 'payload-token=stale' },
    });
    expect(calls[0]?.headers['cookie']).toBe('payload-token=real');
  });

  it('returns data: null when the query matched nothing', async () => {
    const { fetch } = capture({ docs: [] });
    const preview = definePreview({ serverURL: CMS, depth: 1, fetch });
    const result = await preview.fetchDocument({ collection: 'pages', authorization: null });
    expect(result).toEqual({ ok: true, data: null, draft: false, status: 200 });
  });
});

describe('definePreview — failures', () => {
  it('reports HTTP, network, invalid JSON and a missing fetch as typed results', async () => {
    const http = definePreview({ serverURL: CMS, depth: 1, fetch: capture({}, 503).fetch });
    expect(await http.fetchGlobal({ global: 'g', authorization: null })).toMatchObject({
      ok: false,
      reason: 'http',
      status: 503,
    });
    const network = definePreview({
      serverURL: CMS,
      depth: 1,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    expect(await network.fetchGlobal({ global: 'g', authorization: null })).toMatchObject({
      ok: false,
      reason: 'network',
      status: undefined,
    });
    const badJson = definePreview({
      serverURL: CMS,
      depth: 1,
      fetch: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError('x')),
        }),
    });
    expect(await badJson.fetchGlobal({ global: 'g', authorization: null })).toMatchObject({
      ok: false,
      reason: 'invalid-json',
      status: 200,
    });
    const original = globalThis.fetch;
    // @ts-expect-error -- simulate a runtime without fetch
    globalThis.fetch = undefined;
    try {
      const none = definePreview({ serverURL: CMS, depth: 1 });
      expect(await none.fetchGlobal({ global: 'g', authorization: null })).toMatchObject({
        ok: false,
        reason: 'no-fetch',
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('times out a read that never answers and reports it as timeout', async () => {
    const preview = definePreview({
      serverURL: CMS,
      depth: 1,
      timeoutMs: 250,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(init.signal.reason as Error);
          });
        }),
    });
    const result = await preview.fetchGlobal({ global: 'g', authorization: null });
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('reports an external abort as aborted', async () => {
    const controller = new AbortController();
    const preview = definePreview({
      serverURL: CMS,
      depth: 1,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(init.signal.reason as Error);
          });
        }),
    });
    const pending = preview.fetchGlobal({
      global: 'g',
      authorization: null,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: 'aborted' });
  });

  it("throws PreviewFetchError in errorMode: 'throw', with reason, status and url", async () => {
    const preview = definePreview({ serverURL: CMS, depth: 1, fetch: capture({}, 404).fetch });
    const attempt = preview.fetchDocument({
      collection: 'pages',
      authorization: null,
      errorMode: 'throw',
    });
    await expect(attempt).rejects.toBeInstanceOf(PreviewFetchError);
    await expect(attempt).rejects.toMatchObject({
      reason: 'http',
      status: 404,
      url: expect.stringContaining('/api/pages') as string,
    });
  });

  it('reports every read and failure to onDiagnostic without header values', async () => {
    const seen: PreviewFetchDiagnostic[] = [];
    const preview = definePreview({
      serverURL: CMS,
      depth: 1,
      fetch: capture({ docs: [] }).fetch,
      onDiagnostic: (d) => seen.push(d),
    });
    await preview.fetchDocument({ collection: 'pages', authorization: await context() });
    const failing = definePreview({
      serverURL: CMS,
      depth: 1,
      fetch: capture({}, 500).fetch,
      onDiagnostic: (d) => seen.push(d),
    });
    await failing.fetchGlobal({ global: 'g', authorization: null });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ kind: 'response', status: 200, draft: true });
    expect(seen[1]).toMatchObject({ kind: 'failure', reason: 'http', status: 500, draft: false });
    expect(JSON.stringify(seen)).not.toContain('payload-token');
    for (const d of seen) expect(d.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('never calls onDiagnostic twice for one read', async () => {
    const onDiagnostic = vi.fn();
    const preview = definePreview({
      serverURL: CMS,
      depth: 1,
      fetch: capture().fetch,
      onDiagnostic,
    });
    await preview.fetchGlobal({ global: 'g', authorization: null });
    expect(onDiagnostic).toHaveBeenCalledOnce();
  });
});
