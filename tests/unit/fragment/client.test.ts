import { describe, expect, it, vi } from 'vitest';
import {
  createFragmentHandler,
  createFragmentStrategy,
  type FragmentBoundary,
  type StrategyRequest,
} from '@fragment/index';

const ENDPOINT = '/payload/fragment';
const LOCATION = { pathname: '/page', search: '?preview=true&previewToken=t' };

function boundary(id = 'hero', key?: string): FragmentBoundary {
  return { element: document.createElement('section'), id, key, dependsOn: [] };
}

function request(overrides: Partial<StrategyRequest> = {}): StrategyRequest {
  return {
    revision: 7,
    receivedAt: 1,
    fields: { title: 'T' },
    locale: 'de',
    collectionSlug: undefined,
    globalSlug: 'home',
    signal: new AbortController().signal,
    ...overrides,
  };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function json(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });
}

function rendered(html = '<h1>S</h1>', revision = 7, id = 'hero'): Response {
  return json({
    html,
    boundary: { id },
    revision,
    metadata: { renderedAt: '2026-08-27T00:00:00Z', renderer: 'test' },
  });
}

describe('createFragmentStrategy — the request', () => {
  it('refuses an endpoint that is not a same-origin path', () => {
    expect(() => createFragmentStrategy({ endpoint: 'https://evil.example/x' })).toThrow(
      /same-origin path/u,
    );
    expect(() => createFragmentStrategy({ endpoint: '//evil.example/x' })).toThrow();
    expect(typeof createFragmentStrategy({ endpoint: '/x' }).render).toBe('function');
  });

  it('posts the boundary, the page route and query, the revision and the fields, same-origin with credentials', async () => {
    const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(rendered()));
    const strategy = createFragmentHandler({
      endpoint: ENDPOINT,
      fetch: fetchFn,
      location: LOCATION,
    });
    const outcome = await strategy(request(), boundary('hero', 'k1'));
    expect(outcome).toMatchObject({ status: 'rendered', html: '<h1>S</h1>' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['x-payload-fragment-version']).toBe('1');
    expect(JSON.parse(init.body as string)).toEqual({
      fragment: 'hero',
      key: 'k1',
      route: '/page',
      search: '?preview=true&previewToken=t',
      revision: 7,
      locale: 'de',
      globalSlug: 'home',
      fields: { title: 'T' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('shares one request between identical boundaries of the same revision', async () => {
    const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(rendered()));
    const strategy = createFragmentHandler({
      endpoint: ENDPOINT,
      fetch: fetchFn,
      location: LOCATION,
    });
    const req = request();
    const [a, b] = await Promise.all([strategy(req, boundary()), strategy(req, boundary())]);
    expect(a).toEqual(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await strategy(request({ revision: 8 }), boundary());
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('caps concurrency and queues the rest in order', async () => {
    let active = 0;
    let peak = 0;
    const fetchFn = vi.fn<FetchLike>(
      () =>
        new Promise<Response>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          setTimeout(() => {
            active -= 1;
            resolve(rendered());
          }, 5);
        }),
    );
    const strategy = createFragmentHandler({
      endpoint: ENDPOINT,
      fetch: fetchFn,
      location: LOCATION,
      maxConcurrent: 2,
    });
    const req = request();
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((id) => strategy(req, boundary(id))));
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(peak).toBe(2);
  });
});

describe('createFragmentStrategy — the response', () => {
  it('reports 401/403 as LP0803, other failures as LP0801', async () => {
    const strategy = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(json({ error: 'unauthorized' }, { status: 403 }))
        .mockResolvedValueOnce(json({ error: 'render' }, { status: 500 }))
        .mockRejectedValueOnce(new TypeError('network down')),
    });
    expect(await strategy(request(), boundary())).toMatchObject({
      status: 'failed',
      code: 'LP0803',
    });
    expect(await strategy(request({ revision: 8 }), boundary())).toMatchObject({
      status: 'failed',
      code: 'LP0801',
    });
    expect(await strategy(request({ revision: 9 }), boundary())).toMatchObject({
      status: 'failed',
      code: 'LP0801',
      reason: 'network down',
    });
  });

  it('refuses a wrong content type, a malformed body, another boundary and an oversized body as LP0802', async () => {
    const strategy = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      maxResponseBytes: 200,
      fetch: vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(
          new Response('<h1>S</h1>', { headers: { 'content-type': 'text/html' } }),
        )
        .mockResolvedValueOnce(json({ html: 5 }))
        .mockResolvedValueOnce(rendered('<h1>S</h1>', 7, 'other'))
        .mockResolvedValueOnce(rendered('x'.repeat(500))),
    });
    for (const revision of [1, 2, 3, 4]) {
      expect(await strategy(request({ revision }), boundary())).toMatchObject({
        status: 'failed',
        code: 'LP0802',
      });
    }
  });

  it('treats a response for another revision as superseded', async () => {
    const strategy = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: vi.fn<FetchLike>(() => Promise.resolve(rendered('<h1>S</h1>', 6))),
    });
    expect(await strategy(request(), boundary())).toEqual({ status: 'superseded' });
  });

  it('is superseded, not failed, when the runtime aborts the revision mid-flight', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn<FetchLike>(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const strategy = createFragmentHandler({
      endpoint: ENDPOINT,
      fetch: fetchFn,
      location: LOCATION,
    });
    const pending = strategy(request({ signal: controller.signal }), boundary());
    controller.abort();
    expect(await pending).toEqual({ status: 'superseded' });
  });

  it('times out as LP0801', async () => {
    const fetchFn = vi.fn<FetchLike>(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const strategy = createFragmentHandler({
      endpoint: ENDPOINT,
      fetch: fetchFn,
      location: LOCATION,
      timeoutMs: 10,
    });
    expect(await strategy(request(), boundary())).toMatchObject({
      status: 'failed',
      code: 'LP0801',
      reason: 'timeout after 10 ms',
    });
  });
});

