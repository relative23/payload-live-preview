/**
 * DataMerger — REST-based server-side merging (Payload 3.x strategy).
 */
import { describe, expect, it, vi } from 'vitest';
import { DataMerger, type MergeRequest } from '@core/data-merger';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

  it('rejects unsafe or malformed collection and global slugs', () => {
    for (const slug of [
      '.',
      '..',
      '../users',
      'posts/secret',
      'posts\\secret',
      'posts?draft=true',
      'posts#fragment',
      'posts\u0000secret',
      `p${'a'.repeat(128)}`,
    ]) {
      expect(merger.canMerge({ globalSlug: slug, data: {} })).toBe(false);
      expect(merger.canMerge({ collectionSlug: slug, data: { id: '42' } })).toBe(false);
    }
  });

  it('rejects unsafe collection id path segments', () => {
    for (const id of [
      '',
      '.',
      '..',
      '../draft',
      'folder/42',
      'folder\\42',
      '\u0000',
      'a'.repeat(513),
    ]) {
      expect(merger.canMerge({ collectionSlug: 'posts', data: { id } })).toBe(false);
    }
    expect(merger.canMerge({ collectionSlug: 'posts', data: { id: Number.NaN } })).toBe(false);
    expect(
      merger.canMerge({ collectionSlug: 'posts', data: { id: Number.POSITIVE_INFINITY } }),
    ).toBe(false);
  });

  it('accepts valid Unicode slugs and reserved characters inside document ids', () => {
    expect(merger.canMerge({ globalSlug: 'über-uns', data: {} })).toBe(true);
    expect(merger.canMerge({ collectionSlug: 'beiträge', data: { id: 'draft ?#% ü' } })).toBe(true);
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

  it('treats an empty global slug as absent for 1.x collection compatibility', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });

    await expect(
      merger.merge({ globalSlug: '', collectionSlug: 'posts', data: { id: '42' } }),
    ).resolves.toEqual({ status: 'merged', doc: { ok: true } });
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://cms.example.com/api/posts/42');
  });

  it('encodes every dynamic path segment independently', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn: fetchFn,
    });
    await merger.merge({ collectionSlug: 'beiträge', data: { id: 'draft ?#% ü' } });
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      'https://cms.example.com/api/beitr%C3%A4ge/draft%20%3F%23%25%20%C3%BC',
    );
  });

  it('rejects lone UTF-16 surrogates in path segments before fetching', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn,
    });
    for (const surrogate of ['\uD800', '\uDC00']) {
      const requests = [
        { globalSlug: `homepage${surrogate}`, data: {} },
        { collectionSlug: `posts${surrogate}`, data: { id: '42' } },
        { collectionSlug: 'posts', data: { id: `42${surrogate}` } },
      ];
      for (const request of requests) {
        await expect(merger.merge(request)).resolves.toEqual({ status: 'unavailable' });
      }
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each(['%2F', '%5C', '%2E%2E'])(
    'keeps the literal encoded value %s inside each URL path segment',
    async (literal) => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
      const merger = new DataMerger({
        serverURL: 'https://cms.example.com',
        fetchFn,
      });

      await merger.merge({ collectionSlug: `posts${literal}archive`, data: { id: '42' } });
      await merger.merge({ globalSlug: `homepage${literal}archive`, data: {} });
      await merger.merge({ collectionSlug: 'posts', data: { id: `42${literal}draft` } });

      const encoded = encodeURIComponent(literal);
      expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([
        `https://cms.example.com/api/posts${encoded}archive/42`,
        `https://cms.example.com/api/globals/homepage${encoded}archive`,
        `https://cms.example.com/api/posts/42${encoded}draft`,
      ]);
    },
  );

  it('keeps locale data out of the URL path without reinterpretation', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn,
    });
    const locale = '%2F%5C%2E%2E';

    await merger.merge({ collectionSlug: 'posts', data: { id: '42' }, locale });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://cms.example.com/api/posts/42');
    if (typeof init?.body !== 'string') throw new Error('expected a JSON request body');
    expect(JSON.parse(init.body)).toMatchObject({ locale });
  });

  it('fails closed before fetching when a slug is invalid', async () => {
    const fetchFn = vi.fn();
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn: fetchFn,
    });
    await expect(merger.merge({ collectionSlug: '../users', data: { id: '42' } })).resolves.toEqual(
      { status: 'unavailable' },
    );
    expect(fetchFn).not.toHaveBeenCalled();
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

  it.each([
    ['HTTP failure', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 503))],
    ['network failure', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'))],
    ['invalid response', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(['invalid']))],
  ])('keeps the raw-data fallback when diagnostics throw after a %s', async (_case, fetchFn) => {
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn,
      log: () => {
        throw new Error('consumer logger failed');
      },
    });

    await expect(merger.merge({ globalSlug: 'homepage', data: {} })).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('observes rejected diagnostic thenables without changing the merge outcome', async () => {
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async logger failed'));
      },
    );
    const log = (): void => {
      return { then } as never;
    };
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 500)),
      log,
    });

    await expect(merger.merge({ globalSlug: 'homepage', data: {} })).resolves.toEqual({
      status: 'unavailable',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(then).toHaveBeenCalledOnce();
  });

  it('aborts the in-flight request when a newer merge starts', async () => {
    let firstSignal: AbortSignal | undefined;
    const fetchFn = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        firstSignal = init.signal!;
        return new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => {
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

  it('keeps a merge started reentrantly by an abort listener as the latest attempt', async () => {
    const requests: {
      readonly title: string;
      readonly signal: AbortSignal;
      readonly response: ReturnType<typeof deferred<Response>>;
    }[] = [];
    const context: { merger?: DataMerger } = {};
    let reentrant!: Promise<Awaited<ReturnType<DataMerger['merge']>>>;
    const fetchFn = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      if (typeof init?.body !== 'string' || init.signal === undefined || init.signal === null) {
        throw new Error('expected a serialized request with an AbortSignal');
      }
      const body = JSON.parse(init.body) as { data: { title: string } };
      const request = {
        title: body.data.title,
        signal: init.signal,
        response: deferred<Response>(),
      };
      requests.push(request);
      if (request.title === 'A') {
        request.signal.addEventListener('abort', () => {
          if (context.merger === undefined) {
            throw new Error('expected the merger to be initialized');
          }
          reentrant = context.merger.merge({ globalSlug: 'homepage', data: { title: 'C' } });
        });
      }
      return request.response.promise;
    });
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
    context.merger = merger;

    const first = merger.merge({ globalSlug: 'homepage', data: { title: 'A' } });
    const supersededStack = merger.merge({ globalSlug: 'homepage', data: { title: 'B' } });

    expect(requests.map(({ title }) => title)).toEqual(['A', 'C']);
    merger.destroy();
    expect(requests.map(({ title, signal }) => [title, signal.aborted])).toEqual([
      ['A', true],
      ['C', true],
    ]);

    for (const request of requests) {
      request.response.resolve(jsonResponse({ title: request.title }));
    }
    await expect(first).resolves.toEqual({ status: 'superseded' });
    await expect(supersededStack).resolves.toEqual({ status: 'superseded' });
    await expect(reentrant).resolves.toEqual({ status: 'superseded' });
  });

  it('supersedes a throwing request getter that starts a reentrant newer merge attempt', async () => {
    const response = deferred<Response>();
    const fetchFn = vi.fn<typeof fetch>().mockReturnValue(response.promise);
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
    let reentrant!: Promise<Awaited<ReturnType<DataMerger['merge']>>>;
    let triggered = false;
    const outerRequest = {
      get globalSlug(): string {
        if (!triggered) {
          triggered = true;
          reentrant = merger.merge({ globalSlug: 'homepage', data: { title: 'newer' } });
          throw new Error('older getter failed after re-entry');
        }
        return 'homepage';
      },
      data: { title: 'older-stack' },
    };

    const outer = merger.merge(outerRequest);

    expect(fetchFn).toHaveBeenCalledOnce();
    const body = fetchFn.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('expected a serialized request body');
    expect(JSON.parse(body)).toMatchObject({
      data: { title: 'newer' },
    });
    response.resolve(jsonResponse({ title: 'newer' }));
    await expect(outer).resolves.toEqual({ status: 'superseded' });
    await expect(reentrant).resolves.toEqual({ status: 'merged', doc: { title: 'newer' } });
  });

  it('fails closed on hostile request getters and remains usable afterwards', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ title: 'recovered' }));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
    const throwing = (label: string): never => {
      throw new Error(`${label} getter failed`);
    };
    const hostileId = Object.defineProperty({}, 'id', {
      get: () => throwing('id'),
    });
    const hostileRequests: readonly (readonly [string, MergeRequest, boolean])[] = [
      [
        'globalSlug',
        Object.defineProperty({ data: {} }, 'globalSlug', {
          get: () => throwing('globalSlug'),
        }),
        false,
      ],
      [
        'collectionSlug',
        Object.defineProperty({ data: { id: '42' } }, 'collectionSlug', {
          get: () => throwing('collectionSlug'),
        }),
        false,
      ],
      [
        'data',
        Object.defineProperty({ globalSlug: 'homepage' }, 'data', {
          get: () => throwing('data'),
        }) as MergeRequest,
        true,
      ],
      ['id', { collectionSlug: 'posts', data: hostileId }, false],
    ];

    for (const [label, request, canMerge] of hostileRequests) {
      expect(merger.canMerge(request), label).toBe(canMerge);
      await expect(merger.merge(request), label).resolves.toEqual({ status: 'unavailable' });
    }
    expect(fetchFn).not.toHaveBeenCalled();

    await expect(
      merger.merge({ globalSlug: 'homepage', data: { title: 'recovered' } }),
    ).resolves.toEqual({ status: 'merged', doc: { title: 'recovered' } });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('contains a hostile global fetch getter and remains usable with an injected fetch', async () => {
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      get() {
        throw new Error('global fetch getter failed');
      },
    });
    try {
      const merger = new DataMerger({ serverURL: 'https://cms.example.com' });
      await expect(merger.merge({ globalSlug: 'homepage', data: {} })).resolves.toEqual({
        status: 'unavailable',
      });
    } finally {
      if (fetchDescriptor === undefined) Reflect.deleteProperty(globalThis, 'fetch');
      else Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    }

    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ title: 'usable' })),
    });
    await expect(merger.merge({ globalSlug: 'homepage', data: {} })).resolves.toEqual({
      status: 'merged',
      doc: { title: 'usable' },
    });
  });

  it('destroy aborts any in-flight request', async () => {
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => {
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

  it('rejects a merge started by destroy abort listeners but remains reusable afterwards', async () => {
    const firstResponse = deferred<Response>();
    const context: { merger?: DataMerger } = {};
    let reentrant!: Promise<Awaited<ReturnType<DataMerger['merge']>>>;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((_url, init) => {
        if (init?.signal === undefined || init.signal === null) {
          throw new Error('expected an AbortSignal');
        }
        init.signal.addEventListener('abort', () => {
          if (context.merger === undefined) {
            throw new Error('expected the merger to be initialized');
          }
          context.merger.destroy();
          reentrant = context.merger.merge({
            globalSlug: 'homepage',
            data: { title: 'reentrant' },
          });
        });
        return firstResponse.promise;
      })
      .mockResolvedValueOnce(jsonResponse({ title: 'after-destroy' }));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
    context.merger = merger;
    const first = merger.merge({ globalSlug: 'homepage', data: { title: 'first' } });

    merger.destroy();

    expect(fetchFn).toHaveBeenCalledOnce();
    await expect(reentrant).resolves.toEqual({ status: 'superseded' });
    firstResponse.resolve(jsonResponse({ title: 'first' }));
    await expect(first).resolves.toEqual({ status: 'superseded' });

    await expect(
      merger.merge({ globalSlug: 'homepage', data: { title: 'after-destroy' } }),
    ).resolves.toEqual({ status: 'merged', doc: { title: 'after-destroy' } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('supersedes an in-flight request even when the newer request is not mergeable', async () => {
    let firstSignal: AbortSignal | undefined;
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          firstSignal = init.signal ?? undefined;
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const merger = new DataMerger({
      serverURL: 'https://cms.example.com',
      fetchFn: fetchFn,
    });
    const first = merger.merge({ globalSlug: 'homepage', data: { title: 'old' } });
    const second = merger.merge({ data: { title: 'new' } });

    expect(await second).toEqual({ status: 'unavailable' });
    expect(firstSignal?.aborted).toBe(true);
    expect(await first).toEqual({ status: 'superseded' });
  });

  it('discards a response when fetch ignores an intervening abort', async () => {
    const oldResponse = deferred<Response>();
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ title: 'new' }));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn: fetchFn });

    const oldMerge = merger.merge({ globalSlug: 'homepage', data: { title: 'old' } });
    const newMerge = merger.merge({ globalSlug: 'homepage', data: { title: 'new' } });
    expect(await newMerge).toEqual({ status: 'merged', doc: { title: 'new' } });

    oldResponse.resolve(jsonResponse({ title: 'old' }));
    await expect(oldMerge).resolves.toEqual({ status: 'superseded' });
  });

  it('discards parsed JSON when response.json ignores an intervening abort', async () => {
    const oldBody = deferred<unknown>();
    const oldResponse = {
      ok: true,
      status: 200,
      json: () => oldBody.promise,
    } as Response;
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(oldResponse)
      .mockResolvedValueOnce(jsonResponse({ title: 'new' }));
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn: fetchFn });

    const oldMerge = merger.merge({ globalSlug: 'homepage', data: { title: 'old' } });
    await Promise.resolve();
    const newMerge = merger.merge({ globalSlug: 'homepage', data: { title: 'new' } });
    expect(await newMerge).toEqual({ status: 'merged', doc: { title: 'new' } });

    oldBody.resolve({ title: 'old' });
    await expect(oldMerge).resolves.toEqual({ status: 'superseded' });
  });
});
