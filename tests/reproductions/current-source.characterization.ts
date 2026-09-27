/**
 * Direct-source characterizations for reproduced handoff findings and focused
 * after-fix assertions for the batches already implemented. These checks are
 * evidence about the current worktree, not the final release candidate.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElementCache } from '@core/cache';
import { DataMerger } from '@core/data-merger';
import { registerRouteRefresh } from '@core/route-refresh';
import { createFieldAddressability, unboundChangedFields } from '@core/unbound-fields';
import type { RouteContext } from '@core/strategies';
import { createFragmentEndpointHandler } from '@adapters/shared/fragment-endpoint';
import { authorizePreviewRequest, definePreview, issuePreviewToken } from '@/server/index';
import {
  createFragmentHandler,
  createRouteStrategy,
  type FragmentBoundary,
  type StrategyRequest,
} from '@fragment/index';

const SITE = 'https://site.example.com';
const SECRET = 'hardening-reproduction-secret-at-least-32-bytes';

afterEach(() => {
  document.head.innerHTML = '';
});

function routeContext(): RouteContext {
  return {
    revision: 7,
    receivedAt: 1,
    signal: new AbortController().signal,
    isCurrent: () => true,
    log: () => undefined,
  };
}

function page(body: string, head = '<title>Preview</title>'): Response {
  return new Response(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function boundary(id: string, key?: string): FragmentBoundary {
  return {
    element: document.createElement('section'),
    id,
    key,
    dependsOn: [],
  };
}

function strategyRequest(overrides: Partial<StrategyRequest> = {}): StrategyRequest {
  return {
    revision: 7,
    receivedAt: 1,
    fields: { title: 'Unsaved' },
    locale: undefined,
    collectionSlug: undefined,
    globalSlug: 'homepage',
    signal: new AbortController().signal,
    ...overrides,
  };
}

function fragmentResponse(id: string, key?: string): Response {
  return new Response(
    JSON.stringify({
      html: `<p>${id}</p>`,
      boundary: { id, ...(key === undefined ? {} : { key }) },
      revision: 7,
      metadata: { renderedAt: '2026-09-22T00:00:00.000Z', renderer: 'reproduction' },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

const endpointBinding = {
  rendererName: 'reproduction',
  render: (_component: object, props: Record<string, unknown>) => {
    const title = props['title'];
    return Promise.resolve(`<p>${typeof title === 'string' ? title : ''}</p>`);
  },
};

function validFragmentBody(
  search: string,
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    fragment: 'hero',
    route: '/page',
    search,
    revision: 7,
    globalSlug: 'homepage',
    fields,
  };
}

function fragmentRequest(
  body: Readonly<Record<string, unknown>>,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(`${SITE}/payload/fragment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, ...headers },
    body: JSON.stringify(body),
  });
}

function atomicReplayStore(): {
  readonly consume: ReturnType<typeof vi.fn<(id: string, expiresAt: number) => boolean>>;
} {
  const used = new Set<string>();
  return {
    consume: vi.fn((id: string) => {
      if (used.has(id)) return false;
      used.add(id);
      return true;
    }),
  };
}

describe('handoff current-source characterizations', () => {
  it('[H01-AFTER] the snapshot-free route GET reports partial fidelity', async () => {
    document.body.innerHTML = '<main><p>saved false</p></main>';
    const fetchFn = vi.fn(() => Promise.resolve(page('<main><p>saved false</p></main>')));
    const strategy = createRouteStrategy({
      fetch: fetchFn,
      location: { href: `${SITE}/page?preview=true` },
      window: { scrollX: 0, scrollY: 0, scrollTo: () => undefined },
      minIntervalMs: 0,
    });

    expect(await strategy.refresh(routeContext())).toBe('partial');
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('[H02-CURRENT] one nested binding marks the whole top-level group addressable', () => {
    document.body.innerHTML = '<span data-payload-field="hero.eyebrow">bound</span>';
    const cache = new ElementCache();
    cache.buildFromRoot(document);
    const addressable = createFieldAddressability(cache, undefined, false);

    expect(addressable('hero')).toBe(true);
    expect(cache.get('hero.description')).toBeUndefined();
    expect(unboundChangedFields(cache, new Set(['hero']), undefined, false)).toEqual([]);
  });

  it('[H03-AFTER] the request cap refuses JSON whose UTF-8 bytes exceed the configured limit', async () => {
    const fields = { title: 'ä'.repeat(96) };
    const raw = JSON.stringify(validFragmentBody('?preview=true', fields));
    const bytes = new TextEncoder().encode(raw).byteLength;
    expect(bytes).toBeGreaterThan(raw.length);

    const handler = createFragmentEndpointHandler(
      {
        registry: {
          hero: {
            component: {},
            props: (input) => ({ title: input.fields['title'] }),
          },
        },
        authorize: { type: 'verifier', verify: () => ({ subject: 'editor' }) },
        limits: { bodyBytes: raw.length },
      },
      endpointBinding,
    );
    const response = await handler(
      new Request(`${SITE}/payload/fragment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: SITE },
        body: raw,
      }),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'body' });
  });

  it('[H04-CURRENT] a consumed query entry token refuses every fragment continuation', async () => {
    const replay = atomicReplayStore();
    const token = await issuePreviewToken({ audience: SITE, path: '/page' }, { secret: SECRET });
    const strategy = { type: 'signed-token', secret: SECRET, audience: SITE, replay } as const;
    const search = `?preview=true&previewToken=${token}`;

    const pageVerdict = await authorizePreviewRequest(
      new Request(`${SITE}/page${search}`),
      strategy,
    );
    expect(pageVerdict.outcome).toBe('authorized');

    const handler = createFragmentEndpointHandler(
      {
        registry: { hero: { component: {}, props: () => ({ title: 'hero' }) } },
        authorize: strategy,
      },
      endpointBinding,
    );
    const firstFragment = await handler(
      fragmentRequest(validFragmentBody(search, { title: 'Unsaved 1' })),
    );
    const secondFragment = await handler(
      fragmentRequest(validFragmentBody(search, { title: 'Unsaved 2' })),
    );

    expect(firstFragment.status).toBe(403);
    expect(await firstFragment.json()).toEqual({ error: 'unauthorized' });
    expect(secondFragment.status).toBe(403);
    expect(await secondFragment.json()).toEqual({ error: 'unauthorized' });
    expect(replay.consume).toHaveBeenCalledTimes(3);
  });

  it('[H04-CURRENT] a consumed header entry token has the same fragment conflict', async () => {
    const replay = atomicReplayStore();
    const token = await issuePreviewToken({ audience: SITE, path: '/page' }, { secret: SECRET });
    const strategy = {
      type: 'signed-token',
      secret: SECRET,
      audience: SITE,
      transport: { kind: 'header', name: 'x-preview-token' },
      replay,
    } as const;
    const carrier = { 'x-preview-token': token };

    expect(
      (await authorizePreviewRequest(new Request(`${SITE}/page`, { headers: carrier }), strategy))
        .outcome,
    ).toBe('authorized');
    const handler = createFragmentEndpointHandler(
      {
        registry: { hero: { component: {}, props: () => ({ title: 'hero' }) } },
        authorize: strategy,
      },
      endpointBinding,
    );
    const fragment = await handler(
      fragmentRequest(validFragmentBody('?preview=true', { title: 'Unsaved' }), carrier),
    );

    expect(fragment.status).toBe(403);
    expect(await fragment.json()).toEqual({ error: 'unauthorized' });
    expect(replay.consume).toHaveBeenCalledTimes(2);
  });

  it('[H04-CURRENT] path refusal does not consume or broaden a route-bound token', async () => {
    const replay = atomicReplayStore();
    const token = await issuePreviewToken({ audience: SITE, path: '/page' }, { secret: SECRET });
    const strategy = { type: 'signed-token', secret: SECRET, audience: SITE, replay } as const;
    const search = `?previewToken=${token}`;
    const handler = createFragmentEndpointHandler(
      {
        registry: { hero: { component: {}, props: () => ({ title: 'hero' }) } },
        authorize: strategy,
      },
      endpointBinding,
    );

    const wrongRoute = await handler(
      fragmentRequest({
        ...validFragmentBody(search, { title: 'Wrong route' }),
        route: '/other',
      }),
    );
    const firstCorrectRoute = await handler(
      fragmentRequest(validFragmentBody(search, { title: 'Correct route' })),
    );
    const replayedCorrectRoute = await handler(
      fragmentRequest(validFragmentBody(search, { title: 'Replayed route' })),
    );

    expect(wrongRoute.status).toBe(403);
    expect(firstCorrectRoute.status).toBe(200);
    expect(replayedCorrectRoute.status).toBe(403);
    expect(replay.consume).toHaveBeenCalledTimes(2);
  });

  it('[H04-CURRENT] a Payload session is reverified per request without one-time consumption', async () => {
    const fetchMe = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ user: { id: 'editor-1' }, collection: 'users' }),
      }),
    );
    const strategy = {
      type: 'payload-session',
      serverURL: 'https://cms.example.com',
      fetch: fetchMe,
    } as const;
    const cookie = { cookie: 'payload-token=session-1' };

    expect(
      (await authorizePreviewRequest(new Request(`${SITE}/page`, { headers: cookie }), strategy))
        .outcome,
    ).toBe('authorized');
    const handler = createFragmentEndpointHandler(
      {
        registry: { hero: { component: {}, props: () => ({ title: 'hero' }) } },
        authorize: strategy,
      },
      endpointBinding,
    );
    const firstFragment = await handler(
      fragmentRequest(validFragmentBody('?preview=true', { title: 'Unsaved 1' }), cookie),
    );
    const secondFragment = await handler(
      fragmentRequest(validFragmentBody('?preview=true', { title: 'Unsaved 2' }), cookie),
    );

    expect(firstFragment.status).toBe(200);
    expect(secondFragment.status).toBe(200);
    expect(fetchMe).toHaveBeenCalledTimes(3);
  });

  it('[H04/H11-AFTER] a locale-scoped verdict refuses a fragment that omits locale', async () => {
    const handler = createFragmentEndpointHandler(
      {
        registry: { hero: { component: {}, props: () => ({ title: 'hero' }) } },
        authorize: {
          type: 'verifier',
          verify: () => ({ subject: 'editor', scope: { locale: 'de' } }),
        },
      },
      endpointBinding,
    );

    const response = await handler(
      fragmentRequest(validFragmentBody('?preview=true', { title: 'Unsaved' })),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  it('[H06-AFTER] a response with the right id but wrong key is rejected as LP0802', async () => {
    const handler = createFragmentHandler({
      endpoint: '/payload/fragment',
      location: { pathname: '/page', search: '?preview=true' },
      fetch: () => Promise.resolve(fragmentResponse('hero', 'k2')),
    });

    expect(await handler(strategyRequest(), boundary('hero', 'k1'))).toEqual({
      status: 'failed',
      code: 'LP0802',
      reason: 'response is for another boundary',
    });
  });

  it('[H08-AFTER] head sync removes stale attributes and preserves duplicate metadata order', async () => {
    document.head.innerHTML =
      '<title>Old</title>' +
      '<meta name="description" content="old" data-stale="yes">' +
      '<meta property="og:image" content="/old-a.png">' +
      '<meta property="og:image" content="/old-b.png">';
    document.body.innerHTML = '<main>old</main>';
    const strategy = createRouteStrategy({
      fetch: () =>
        Promise.resolve(
          page(
            '<main>fresh</main>',
            '<title>Fresh</title>' +
              '<meta name="description" content="fresh">' +
              '<meta property="og:image" content="/new-a.png">' +
              '<meta property="og:image" content="/new-b.png">',
          ),
        ),
      location: { href: `${SITE}/page` },
      window: { scrollX: 0, scrollY: 0, scrollTo: () => undefined },
      minIntervalMs: 0,
    });

    expect(await strategy.refresh(routeContext())).toBe('partial');
    expect(document.querySelector('meta[name="description"]')?.hasAttribute('data-stale')).toBe(
      false,
    );
    expect(
      Array.from(document.querySelectorAll('meta[property="og:image"]'), (element) =>
        element.getAttribute('content'),
      ),
    ).toEqual(['/new-a.png', '/new-b.png']);
  });

  it('[H11-CURRENT] an authorized initial read does not authorize the browser merge', async () => {
    const cms = 'https://cms.example.com';
    const verdict = await authorizePreviewRequest(new Request(`${SITE}/page?preview=true`), {
      type: 'verifier',
      verify: () => ({
        subject: 'editor-a',
        payloadHeaders: { authorization: 'Bearer editor-a' },
      }),
    });
    if (!verdict.authorized) throw new Error('expected an authorized preview context');

    const initialFetch = vi.fn((_: string, init: { readonly headers: Record<string, string> }) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ docs: [{ id: 'page-1', author: { id: 'author-1' } }] }),
        requestHeaders: init.headers,
      }),
    );
    const preview = definePreview({ serverURL: cms, depth: 2, fetch: initialFetch });
    await preview.fetchDocument({
      collection: 'pages',
      locale: 'de',
      authorization: verdict.context,
    });

    const mergeFetch = vi.fn<typeof fetch>((_url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      const authenticated = headers?.['authorization'] === 'Bearer editor-a';
      return Promise.resolve(
        new Response(authenticated ? JSON.stringify({ id: 'page-1' }) : 'forbidden', {
          status: authenticated ? 200 : 403,
        }),
      );
    });
    const merger = new DataMerger({
      serverURL: preview.runtimeOptions.serverURL,
      apiRoute: preview.runtimeOptions.apiRoute,
      depth: preview.runtimeOptions.mergeDepth,
      fetchFn: mergeFetch,
    });
    const merged = await merger.merge({
      collectionSlug: 'pages',
      data: { id: 'page-1', author: 'author-2', heroImage: 'media-2' },
      locale: 'de',
    });

    expect(initialFetch.mock.calls[0]?.[1].headers['authorization']).toBe('Bearer editor-a');
    const mergeInit = mergeFetch.mock.calls[0]?.[1];
    expect(mergeInit?.credentials).toBe('include');
    expect(mergeInit?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Payload-HTTP-Method-Override': 'GET',
    });
    if (typeof mergeInit?.body !== 'string') throw new Error('expected a serialized merge body');
    expect(JSON.parse(mergeInit.body)).toMatchObject({ depth: 2, locale: 'de' });
    expect(merged).toEqual({ status: 'unavailable' });
  });

  it('[H15-CURRENT] a void host refresh is acknowledged before its later commit', async () => {
    document.body.innerHTML = '<main data-testid="route-state">old route</main>';
    let commit = (): void => undefined;
    const refresh = vi.fn(() => {
      // This is the contract a router with a fire-and-forget refresh exposes:
      // dispatch returns now, while its framework commit happens later.
      commit = () => {
        document.body.innerHTML = '<main data-testid="route-state">fresh route</main>';
      };
    });
    const undo = registerRouteRefresh(refresh);
    const strategy = createRouteStrategy({ minIntervalMs: 0, timeoutMs: 25 });

    try {
      expect(await strategy.refresh(routeContext())).toBe('partial');
      expect(refresh).toHaveBeenCalledOnce();
      expect(document.body.textContent).toContain('old route');

      commit();
      expect(document.body.textContent).toContain('fresh route');
    } finally {
      undo();
    }
  });

  it('[H14-AFTER] an aborted queued request settles before the active permit is released', async () => {
    let releaseFirst = (): void => undefined;
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          releaseFirst = () => resolve(fragmentResponse('first'));
        }),
    );
    const handler = createFragmentHandler({
      endpoint: '/payload/fragment',
      location: { pathname: '/page', search: '?preview=true' },
      maxConcurrent: 1,
      fetch: fetchFn,
    });
    const active = handler(strategyRequest(), boundary('first'));
    const queuedController = new AbortController();
    const queued = handler(
      strategyRequest({ signal: queuedController.signal }),
      boundary('second'),
    );
    try {
      queuedController.abort();
      await expect(queued).resolves.toEqual({ status: 'superseded' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      releaseFirst();
    }
    await expect(active).resolves.toMatchObject({ status: 'rendered' });
  });
});
