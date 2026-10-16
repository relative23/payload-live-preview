/**
 * Form values are input, never document authority in the unsaved reference.
 * The real continuation and package reader run here; local responses isolate
 * transport contracts from the separately exercised database ACL fixture.
 */
import { describe, expect, it, vi } from 'vitest';
import { createReferenceContinuation } from '../../fixtures/preview-continuation';
import { createReferenceUnsavedHandler } from '../../fixtures/preview-continuation-unsaved';
import {
  continuationHarness,
  CONTINUATION_SITE,
} from '../../fixtures/preview-continuation-harness';

const fields = { title: 'Unsaved Ä', related: [2], files: [7] };
const input = { version: 1, revision: 1, data: fields };
const saved = {
  id: 'post-a',
  owner: 'a',
  title: 'Saved',
  related: [],
  files: [],
  _status: 'draft',
};

async function setup(maxResponseBytes?: number) {
  const h = continuationHarness();
  const target = {
    ...h.target,
    document: { kind: 'collection' as const, slug: 'articles', id: 'post-a' },
  };
  const reference = createReferenceContinuation({ ...h.options, binding: () => target });
  const opened = await reference.exchange(
    h.request(`/page?locale=de&previewToken=${await h.token()}`),
  );
  expect(opened.status).toBe(303);
  const cookie = `${h.loginCookie}; ${opened.headers.get('set-cookie')!.split(';')[0]!}`;
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation((_url, init) =>
      Promise.resolve(Response.json(init?.method === 'POST' ? { ...saved, ...fields } : saved)),
    );
  const handle = createReferenceUnsavedHandler(reference, {
    fetch,
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
  });
  return {
    h,
    reference,
    fetch,
    handle,
    target,
    request: (data: unknown = input, init: RequestInit = {}) =>
      new Request(h.request(undefined, cookie), {
        method: 'POST',
        headers: { cookie, origin: CONTINUATION_SITE, 'content-type': 'application/json' },
        body: JSON.stringify(data),
        ...init,
      }),
  };
}

async function refusal(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(response.headers.has('access-control-allow-origin')).toBe(false);
  expect(await response.json()).toEqual({
    version: 1,
    ok: false,
    error: status === 403 ? 'forbidden' : status === 502 ? 'unavailable' : 'invalid-request',
  });
}

