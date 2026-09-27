/**
 * Uses existing built public entries, separately from source-only npm check.
 * This is not a clean tarball installation or a native Next production build.
 */
import { describe, expect, it } from 'vitest';
import { continuationHarness, CONTINUATION_SITE } from '../fixtures/preview-continuation-harness';
import { createReferenceContinuation } from '../fixtures/preview-continuation';
import { createReferenceDataHandler } from '../fixtures/preview-continuation-data';

describe('built-entry continuation composition', () => {
  it('reads through the built public server entry inside the reference data envelope', async () => {
    const { authorizePreviewRequest, definePreview } = await import('payload-live-preview/server');
    const h = continuationHarness();
    const reference = createReferenceContinuation({
      ...h.options,
      authorizeRequest: authorizePreviewRequest,
    });
    const entry = await reference.exchange(
      h.request(`/page?locale=de&previewToken=${await h.token()}`),
    );
    expect(entry.status).toBe(303);
    const cookie = `${h.loginCookie}; ${entry.headers.get('set-cookie')!.split(';')[0]!}`;
    const handler = createReferenceDataHandler(reference, {
      define: definePreview,
      fetch: () => Promise.resolve(Response.json({ id: 'post-a', errors: ['A real field'] })),
    });
    const response = await handler(h.request(undefined, cookie));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      version: 1,
      ok: true,
      data: { id: 'post-a', errors: ['A real field'] },
    });
    h.records.clear();
    expect((await handler(h.request(undefined, cookie))).status).toBe(403);
  });

  it('composes the built public server and Next fragment entries with no new token or strategy', async () => {
    const { authorizePreviewRequest } = await import('payload-live-preview/server');
    const { createFragmentEndpoint } = await import('payload-live-preview/nextjs');
    const h = continuationHarness();
    const reference = createReferenceContinuation({
      ...h.options,
      authorizeRequest: authorizePreviewRequest,
    });
    const token = await h.token();
    const entry = await reference.exchange(h.request(`/page?locale=de&previewToken=${token}`));
    expect(entry.status).toBe(303);
    const cookie = `${h.loginCookie}; ${entry.headers.get('set-cookie')!.split(';')[0]!}`;
    const handler = createFragmentEndpoint({
      authorizePreview: async (request) => (await reference.authorize(request))?.context ?? null,
      registry: {
        hero: { component: () => null, props: (input) => ({ title: input.fields['title'] }) },
      },
      render: (_component, props) => Promise.resolve(`<h1>${String(props['title'])}</h1>`),
    });
    const response = await handler(
      new Request(`${CONTINUATION_SITE}/payload/fragment`, {
        method: 'POST',
        headers: { cookie, origin: CONTINUATION_SITE, 'content-type': 'application/json' },
        body: JSON.stringify({
          fragment: 'hero',
          route: '/page',
          search: '?locale=de',
          locale: 'de',
          revision: 7,
          collectionSlug: 'posts',
          fields: { id: 'post-a', title: 'Unsaved public-entry revision' },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      html: '<h1>Unsaved public-entry revision</h1>',
      revision: 7,
    });
  });
});
