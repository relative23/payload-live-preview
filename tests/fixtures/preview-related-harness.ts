/**
 * Synthetic upstream responses isolate the related-read authority and limits.
 * The real continuation, authorizer and package reader are not replaced; real
 * database ACLs are checked by the separate retained-tarball runner.
 */
import { expect, vi } from 'vitest';
import { authorizePreviewRequest } from '@security/preview-authorization';
import { createReferenceContinuation } from './preview-continuation';
import { createReferenceUnsavedHandler } from './preview-continuation-unsaved';
import { continuationHarness, CONTINUATION_SITE } from './preview-continuation-harness';

export async function relatedHarness(depth = 2, totalTimeoutMs = 1_000) {
  const h = continuationHarness();
  const target = {
    ...h.target,
    document: { kind: 'collection' as const, slug: 'articles', id: '1' },
    depth,
  };
  const reference = createReferenceContinuation({
    ...h.options,
    totalTimeoutMs,
    binding: () => target,
  });
  const opened = await reference.exchange(
    h.request(`/page?locale=de&previewToken=${await h.token()}`),
  );
  expect(opened.status).toBe(303);
  const cookie = `${h.loginCookie}; ${opened.headers.get('set-cookie')!.split(';')[0]!}`;
  const saved = { id: 1, owner: 'a', title: 'Saved', related: [], files: [] };
  const fields = { title: 'Unsaved Ä', related: [2], files: [7] };
  const documents = new Map<string, Record<string, unknown>>([
    ['records/2', { id: 2, title: 'Draft two', _status: 'draft', next: 3 }],
    ['records/3', { id: 3, title: 'Draft three', _status: 'draft', next: null }],
    ['media/7', { id: 7, title: 'Draft file', _status: 'draft' }],
  ]);
  let native = (data: Record<string, unknown>): Record<string, unknown> => data;
  const upstream: typeof globalThis.fetch = (url, init) => {
    if (typeof url !== 'string') throw new Error('Expected URL string');
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as { data: Record<string, unknown> };
      return Promise.resolve(Response.json(native(body.data)));
    }
    const key = new URL(url).pathname.slice('/api/'.length);
    if (key === 'articles/1') return Promise.resolve(Response.json(saved));
    const data = documents.get(key);
    return Promise.resolve(
      Response.json(data ?? { errors: ['Denied'] }, { status: data ? 200 : 404 }),
    );
  };
  const fetch = vi.fn(upstream);
  const authorize = vi.fn(authorizePreviewRequest);
  const options = { fetch, relatedDrafts: { authorizeRequest: authorize } };
  return {
    h,
    target,
    reference,
    saved,
    fields,
    documents,
    fetch,
    upstream,
    authorize,
    options,
    native: (process: typeof native) => {
      native = process;
    },
    handle: createReferenceUnsavedHandler(reference, options),
    request: (data = fields, revision = 1, signal?: AbortSignal) =>
      new Request(h.request(undefined, cookie), {
        method: 'POST',
        headers: { cookie, origin: CONTINUATION_SITE, 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, revision, data }),
        ...(signal ? { signal } : {}),
      }),
  };
}

export async function relatedRefusal(response: Response, status = 502) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(await response.json()).toEqual({
    version: 1,
    ok: false,
    error: status === 403 ? 'forbidden' : 'unavailable',
  });
}
