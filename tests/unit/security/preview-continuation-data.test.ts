/**
 * The same-origin reference reaches the real continuation and REST reader.
 * Payload responses and host authentication are local substitutes, so these
 * tests make no native-browser, database ACL or unsaved-population claim.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createReferenceContinuation,
  type ContinuationTarget,
} from '../../fixtures/preview-continuation';
import {
  createReferenceDataHandler,
  type ReferenceDataOptions,
} from '../../fixtures/preview-continuation-data';
import {
  continuationHarness,
  CONTINUATION_SITE,
} from '../../fixtures/preview-continuation-harness';

async function setup(
  target?: Partial<ContinuationTarget>,
  maxResponseBytes?: number,
  globalDocument?: ReferenceDataOptions['globalDocument'],
) {
  const h = continuationHarness();
  const selected = { ...h.target, ...target };
  const reference = createReferenceContinuation({ ...h.options, binding: () => selected });
  const opened = await reference.exchange(
    h.request(`/page?locale=de&previewToken=${await h.token()}`),
  );
  expect(opened.status).toBe(303);
  const cookie = `${h.loginCookie}; ${opened.headers.get('set-cookie')!.split(';')[0]!}`;
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(() =>
      Promise.resolve(Response.json({ id: 'post-a', title: 'Stored draft' })),
    );
  const handle = createReferenceDataHandler(reference, {
    fetch,
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    ...(globalDocument === undefined ? {} : { globalDocument }),
  });
  return {
    h,
    selected,
    fetch,
    handle,
    request: (query = '?preview=true&locale=de') => h.request(`/page${query}`, cookie),
  };
}

async function privateResult(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(response.headers.has('access-control-allow-origin')).toBe(false);
  return response.json() as Promise<unknown>;
}

describe('continuation data reference', () => {
  it('selects one draft document, locale and depth with only the current principal headers', async () => {
    const s = await setup({ serverURL: 'https://cms.example.test/cms', apiRoute: '/rest' });
    const browser = s.request();
    browser.headers.set('authorization', 'browser-value-must-not-forward');
    browser.headers.set('x-arbitrary', 'browser-value-must-not-forward');
    const result = await privateResult(await s.handle(browser), 200);
    expect(result).toEqual({ version: 1, ok: true, data: { id: 'post-a', title: 'Stored draft' } });
    const [url, init] = s.fetch.mock.calls[0]!;
    expect(url).toBe('https://cms.example.test/cms/rest/posts/post-a?depth=1&draft=true&locale=de');
    expect(init?.headers).toEqual({ accept: 'application/json', ...s.h.principal.payloadHeaders });
    expect(init?.cache).toBe('no-store');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(s.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { id: 'post-a', errors: [{ message: 'A legitimate content field' }] },
    { id: 'post-a', ok: false, version: 99, error: 'Another content field', data: { value: 1 } },
  ])('keeps document fields separate from the transport envelope: %j', async (doc) => {
    const s = await setup();
    s.fetch.mockResolvedValueOnce(Response.json(doc));
    expect(await privateResult(await s.handle(s.request()), 200)).toEqual({
      version: 1,
      ok: true,
      data: doc,
    });
  });

  it('reads a bound global, including its own errors field', async () => {
    const s = await setup({ document: { kind: 'global', slug: 'homepage' } });
    const doc = { globalType: 'homepage', errors: 'Legitimate content' };
    s.fetch.mockResolvedValueOnce(Response.json(doc));
    expect(await privateResult(await s.handle(s.request()), 200)).toEqual({
      version: 1,
      ok: true,
      data: doc,
    });
    expect(s.fetch.mock.calls[0]![0]).toBe(
      'https://cms.example.test/api/globals/homepage?depth=1&draft=true&locale=de',
    );
  });

  it('uses an explicit application schema for an errors-only global, not a field-name heuristic', async () => {
    const schema = vi.fn(
      (doc: Record<string, unknown>, slug: string) =>
        slug === 'homepage' && Object.keys(doc).length === 1 && typeof doc['errors'] === 'string',
    );
    const s = await setup({ document: { kind: 'global', slug: 'homepage' } }, undefined, schema);
    s.fetch.mockResolvedValueOnce(Response.json({ errors: 'Editorial content' }));
    expect(await privateResult(await s.handle(s.request()), 200)).toEqual({
      version: 1,
      ok: true,
      data: { errors: 'Editorial content' },
    });
    s.fetch.mockResolvedValueOnce(Response.json({ errors: [{ message: 'Not this schema' }] }));
    expect(await privateResult(await s.handle(s.request()), 502)).toEqual({
      version: 1,
      ok: false,
      error: 'unavailable',
    });
    expect(schema).toHaveBeenCalledTimes(2);
  });

  it.each([
    'id=post-b',
    'collection=users',
    'global=secrets',
    'depth=2',
    'serverURL=https://foreign.test',
    'url=https://foreign.test',
    'where[id]=post-b',
    'previewToken=unused',
    'preview=true',
  ])('rejects browser-selected authority or ambiguous query %s before fetching', async (extra) => {
    const s = await setup();
    expect(
      await privateResult(await s.handle(s.request(`?preview=true&locale=de&${extra}`)), 400),
    ).toEqual({ version: 1, ok: false, error: 'invalid-request' });
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each(['?preview=true', '?preview=true&locale=en', '?preview=true&locale=de&locale=de'])(
    'refuses a missing, wrong or ambiguous locale %s before fetching',
    async (query) => {
      const s = await setup();
      expect(await privateResult(await s.handle(s.request(query)), 403)).toEqual({
        version: 1,
        ok: false,
        error: 'forbidden',
      });
      expect(s.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['no-login', 'revoked', 'expiry', 'mapping', 'origin', 'cross-site', 'path'])(
    'refuses %s before fetching',
    async (kind) => {
      const s = await setup();
      let request = s.request();
      if (kind === 'no-login') s.h.principals.clear();
      if (kind === 'revoked') s.h.records.clear();
      if (kind === 'expiry') s.h.advance(300_001);
      if (kind === 'mapping') s.selected.depth = 2;
      if (kind === 'origin') request.headers.set('origin', 'https://foreign.test');
      if (kind === 'cross-site') request.headers.set('sec-fetch-site', 'cross-site');
      if (kind === 'path') {
        request = new Request(`${CONTINUATION_SITE}/other?preview=true&locale=de`, request);
      }
      expect(await privateResult(await s.handle(request), 403)).toEqual({
        version: 1,
        ok: false,
        error: 'forbidden',
      });
      expect(s.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([401, 403, 429, 500])(
    'does not forward the private upstream %s body or headers',
    async (status) => {
      const s = await setup();
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({ cancel });
      s.fetch.mockResolvedValueOnce(
        new Response(stream, {
          status,
          headers: { 'set-cookie': 'private-upstream', 'x-debug': 'private-detail' },
        }),
      );
      expect(await privateResult(await s.handle(s.request()), 502)).toEqual({
        version: 1,
        ok: false,
        error: 'unavailable',
      });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(s.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    null,
    [],
    42,
    {},
    { errors: [{ message: 'Ambiguous without document identity' }] },
    { id: 'post-b' },
    { id: null },
    { ok: false, data: { id: 'post-a' } },
  ])('refuses an invalid or unidentified success body: %j', async (body) => {
    const s = await setup();
    s.fetch.mockResolvedValueOnce(Response.json(body));
    expect(await privateResult(await s.handle(s.request()), 502)).toEqual({
      version: 1,
      ok: false,
      error: 'unavailable',
    });
  });

  it.each(['', '{', '<html>Login page</html>'])(
    'refuses a malformed JSON success body %j',
    async (body) => {
      const s = await setup();
      s.fetch.mockResolvedValueOnce(
        new Response(body, { headers: { 'content-type': 'application/json' } }),
      );
      expect(await privateResult(await s.handle(s.request()), 502)).toEqual({
        version: 1,
        ok: false,
        error: 'unavailable',
      });
    },
  );

  it('requires JSON media type instead of accepting an intercepted HTML/login response', async () => {
    const s = await setup();
    s.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'post-a' }), { headers: { 'content-type': 'text/html' } }),
    );
    expect(await privateResult(await s.handle(s.request()), 502)).toEqual({
      version: 1,
      ok: false,
      error: 'unavailable',
    });
  });

  it('redacts an offline error and recovers on the next request without reusing the entry', async () => {
    const s = await setup();
    s.fetch.mockRejectedValueOnce(new Error('private transport detail'));
    expect(await privateResult(await s.handle(s.request()), 502)).toEqual({
      version: 1,
      ok: false,
      error: 'unavailable',
    });
    expect(await privateResult(await s.handle(s.request()), 200)).toMatchObject({
      ok: true,
      data: { title: 'Stored draft' },
    });
    expect(s.h.consumed.size).toBe(1);
    expect(s.h.records.size).toBe(1);
  });

  it.each(['POST', 'PUT', 'DELETE', 'HEAD'])(
    'refuses %s without entering authorization or reading a body',
    async (method) => {
      const s = await setup();
      const count = s.h.store.read.mock.calls.length;
      const response = await s.handle(new Request(s.request(), { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(s.h.store.read.mock.calls.length).toBe(count);
      expect(s.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, Infinity, NaN, 1.5])(
    'refuses invalid response-byte option %s',
    (maxResponseBytes) => {
      const h = continuationHarness();
      expect(() =>
        createReferenceDataHandler(h.reference, { fetch: vi.fn(), maxResponseBytes }),
      ).toThrow(TypeError);
    },
  );

  it('uses actual UTF-8 bytes and accepts the exact response limit', async () => {
    const doc = { id: 'post-a', title: '界'.repeat(30) };
    const bytes = new TextEncoder().encode(JSON.stringify(doc));
    const s = await setup(undefined, bytes.byteLength);
    s.fetch.mockResolvedValueOnce(Response.json(doc));
    expect(await privateResult(await s.handle(s.request()), 200)).toEqual({
      version: 1,
      ok: true,
      data: doc,
    });
    const small = await setup(undefined, bytes.byteLength - 1);
    small.fetch.mockResolvedValueOnce(Response.json(doc));
    expect(await privateResult(await small.handle(small.request()), 502)).toEqual({
      version: 1,
      ok: false,
      error: 'unavailable',
    });
  });

  it('cancels at the first over-limit chunk, ignoring a forged Content-Length', async () => {
    const s = await setup(undefined, 20);
    let chunks = 0;
    const pull = vi.fn((stream: ReadableStreamDefaultController<Uint8Array>) => {
      stream.enqueue(new TextEncoder().encode('x'.repeat(21)));
      // The negative baseline has no byte cap. Keep that countercheck finite
      // too; two chunks distinguish early cancellation without a memory soak.
      chunks += 1;
      if (chunks === 2) stream.close();
    });
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    s.fetch.mockResolvedValueOnce(
      new Response(body, {
        headers: { 'content-type': 'application/json', 'content-length': '1' },
      }),
    );
    expect(await privateResult(await s.handle(s.request()), 502)).toEqual({
      version: 1,
      ok: false,
      error: 'unavailable',
    });
    expect(pull).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('decodes multibyte characters split across response chunks and releases the reader', async () => {
    const s = await setup();
    const doc = { id: 'post-a', title: '界' };
    const bytes = new TextEncoder().encode(JSON.stringify(doc));
    let offset = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(stream) {
          if (offset === bytes.length) stream.close();
          else stream.enqueue(bytes.slice(offset, ++offset));
        },
      },
      { highWaterMark: 0 },
    );
    s.fetch.mockResolvedValueOnce(
      new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8' } }),
    );
    expect(await privateResult(await s.handle(s.request()), 200)).toEqual({
      version: 1,
      ok: true,
      data: doc,
    });
    expect(body.locked).toBe(false);
  });

  it('rejects invalid UTF-8 instead of accepting replacement characters', async () => {
    const s = await setup();
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('{"id":"post-a","title":"'),
      0xff,
      ...new TextEncoder().encode('"}'),
    ]);
    s.fetch.mockResolvedValueOnce(
      new Response(bytes, { headers: { 'content-type': 'application/json' } }),
    );
    expect(await privateResult(await s.handle(s.request()), 502)).toEqual({
      version: 1,
      ok: false,
      error: 'unavailable',
    });
  });

  it('takes refreshed user headers from each verified login, not the stored grant', async () => {
    const s = await setup();
    expect((await s.handle(s.request())).status).toBe(200);
    const principal = {
      ...s.h.principal,
      payloadHeaders: { cookie: 'fixture-refreshed-user-cookie' },
    };
    s.h.principals.set(s.h.loginCookie.slice('host-login='.length), principal);
    expect((await s.handle(s.request())).status).toBe(200);
    expect(s.fetch.mock.calls[1]![1]?.headers).toEqual({
      accept: 'application/json',
      ...principal.payloadHeaders,
    });
    expect(s.h.store.consume).toHaveBeenCalledTimes(1);
  });
});
