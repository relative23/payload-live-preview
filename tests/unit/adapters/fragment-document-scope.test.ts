import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFragmentEndpointHandler } from '@adapters/shared/fragment-endpoint';
import { scopedClaims, scopedContext, SCOPE_CMS, SCOPE_SITE } from '../../fixtures/scoped-preview';

afterEach(() => vi.useRealTimers());

describe('fragment document capability', () => {
  it.each(['props', 'render'])(
    'refuses expiry during %s, before a successful response',
    async (phase) => {
      vi.useFakeTimers();
      const expiresAt = Date.now() + 50;
      const context = await scopedContext({ ...scopedClaims(), expiresAt });
      const props = vi.fn(() => {
        if (phase === 'props') vi.setSystemTime(expiresAt);
        return {};
      });
      const render = vi.fn(() => {
        vi.setSystemTime(expiresAt);
        return Promise.resolve('<h1>late</h1>');
      });
      const endpoint = createFragmentEndpointHandler(
        { registry: { hero: { component: {}, props } }, authorizePreview: () => context },
        { rendererName: 'test', render },
      );
      const response = await endpoint(fragmentRequest());
      expect(response.status).toBe(403);
      if (phase === 'props') expect(render).not.toHaveBeenCalled();
    },
  );

  it.each([0, '0'])(
    'renders an unsaved revision for the exact numeric document (%s)',
    async (id) => {
      const claims = scopedClaims();
      const context = await scopedContext({
        ...claims,
        scope: {
          ...claims.scope,
          payload: {
            serverURL: SCOPE_CMS,
            document: { kind: 'collection', slug: 'posts', id: 0 },
            maxDepth: 0,
          },
        },
      });
      const endpoint = createFragmentEndpointHandler(
        {
          registry: {
            hero: { component: {}, props: (input) => ({ title: input.fields['title'] }) },
          },
          authorizePreview: () => context,
        },
        {
          rendererName: 'test',
          render: (_component, props) => Promise.resolve(`<h1>${String(props['title'])}</h1>`),
        },
      );
      const response = await endpoint(fragmentRequest({ fields: { id, title: 'UNSAVED' } }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ html: '<h1>UNSAVED</h1>', revision: 1 });
    },
  );

  it.each([
    ['valid', {}, 200],
    ['explicit identity', { fields: { globalType: 'homepage' } }, 200],
    ['other global', { globalSlug: 'other' }, 403],
    ['wrong explicit identity', { fields: { globalType: 'other' } }, 403],
    ['invalid explicit identity', { fields: { globalType: null } }, 403],
  ])('checks global scope: %s', async (_label, change, status) => {
    const claims = scopedClaims();
    const context = await scopedContext({
      ...claims,
      scope: {
        ...claims.scope,
        payload: {
          serverURL: SCOPE_CMS,
          document: { kind: 'global', slug: 'homepage' },
          maxDepth: 0,
        },
      },
    });
    const props = vi.fn(() => ({}));
    const endpoint = createFragmentEndpointHandler(
      { registry: { hero: { component: {}, props } }, authorizePreview: () => context },
      { rendererName: 'test', render: () => Promise.resolve('<h1>global</h1>') },
    );
    const response = await endpoint(
      fragmentRequest({ collectionSlug: undefined, globalSlug: 'homepage', ...change }),
    );
    expect(response.status).toBe(status);
    expect(props).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
  });
  it.each([
    ['other document', { fields: { id: 'post-b', title: 'unsaved' } }],
    ['missing identity', { fields: { title: 'unsaved' } }],
    ['non-scalar identity', { fields: { id: ['post-a'] } }],
    ['other collection', { collectionSlug: 'users' }],
    ['missing collection', { collectionSlug: undefined }],
    ['ambiguous kind', { globalSlug: 'homepage' }],
    ['other route', { route: '/other' }],
  ])('refuses %s before props or renderer', async (_label, change) => {
    const props = vi.fn(() => ({ title: 'not allowed' }));
    const render = vi.fn(() => Promise.resolve('<h1>not allowed</h1>'));
    const context = await scopedContext();
    const endpoint = createFragmentEndpointHandler(
      { registry: { hero: { component: {}, props } }, authorizePreview: () => context },
      { rendererName: 'test', render },
    );
    const response = await endpoint(
      new Request(`${SCOPE_SITE}/payload/fragment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: SCOPE_SITE },
        body: JSON.stringify({
          fragment: 'hero',
          route: '/preview',
          search: '?locale=de',
          revision: 1,
          locale: 'de',
          collectionSlug: 'posts',
          fields: { id: 'post-a', title: 'unsaved' },
          ...change,
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(props).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});

function fragmentRequest(change: Record<string, unknown> = {}): Request {
  return new Request(`${SCOPE_SITE}/payload/fragment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SCOPE_SITE },
    body: JSON.stringify({
      fragment: 'hero',
      route: '/preview',
      search: '?locale=de',
      revision: 1,
      locale: 'de',
      collectionSlug: 'posts',
      fields: { id: 'post-a', title: 'unsaved' },
      ...change,
    }),
  });
}
