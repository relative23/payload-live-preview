import { describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint, type FragmentRegistry } from '@adapters/astro/fragments';
import { issuePreviewToken } from '@security/preview-authorization';

/**
 * ADR 0011's abuse model, verified: the endpoint renders only registered
 * boundaries, only for an authorized preview bound to the page route, only
 * from a same-origin JSON POST within limits — and says nothing useful when
 * it refuses.
 */

const SITE = 'https://site.example.com';
const SECRET = 'fragment-endpoint-secret-that-is-long-enough-1234';
const Hero = { name: 'Hero' };
const registry: FragmentRegistry = {
  hero: {
    component: Hero,
    props: (input) => ({
      title: typeof input.fields['title'] === 'string' ? input.fields['title'] : '',
      locale: input.locale,
    }),
  },
};
const render = vi.fn((component: object, props: Record<string, unknown>) =>
  Promise.resolve(`<h1>${String(props['title'])} (${(component as { name: string }).name})</h1>`),
);

async function token(path = '/page'): Promise<string> {
  return issuePreviewToken({ audience: SITE, path }, { secret: SECRET });
}

function endpoint(overrides: Record<string, unknown> = {}) {
  return createFragmentEndpoint({
    registry,
    authorize: { type: 'signed-token', secret: SECRET, audience: SITE },
    render,
    ...overrides,
  });
}

async function post(
  body: unknown,
  init: { headers?: Record<string, string>; method?: string; raw?: string } = {},
): Promise<Response> {
  return endpoint()({
    request: new Request(`${SITE}/payload/fragment`, {
      method: init.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        origin: SITE,
        ...init.headers,
      },
      ...(init.method === 'GET' ? {} : { body: init.raw ?? JSON.stringify(body) }),
    }),
  });
}

async function validBody(overrides: Record<string, unknown> = {}) {
  return {
    fragment: 'hero',
    route: '/page',
    search: `?preview=true&previewToken=${await token()}`,
    revision: 3,
    locale: 'de',
    globalSlug: 'home',
    fields: { title: 'Hallo' },
    ...overrides,
  };
}

describe('createFragmentEndpoint — the happy path', () => {
  it('renders a registered boundary for an authorized preview and answers with no-store JSON', async () => {
    const response = await post(await validBody());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-payload-fragment-version')).toBe('1');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      html: '<h1>Hallo (Hero)</h1>',
      boundary: { id: 'hero' },
      revision: 3,
      metadata: { renderer: 'custom' },
    });
    expect(render).toHaveBeenLastCalledWith(
      Hero,
      { title: 'Hallo', locale: 'de' },
      expect.objectContaining({ id: 'hero', route: '/page', globalSlug: 'home' }),
    );
  });
});

describe('createFragmentEndpoint — refusals carry no information', () => {
  it('405 for anything but POST', async () => {
    const response = await post(undefined, { method: 'GET' });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'method' });
  });

  it('403 for a cross-site fetch or a foreign origin', async () => {
    expect(
      (await post(await validBody(), { headers: { 'sec-fetch-site': 'cross-site' } })).status,
    ).toBe(403);
    expect(
      (await post(await validBody(), { headers: { origin: 'https://evil.example' } })).status,
    ).toBe(403);
  });

  it('415 for a non-JSON content type, 413 over the body limit, 400 for the wrong shape', async () => {
    expect(
      (await post(await validBody(), { headers: { 'content-type': 'text/plain' } })).status,
    ).toBe(415);
    const big = await validBody({ fields: { title: 'x'.repeat(70_000) } });
    expect((await post(big)).status).toBe(413);
    expect((await post({ fragment: '../etc/passwd' })).status).toBe(400);
    expect((await post(undefined, { raw: '{not json' })).status).toBe(413);
    const deep = await validBody({ fields: JSON.parse('{"a":'.repeat(20) + '1' + '}'.repeat(20)) });
    expect((await post(deep)).status).toBe(400);
  });

  it('403 without a valid token, and for a token issued for another route', async () => {
    const noToken = await post(await validBody({ search: '?preview=true' }));
    expect(noToken.status).toBe(403);
    expect(await noToken.json()).toEqual({ error: 'unauthorized' });
    const otherRoute = await post(
      await validBody({ search: `?preview=true&previewToken=${await token('/elsewhere')}` }),
    );
    expect(otherRoute.status).toBe(403);
    expect(render).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ route: '/elsewhere' }),
    );
  });

  it('404 for an id that is not in the registry, prototype names included', async () => {
    expect((await post(await validBody({ fragment: 'missing' }))).status).toBe(404);
    expect((await post(await validBody({ fragment: 'constructor' }))).status).toBe(404);
    expect((await post(await validBody({ fragment: 'toString' }))).status).toBe(404);
  });

  it('500 without details when the renderer throws or times out', async () => {
    const failing = createFragmentEndpoint({
      registry,
      authorize: { type: 'signed-token', secret: SECRET, audience: SITE },
      render: () => Promise.reject(new Error('template exploded: /srv/app/Hero.astro')),
    });
    const body = await validBody();
    const request = new Request(`${SITE}/payload/fragment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: SITE },
      body: JSON.stringify(body),
    });
    const response = await failing({ request });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"render"}');

    const slow = createFragmentEndpoint({
      registry,
      authorize: { type: 'signed-token', secret: SECRET, audience: SITE },
      render: () => new Promise(() => {}),
      limits: { timeoutMs: 10 },
    });
    const timedOut = await slow({
      request: new Request(`${SITE}/payload/fragment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: SITE },
        body: JSON.stringify(body),
      }),
    });
    expect(timedOut.status).toBe(500);
  });
});
