import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  definePreview,
  PreviewFetchError,
  type PreviewServerConfig,
  type ReadDocumentOptions,
} from '@/server/index';
import { scopedClaims, scopedContext, SCOPE_CMS } from '../../fixtures/scoped-preview';

function fixture(config: Partial<PreviewServerConfig> = {}, body: unknown = { id: 'post-a' }) {
  const fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }),
  );
  const onDiagnostic = vi.fn();
  const preview = definePreview({ serverURL: SCOPE_CMS, depth: 1, fetch, onDiagnostic, ...config });
  return { preview, fetch, onDiagnostic };
}

afterEach(() => vi.useRealTimers());

describe('scoped Payload reads', () => {
  it('refuses a scoped query before traversing any filter tree', async () => {
    const where: Record<string, unknown> = {};
    where['and'] = where;
    const { preview, fetch } = fixture();
    await expect(
      preview.fetchDocument({
        collection: 'posts',
        locale: 'de',
        authorization: await scopedContext(),
        where,
      } as ReadDocumentOptions),
    ).resolves.toMatchObject({ ok: false, reason: 'scope' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the bound depth when the original config object changes', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'post-a' }),
      }),
    );
    const config = { serverURL: SCOPE_CMS, depth: 1, fetch };
    const preview = definePreview(config);
    config.depth = 99;
    await preview.fetchDocument({
      collection: 'posts',
      id: 'post-a',
      locale: 'de',
      authorization: await scopedContext(),
    });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('depth=1&'), expect.anything());
    expect(preview.runtimeOptions.mergeDepth).toBe(1);
  });

  it('keeps verified headers authoritative regardless of header casing', async () => {
    const { preview, fetch } = fixture();
    await preview.fetchDocument({
      collection: 'posts',
      id: 'post-a',
      locale: 'de',
      authorization: await scopedContext(),
      headers: { Cookie: 'payload-token=other-user' },
    });
    const call = (
      fetch.mock.calls as unknown as [string, { headers: Record<string, string> }][]
    )[0]!;
    expect(new Headers(call[1].headers).get('cookie')).toBe('payload-token=scoped-test-user');
  });

  it.each(['fetch', 'body'])('does not return data after expiry during %s', async (phase) => {
    vi.useFakeTimers();
    const claims = scopedClaims();
    const authorization = await scopedContext(claims);
    const json = vi.fn(() => {
      vi.setSystemTime(claims.expiresAt!);
      return Promise.resolve({ id: 'post-a' });
    });
    const fetch = vi.fn(() => {
      if (phase === 'fetch') vi.setSystemTime(claims.expiresAt!);
      return Promise.resolve({
        ok: true,
        status: 200,
        json,
      });
    });
    const { preview } = fixture({ fetch });
    expect(
      await preview.fetchDocument({
        collection: 'posts',
        id: 'post-a',
        locale: 'de',
        authorization,
      }),
    ).toMatchObject({ ok: false, reason: 'scope' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledTimes(phase === 'fetch' ? 0 : 1);
  });

  it.each(['https', 'http'])(
    'accepts an explicitly bound %s base path and custom API route',
    async (scheme) => {
      const serverURL = `${scheme}://cms.example.test/tenant/v2`;
      const claims = scopedClaims();
      const authorization = await scopedContext({
        ...claims,
        scope: {
          payload: {
            ...claims.scope!.payload!,
            serverURL: serverURL + '///',
            apiRoute: 'rest/v1/',
          },
        },
      });
      const { preview, fetch } = fixture({ serverURL: serverURL + '///', apiRoute: '/rest/v1' });
      // No locale binding means the application explicitly allowed its locales.
      expect(
        await preview.fetchDocument({
          collection: 'posts',
          id: 'post-a',
          locale: 'en',
          authorization,
        }),
      ).toMatchObject({ ok: true });
      expect(fetch).toHaveBeenCalledWith(
        serverURL + '/rest/v1/posts/post-a?depth=1&draft=true&locale=en',
        expect.anything(),
      );
    },
  );

  it.each([null, { id: 'post-b' }, { errors: ['denied'] }])(
    'refuses a response outside the collection binding (%j)',
    async (body) => {
      const { preview } = fixture({}, body);
      expect(
        await preview.fetchDocument({
          collection: 'posts',
          id: 'post-a',
          locale: 'de',
          authorization: await scopedContext(),
        }),
      ).toMatchObject({ ok: false, reason: 'scope' });
    },
  );
  it('reads only the explicit document endpoint and forwards the verified user', async () => {
    const { preview, fetch } = fixture();
    const result = await preview.fetchDocument({
      collection: 'posts',
      id: 'post-a',
      locale: 'de',
      authorization: await scopedContext(),
    });
    expect(result).toEqual({ ok: true, data: { id: 'post-a' }, draft: true, status: 200 });
    expect(fetch).toHaveBeenCalledWith(
      `${SCOPE_CMS}/api/posts/post-a?depth=1&draft=true&locale=de`,
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
        headers: { accept: 'application/json', cookie: 'payload-token=scoped-test-user' },
      }),
    );
  });

  it.each([
    ['ID', { id: 'post-b' }],
    ['missing ID', { id: undefined }],
    ['collection', { collection: 'users' }],
    ['locale', { locale: 'en' }],
    ['missing locale', { locale: undefined }],
    ['query selection', { where: { id: { equals: 'post-a' } } }],
  ] as const)('refuses a mismatched %s before forwarding any headers', async (_label, change) => {
    const { preview, fetch, onDiagnostic } = fixture();
    const options = {
      collection: 'posts',
      id: 'post-a',
      locale: 'de',
      authorization: await scopedContext(),
      ...change,
    } as ReadDocumentOptions;
    expect(await preview.fetchDocument(options)).toMatchObject({
      ok: false,
      reason: 'scope',
      draft: true,
      status: undefined,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: 'failure', reason: 'scope' }),
    );
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('scoped-test-user');
  });

  it.each([
    ['server', { serverURL: 'https://foreign.example.test' }],
    ['base path', { serverURL: `${SCOPE_CMS}/other` }],
    ['API route', { apiRoute: '/other-api' }],
    ['depth', { depth: 2 }],
  ])('refuses a different %s', async (_label, config) => {
    const { preview, fetch } = fixture(config);
    expect(
      await preview.fetchDocument({
        collection: 'posts',
        id: 'post-a',
        locale: 'de',
        authorization: await scopedContext(),
      }),
    ).toMatchObject({ ok: false, reason: 'scope' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not turn a collection capability into a global read', async () => {
    const { preview, fetch } = fixture();
    expect(
      await preview.fetchGlobal({
        global: 'posts',
        locale: 'de',
        authorization: await scopedContext(),
      }),
    ).toMatchObject({ ok: false, reason: 'scope' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts exactly the bound global and refuses other globals and collections', async () => {
    const claims = scopedClaims();
    const authorization = await scopedContext({
      ...claims,
      scope: {
        ...claims.scope,
        payload: {
          serverURL: SCOPE_CMS,
          document: { kind: 'global', slug: 'homepage' },
          maxDepth: 1,
        },
      },
    });
    const { preview, fetch } = fixture({}, { globalType: 'homepage', title: 'draft' });
    expect(
      await preview.fetchGlobal({ global: 'homepage', locale: 'de', authorization }),
    ).toMatchObject({ ok: true, data: { title: 'draft' } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      await preview.fetchGlobal({ global: 'other', locale: 'de', authorization }),
    ).toMatchObject({ ok: false, reason: 'scope' });
    expect(
      await preview.fetchDocument({
        collection: 'homepage',
        id: 'post-a',
        locale: 'de',
        authorization,
      }),
    ).toMatchObject({ ok: false, reason: 'scope' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, 42, 'not a document', []])(
    'refuses a global response that is not a document (%j)',
    async (body) => {
      const claims = scopedClaims();
      const authorization = await scopedContext({
        ...claims,
        scope: {
          ...claims.scope,
          payload: {
            serverURL: SCOPE_CMS,
            document: { kind: 'global', slug: 'homepage' },
            maxDepth: 1,
          },
        },
      });
      const { preview } = fixture({}, body);
      expect(
        await preview.fetchGlobal({ global: 'homepage', locale: 'de', authorization }),
      ).toMatchObject({ ok: false, reason: 'scope' });
    },
  );

  it('rechecks expiry instead of reusing a once-valid capability', async () => {
    vi.useFakeTimers();
    const claims = scopedClaims();
    const authorization = await scopedContext(claims);
    vi.setSystemTime(claims.expiresAt!);
    const { preview, fetch } = fixture();
    expect(
      await preview.fetchDocument({
        collection: 'posts',
        id: 'post-a',
        locale: 'de',
        authorization,
      }),
    ).toMatchObject({ ok: false, reason: 'scope' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('supports throwing refusals without making a request', async () => {
    const { preview, fetch } = fixture();
    await expect(
      preview.fetchDocument({
        collection: 'other',
        id: 'post-a',
        locale: 'de',
        authorization: await scopedContext(),
        errorMode: 'throw',
      }),
    ).rejects.toBeInstanceOf(PreviewFetchError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