/** A JSON response whose body streams and errors on abort, as a real fetch body does. */
function streaming(head: string, init?: RequestInit, contentType = 'application/json'): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(head));
      init?.signal?.addEventListener('abort', () => {
        controller.error(new DOMException('aborted', 'AbortError'));
      });
    },
  });
  return new Response(stream, { headers: { 'content-type': contentType } });
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createFragmentStrategy — cancellation and bounds', () => {
  it('rejects a backslash endpoint: the URL parser reads `\\` as `/` and would leave the origin', () => {
    expect(() => createFragmentStrategy({ endpoint: '/\\evil.com/x' })).toThrow(/same-origin/u);
    expect(() => createFragmentStrategy({ endpoint: '/x\\y' })).toThrow(/same-origin/u);
    expect(new URL('/\\evil.com/x', 'https://site.example').origin).toBe('https://evil.com');
  });

  it('is superseded, with no unhandled rejection, when the revision is aborted while the body streams', async () => {
    const unhandled: unknown[] = [];
    const capture = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', capture);
    const controller = new AbortController();
    // Only the aborted revision streams; the retry answers at once, so no real timer runs.
    const fetchFn = vi
      .fn<FetchLike>()
      .mockImplementationOnce((_url, init) => Promise.resolve(streaming('{"html":"', init)))
      .mockImplementation(() => Promise.resolve(rendered('<h1>S</h1>', 8)));
    const strategy = createFragmentHandler({
      endpoint: ENDPOINT,
      fetch: fetchFn,
      location: LOCATION,
    });
    try {
      const pending = strategy(request({ signal: controller.signal }), boundary());
      await tick();
      expect(fetchFn).toHaveBeenCalledOnce();
      controller.abort();
      expect(await pending).toEqual({ status: 'superseded' });
      await tick();
      expect(unhandled).toEqual([]);
      // The dedupe map was cleaned: the same boundary issues a new request.
      expect(await strategy(request({ revision: 8 }), boundary())).toMatchObject({
        status: 'rendered',
      });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      process.off('unhandledRejection', capture);
    }
  });

  it('counts the streamed body in bytes, not UTF-16 units, and cuts an oversized answer off as LP0802', async () => {
    // 'ä' is one UTF-16 unit but two bytes: 250 units fit a 400 cap, 500 bytes do not.
    const strategy = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      maxResponseBytes: 400,
      fetch: vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(rendered('ä'.repeat(250)))
        .mockResolvedValueOnce(rendered('a'.repeat(250), 8)),
    });
    expect(await strategy(request(), boundary())).toMatchObject({
      status: 'failed',
      code: 'LP0802',
      reason: 'response exceeds the size limit',
    });
    expect(await strategy(request({ revision: 8 }), boundary())).toMatchObject({
      status: 'rendered',
      html: 'a'.repeat(250),
    });
  });

  it('maps a body that cannot be serialized to LP0801 instead of rejecting', async () => {
    const strategy = createFragmentHandler({ endpoint: ENDPOINT, location: LOCATION });
    expect(await strategy(request({ fields: { n: 1n } }), boundary())).toMatchObject({
      status: 'failed',
      code: 'LP0801',
      reason: expect.stringContaining('BigInt') as string,
    });
  });

  it('forgets a request that rejected, so the next identical one is retried instead of replaying the rejection', async () => {
    const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(rendered()));
    // The only way past the outcome mapping is a throw before the request is built.
    let broken = true;
    const location = {
      get pathname(): string {
        if (broken) {
          broken = false;
          throw new Error('no location yet');
        }
        return '/page';
      },
      search: '',
    };
    const strategy = createFragmentHandler({ endpoint: ENDPOINT, fetch: fetchFn, location });
    await expect(strategy(request(), boundary())).rejects.toThrow('no location yet');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await strategy(request(), boundary())).toMatchObject({ status: 'rendered' });
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
