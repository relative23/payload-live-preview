/**
 * The desired related-draft composition must preserve the processed root.
 * These are actual reference/package paths with controlled upstream responses,
 * not transferred historical algorithms or expected-failure assertions.
 */
import { describe, expect, it } from 'vitest';
import { isAuthorizedPreviewContext } from '@security/preview-authorization';
import { createReferenceUnsavedHandler } from '../../fixtures/preview-continuation-unsaved';
import { relatedHarness, relatedRefusal } from '../../fixtures/preview-related-harness';

async function json(
  response: Response,
): Promise<{ data: { related: unknown[]; files: unknown[] } }> {
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  expect(value).toMatchObject({ version: 1, ok: true });
  return value as { data: { related: unknown[]; files: unknown[] } };
}

describe('schema-bound related draft composition', () => {
  it.each([0, 1, 2])(
    'preserves the unsaved root and consumes one depth per edge (%i)',
    async (depth) => {
      const s = await relatedHarness(depth);
      const response = await s.handle(s.request());
      expect(response.status).toBe(200);
      const result = await json(response);
      expect(result).toMatchObject({
        version: 1,
        ok: true,
        revision: 1,
        data: { id: 1, owner: 'a', title: s.fields.title },
      });
      expect(result.data.related).toEqual(
        depth === 0
          ? [2]
          : [
              {
                ...s.documents.get('records/2'),
                next: depth === 1 ? 3 : s.documents.get('records/3'),
              },
            ],
      );
      expect(result.data.files).toEqual(depth === 0 ? [7] : [s.documents.get('media/7')]);
      for (const [url] of s.fetch.mock.calls) {
        expect(new URL(url as string).searchParams.get('depth')).toBe('0');
      }
      expect(s.saved.title).toBe('Saved');
    },
  );

  it('mints exact-target verifier contexts without modifying the root scope or forwarding browser credentials', async () => {
    const s = await relatedHarness();
    const request = s.request();
    request.headers.set('authorization', 'browser-authority-is-not-trusted');
    const parent = await s.reference.authorize(request);
    expect((await s.handle(request)).status).toBe(200);
    expect(s.authorize).toHaveBeenCalledTimes(3);
    for (const call of s.authorize.mock.results) {
      if (call.type !== 'return') throw new Error('Verifier did not return');
      const verdict = await call.value;
      expect(verdict.authorized).toBe(true);
      if (!verdict.authorized) throw new Error('Missing context');
      expect(isAuthorizedPreviewContext(verdict.context)).toBe(true);
      expect(verdict.context.expiresAt).toBe(parent?.context.expiresAt);
      expect(verdict.context.subject).toBe(parent?.context.subject);
      expect(verdict.context.scope).toMatchObject({
        audience: s.target.audience,
        path: '/page',
        locale: 'de',
        payload: { serverURL: s.target.serverURL, maxDepth: 0 },
      });
      expect(verdict.context.payloadHeaders === parent?.context.payloadHeaders).toBe(false);
    }
    expect(parent?.context.scope.payload?.document).toEqual({
      kind: 'collection',
      slug: 'articles',
      id: '1',
    });
    for (const [url, init] of s.fetch.mock.calls.slice(2)) {
      const parsed = new URL(url as string);
      expect(parsed.origin).toBe('https://cms.example.test');
      expect(parsed.searchParams.get('draft')).toBe('true');
      expect(parsed.searchParams.get('locale')).toBe('de');
      expect(init?.method ?? 'GET').toBe('GET');
      expect(init?.cache).toBe('no-store');
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBeNull();
      expect(
        new Headers(init?.headers).get('cookie') === s.h.principal.payloadHeaders['cookie'],
      ).toBe(true);
    }
  });

  it('does not resurrect fields removed by native field ACLs or hooks', async () => {
    const s = await relatedHarness();
    s.native((data) => ({ id: data['id'], title: 'Hook result', files: data['files'] }));
    const result = await json(await s.handle(s.request()));
    expect(result.data).toEqual({
      id: 1,
      title: 'Hook result',
      files: [s.documents.get('media/7')],
    });
    expect(s.fetch.mock.calls.map(([url]) => new URL(url as string).pathname)).toEqual([
      '/api/articles/1',
      '/api/articles/1',
      '/api/media/7',
    ]);
  });

  it('follows only IDs retained or rewritten by native processing', async () => {
    const s = await relatedHarness();
    s.native((data) => ({ ...data, related: [3], files: [] }));
    expect((await json(await s.handle(s.request()))).data.related).toEqual([
      s.documents.get('records/3'),
    ]);
    expect(s.fetch.mock.calls.some(([url]) => (url as string).includes('/records/2?'))).toBe(false);
  });

  it('deduplicates only within this request and the same remaining depth', async () => {
    const s = await relatedHarness();
    const fields = { ...s.fields, related: [2, 2, 3], files: [7, 7] };
    const read = async () => (await json(await s.handle(s.request(fields)))).data;
    expect((await read()).related[0]).toMatchObject({ next: { title: 'Draft three' } });
    expect(
      s.fetch.mock.calls.filter(([url]) => (url as string).includes('/records/2?')),
    ).toHaveLength(1);
    expect(
      s.fetch.mock.calls.filter(([url]) => (url as string).includes('/records/3?')),
    ).toHaveLength(2);
    s.documents.delete('records/2');
    expect((await read()).related.slice(0, 2)).toEqual([2, 2]);
    expect(
      s.fetch.mock.calls.filter(([url]) => (url as string).includes('/records/2?')),
    ).toHaveLength(2);
  });

  it('does not recreate a nested field removed by related-document ACLs', async () => {
    const s = await relatedHarness();
    s.documents.set('records/2', { id: 2, title: 'Draft without next' });
    expect((await json(await s.handle(s.request()))).data.related).toEqual([
      { id: 2, title: 'Draft without next' },
    ]);
    expect(s.fetch).toHaveBeenCalledTimes(4);
  });

  it.each([403, 404])(
    'retains only IDs on related ACL refusal (%i), with no prior fields',
    async (status) => {
      const s = await relatedHarness();
      s.fetch.mockImplementation((url, init) =>
        (url as string).includes('/records/')
          ? Promise.resolve(Response.json({ errors: ['private detail'] }, { status }))
          : s.upstream(url, init),
      );
      const result = await json(await s.handle(s.request()));
      expect(result.data.related).toEqual([2]);
      expect(result.data.files).toEqual([s.documents.get('media/7')]);
      expect(JSON.stringify(result)).not.toContain('private detail');
    },
  );

  it.each([401, 429, 500])(
    'refuses the complete revision on transport/auth failure (%i)',
    async (status) => {
      const s = await relatedHarness();
      s.fetch.mockImplementation((url, init) =>
        (url as string).includes('/media/')
          ? Promise.resolve(Response.json({ errors: ['private detail'] }, { status }))
          : s.upstream(url, init),
      );
      await relatedRefusal(await s.handle(s.request()));
    },
  );

  it.each([
    { body: {} },
    { body: { id: 99 } },
    { body: { id: '2' } },
    { body: [] },
    { body: { id: 2, next: { id: 3 } } },
    { body: { id: 2, next: '../users' } },
  ])('refuses malformed/mismatched related response $body', async ({ body }) => {
    const s = await relatedHarness();
    s.fetch.mockImplementation((url, init) =>
      (url as string).includes('/records/2?')
        ? Promise.resolve(Response.json(body))
        : s.upstream(url, init),
    );
    await relatedRefusal(await s.handle(s.request()));
    expect(s.fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    { related: [{ id: 2 }] },
    { related: ['2'] },
    { related: [-1] },
    { related: [1.5] },
    { related: { collection: 'users', id: 2 } },
  ])('refuses unsupported native relation shape $related', async ({ related }) => {
    const s = await relatedHarness();
    s.native((data) => ({ ...data, related }));
    await relatedRefusal(await s.handle(s.request()));
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a published-only fallback labeled published', async () => {
    const s = await relatedHarness();
    s.documents.set('records/2', { id: 2, title: 'Published only', _status: 'published' });
    expect((await json(await s.handle(s.request()))).data.related).toEqual([
      s.documents.get('records/2'),
    ]);
  });

  it('bounds a cycle by remaining depth, without a global visited shortcut', async () => {
    const s = await relatedHarness(3);
    s.documents.set('records/3', { id: 3, title: 'Cycle', next: 2 });
    const result = await json(await s.handle(s.request()));
    expect(result.data.related).toMatchObject([{ next: { next: { next: 3 } } }]);
    expect(
      s.fetch.mock.calls.filter(([url]) => (url as string).includes('/records/2?')),
    ).toHaveLength(2);
  });

  it('refuses a whole revision before exceeding the distinct-read limit, then recovers', async () => {
    const s = await relatedHarness();
    const handle = createReferenceUnsavedHandler(s.reference, {
      ...s.options,
      relatedDrafts: { maxReads: 1 },
    });
    await relatedRefusal(await handle(s.request()));
    expect(s.fetch).toHaveBeenCalledTimes(3);
    s.fetch.mockClear();
    expect((await handle(s.request({ ...s.fields, related: [], files: [7] }, 2))).status).toBe(200);
    expect(s.fetch).toHaveBeenCalledTimes(3);
  });

  it('counts actual aggregate upstream bytes including both root reads', async () => {
    const s = await relatedHarness(1);
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
    const limit =
      bytes(s.saved) + bytes({ ...s.saved, ...s.fields }) + bytes(s.documents.get('records/2'));
    const handle = createReferenceUnsavedHandler(s.reference, {
      ...s.options,
      relatedDrafts: { maxTotalBytes: limit },
    });
    await relatedRefusal(await handle(s.request()));
    expect(s.fetch).toHaveBeenCalledTimes(4);
    const exact = createReferenceUnsavedHandler(s.reference, {
      ...s.options,
      relatedDrafts: { maxTotalBytes: limit + bytes(s.documents.get('media/7')) },
    });
    expect((await exact(s.request())).status).toBe(200);
  });

  it('refuses duplicate expansion before emitting an oversized response', async () => {
    const s = await relatedHarness(1);
    s.documents.set('records/2', { id: 2, title: 'ä'.repeat(100) });
    const handle = createReferenceUnsavedHandler(s.reference, {
      ...s.options,
      maxResponseBytes: 400,
    });
    await relatedRefusal(await handle(s.request({ ...s.fields, related: [2, 2], files: [] })));
    expect(s.fetch).toHaveBeenCalledTimes(3);
  });

  it.each([64, 65])('enforces the default read ceiling on a %i-edge chain', async (depth) => {
    const s = await relatedHarness(depth);
    for (let i = 2; i < depth + 2; i++) s.documents.set(`records/${i}`, { id: i, next: i + 1 });
    const response = await s.handle(s.request({ ...s.fields, files: [] }));
    expect(response.status).toBe(depth === 64 ? 200 : 502);
    expect(s.fetch).toHaveBeenCalledTimes(66);
    if (depth === 65) await relatedRefusal(response);
  });

  it('does not start a related fetch after its exact-target verifier refuses', async () => {
    const s = await relatedHarness();
    s.authorize.mockResolvedValueOnce({ authorized: false, outcome: 'invalid', context: null });
    await relatedRefusal(await s.handle(s.request()));
    expect(s.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['bytes', 'utf8', 'media-type'])(
    'cancels an unread related body on %s failure',
    async (failure) => {
      const s = await relatedHarness();
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(
            failure === 'utf8'
              ? new Uint8Array([0xff])
              : new TextEncoder().encode('ä'.repeat(32_769)),
          );
        },
        cancel() {
          cancelled = true;
          return new Promise<void>(() => {});
        },
      });
      s.fetch.mockImplementation((url, init) =>
        (url as string).includes('/records/2?')
          ? Promise.resolve(
              new Response(stream, {
                headers: {
                  'content-type': failure === 'media-type' ? 'text/plain' : 'application/json',
                  'content-length': '1',
                },
              }),
            )
          : s.upstream(url, init),
      );
      await relatedRefusal(await s.handle(s.request()));
      expect(cancelled).toBe(true);
      expect(stream.locked).toBe(false);
      expect(s.fetch).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    { maxReads: 0 },
    { maxReads: 65 },
    { maxReads: 1.5 },
    { maxTotalBytes: 0 },
    { maxTotalBytes: 1_048_577 },
    { maxTotalBytes: Infinity },
  ])('rejects invalid/widened reference limits %j', async (relatedDrafts) => {
    const s = await relatedHarness();
    expect(() =>
      createReferenceUnsavedHandler(s.reference, { fetch: s.fetch, relatedDrafts }),
    ).toThrow(TypeError);
    expect(s.fetch).not.toHaveBeenCalled();
  });
});