describe('bound unsaved population reference', () => {
  it('reads the bound saved document first and posts only a server-constructed snapshot', async () => {
    const s = await setup();
    const request = s.request();
    request.headers.set('authorization', 'untrusted-browser-material');
    const response = await s.handle(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 1,
      ok: true,
      revision: 1,
      data: { ...saved, ...fields },
    });
    expect(s.fetch).toHaveBeenCalledTimes(2);
    const [getURL, get] = s.fetch.mock.calls[0]!;
    const [postURL, post] = s.fetch.mock.calls[1]!;
    expect(getURL).toBe(
      'https://cms.example.test/api/articles/post-a?depth=0&draft=true&locale=de',
    );
    expect(get?.method ?? 'GET').toBe('GET');
    expect(postURL).toBe(
      'https://cms.example.test/api/articles/post-a?depth=1&draft=true&locale=de',
    );
    expect(post?.method).toBe('POST');
    expect(typeof post?.body).toBe('string');
    expect(JSON.parse(post?.body as string)).toEqual({
      data: { ...saved, ...fields },
      draft: false,
      flattenLocales: false,
    });
    expect(new Headers(post?.headers).get('x-payload-http-method-override')).toBe('GET');
    expect(new Headers(post?.headers).get('authorization')).toBeNull();
    expect(new Headers(post?.headers).get('cookie')).toBe(s.h.principal.payloadHeaders['cookie']);
    for (const init of [get, post]) {
      expect(init?.cache).toBe('no-store');
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    // definePreview combines the shared lifetime with a per-read timeout.
    // The lifetime suite proves both phases still use the original deadline.
    expect(post?.signal?.aborted).toBe(false);
    expect(get?.signal?.aborted).toBe(false);
  });

  it.each([401, 403, 404, 429, 500])(
    'does not populate after a denied saved read (%i)',
    async (status) => {
      const s = await setup();
      s.fetch.mockResolvedValueOnce(Response.json({ errors: ['private detail'] }, { status }));
      await refusal(await s.handle(s.request()), 502);
      expect(s.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([{}, { id: 'other' }, { id: null }, [], { errors: ['not a document'] }])(
    'requires identity before any data substitution: %j',
    async (body) => {
      const s = await setup();
      s.fetch.mockResolvedValueOnce(Response.json(body));
      await refusal(await s.handle(s.request()), 502);
      expect(s.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    null,
    [],
    {},
    { ...input, version: 2 },
    { ...input, revision: 0 },
    { ...input, revision: -1 },
    { ...input, revision: 1.5 },
    { ...input, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...input, locale: 'en' },
    { ...input, depth: 99 },
    ...['id', 'owner', 'collection', 'where', 'editorNotes', '__proto__'].map((key) => ({
      ...input,
      data: { ...fields, [key]: 'foreign' },
    })),
    { ...input, data: { ...fields, title: 9 } },
    { ...input, data: { title: 'missing IDs' } },
    { ...input, data: { ...fields, related: [{ id: 'r-one', title: 'injected' }] } },
    { ...input, data: { ...fields, files: [{ relationTo: 'media', value: 1 }] } },
    { ...input, data: { ...fields, related: Array.from({ length: 33 }, () => 'r-one') } },
    ...['', null, true, -1, 1.5, {}, []].map((id) => ({
      ...input,
      data: { ...fields, files: [id] },
    })),
  ])('refuses unknown authority or unsupported schema before Payload: %j', async (body) => {
    const s = await setup();
    await refusal(await s.handle(s.request(body)), 400);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, 'https://foreign.example.test', 'null'])(
    'requires an exact Origin: %s',
    async (origin) => {
      const s = await setup();
      const req = s.request();
      if (origin === undefined) req.headers.delete('origin');
      else req.headers.set('origin', origin);
      await refusal(await s.handle(req), 403);
      expect(s.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    '?preview=true&locale=en',
    '?preview=true&locale=de&locale=de',
    '?preview=true&locale=de&depth=9',
    '?locale=de',
    '?preview=true&preview=true&locale=de',
  ])('refuses browser target overrides: %s', async (query) => {
    const s = await setup();
    const req = s.request();
    const changed = new Request(`${CONTINUATION_SITE}/page${query}`, req);
    expect((await s.handle(changed)).ok).toBe(false);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'refuses non-JSON input (%s)',
    async (type) => {
      const s = await setup();
      const req = s.request();
      req.headers.set('content-type', type);
      await refusal(await s.handle(req), 400);
      expect(s.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['{', new Uint8Array([0xff])])('refuses malformed JSON or UTF-8', async (body) => {
    const s = await setup();
    await refusal(await s.handle(s.request(input, { body })), 400);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('counts actual multibyte input, ignores declared length and cancels an oversized body', async () => {
    const s = await setup();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('ä'.repeat(32_769)));
      },
      cancel,
    });
    const req = s.request(input, { body, ...({ duplex: 'half' } as RequestInit) });
    req.headers.set('content-length', '1');
    await refusal(await s.handle(req), 400);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('enforces the same response byte cap during population and recovers on the next revision', async () => {
    const s = await setup(160);
    s.fetch
      .mockResolvedValueOnce(Response.json(saved))
      .mockResolvedValueOnce(Response.json({ ...saved, title: 'ä'.repeat(90) }));
    await refusal(await s.handle(s.request()), 502);
    expect((await s.handle(s.request({ ...input, revision: 2 }))).status).toBe(200);
  });

  it('refuses changed response identity rather than relabelling it with the bound ID', async () => {
    const s = await setup();
    s.fetch
      .mockResolvedValueOnce(Response.json(saved))
      .mockResolvedValueOnce(Response.json({ ...saved, id: 'other' }));
    await refusal(await s.handle(s.request()), 502);
  });

  it('does not populate a revoked continuation', async () => {
    const s = await setup();
    s.h.records.clear();
    await refusal(await s.handle(s.request()), 403);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('refuses string IDs for this numeric SQLite schema rather than claiming successful population', async () => {
    const s = await setup();
    await refusal(
      await s.handle(s.request({ ...input, data: { ...fields, related: ['2'] } })),
      400,
    );
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it('keeps unsupported document schemas outside the reference', async () => {
    const s = await setup();
    const other = createReferenceContinuation({
      ...s.h.options,
      binding: () => ({ ...s.target, document: { kind: 'global', slug: 'articles' } }),
    });
    await refusal(await createReferenceUnsavedHandler(other, { fetch: s.fetch })(s.request()), 403);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PUT', 'DELETE'])('refuses the %s method', async (method) => {
    const s = await setup();
    const req = s.request();
    await refusal(await s.handle(new Request(req.url, { method, headers: req.headers })), 405);
    expect(s.fetch).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects invalid input/output byte caps (%s)',
    async (limit) => {
      const s = await setup();
      expect(() =>
        createReferenceUnsavedHandler(s.reference, { fetch: s.fetch, maxRequestBytes: limit }),
      ).toThrow(TypeError);
      expect(() =>
        createReferenceUnsavedHandler(s.reference, { fetch: s.fetch, maxResponseBytes: limit }),
      ).toThrow(TypeError);
    },
  );

  it('accepts exactly the byte cap, not one byte more', async () => {
    const s = await setup();
    const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
    expect(
      (
        await createReferenceUnsavedHandler(s.reference, {
          fetch: s.fetch,
          maxRequestBytes: bytes,
        })(s.request())
      ).status,
    ).toBe(200);
    s.fetch.mockClear();
    await refusal(
      await createReferenceUnsavedHandler(s.reference, {
        fetch: s.fetch,
        maxRequestBytes: bytes - 1,
      })(s.request()),
      400,
    );
    expect(s.fetch).not.toHaveBeenCalled();
  });
});
