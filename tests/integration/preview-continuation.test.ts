/**
 * ADR 0019's first application contract through real token and fragment code.
 * Principals and persistence are local fixtures; success means rendered
 * unsaved revisions, not just a response code or refresh trigger.
 */
import { describe, expect, it } from 'vitest';
import { createFragmentEndpointHandler } from '@adapters/shared/fragment-endpoint';
import { continuationHarness, CONTINUATION_SITE } from '../fixtures/preview-continuation-harness';

describe('scoped continuation reference', () => {
  it('opens a page, renders two unsaved revisions and reloads without reusing the entry', async () => {
    const h = continuationHarness();
    const token = await h.token();
    const entry = h.request(`/page?locale=de&previewToken=${token}`);
    const first = await h.reference.exchange(entry);
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe('/page?preview=true&locale=de');
    const setCookie = first.headers.get('set-cookie');
    expect(setCookie !== null).toBe(true);
    const cookie = `${h.loginCookie}; ${setCookie!.split(';')[0]!}`;
    const page = await h.reference.authorize(h.request(undefined, cookie));
    expect(page?.context.subject).toBe('editor-a');

    const handler = createFragmentEndpointHandler(
      {
        authorizePreview: async (request) =>
          (await h.reference.authorize(request))?.context ?? null,
        registry: { hero: { component: {}, props: (input) => ({ title: input.fields['title'] }) } },
        render: (_component, props) =>
          Promise.resolve(`<h1>${String(props['title']).toUpperCase()}</h1>`),
      },
      { rendererName: 'reference', render: () => Promise.resolve('') },
    );
    for (const revision of [1, 2]) {
      const response = await handler(
        new Request(`${CONTINUATION_SITE}/payload/fragment`, {
          method: 'POST',
          headers: { cookie, origin: CONTINUATION_SITE, 'content-type': 'application/json' },
          body: JSON.stringify({
            fragment: 'hero',
            route: '/page',
            search: '?preview=true&locale=de',
            revision,
            locale: 'de',
            collectionSlug: 'posts',
            fields: { id: 'post-a', title: `unsaved ${revision}` },
          }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        html: `<h1>UNSAVED ${revision}</h1>`,
        revision,
      });
    }
    const reload = await h.reference.authorize(h.request(undefined, cookie));
    expect(reload?.context.subject).toBe('editor-a');
    expect(reload?.context).not.toBe(page?.context);
    expect((await h.reference.exchange(entry)).status).toBe(403);
    expect(h.consumed.size).toBe(1);
    expect(h.records.size).toBe(1);
  });
});
