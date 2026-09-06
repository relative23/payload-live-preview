import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint } from '@adapters/nuxt/fragments';
import { issuePreviewToken } from '@security/preview-authorization';
import { resetDevWarnings } from '@adapters/shared/dev-warning';

/**
 * The same endpoint as the other three, rendering through Vue. `vue` is an
 * optional peer this package does not install, so both halves of its SSR are
 * stood in for here.
 */
const vue = vi.hoisted(() => ({
  createSSRApp: vi.fn((component: unknown, props: Record<string, unknown>) => ({
    component,
    props,
  })),
}));
const renderer = vi.hoisted(() => ({
  renderToString: vi.fn((app: { props: Record<string, unknown> }) =>
    Promise.resolve(`<h1>${String(app.props['title'])}</h1>`),
  ),
}));
vi.mock('vue', () => vue);
vi.mock('vue/server-renderer', () => renderer);

const SITE = 'https://site.example.com';
const SECRET = 'fragment-endpoint-secret-that-is-long-enough-1234';

/** A single-file component compiles to an options object; the registry passes it through. */
const Hero = { name: 'Hero' };

function endpoint(overrides: Record<string, unknown> = {}) {
  return createFragmentEndpoint({
    registry: {
      hero: {
        component: Hero,
        props: ({ fields }) => ({
          title: typeof fields['title'] === 'string' ? fields['title'] : '',
        }),
      },
    },
    authorize: { type: 'signed-token', secret: SECRET, audience: SITE },
    ...overrides,
  });
}

async function post(fragment = 'hero', overrides: Record<string, unknown> = {}): Promise<Response> {
  const previewToken = await issuePreviewToken(
    { audience: SITE, path: '/page' },
    { secret: SECRET },
  );
  return endpoint(overrides)(
    new Request(`${SITE}/payload/fragment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        origin: SITE,
      },
      body: JSON.stringify({
        fragment,
        route: '/page',
        search: `?previewToken=${previewToken}`,
        revision: 1,
        globalSlug: 'home',
        fields: { title: 'From the form' },
      }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDevWarnings();
});

describe('createFragmentEndpoint — Nuxt', () => {
  it('takes a Request, as the Nitro wrapper hands it, and renders the component', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { html: string; metadata: { renderer: string } };
    expect(body.html).toBe('<h1>From the form</h1>');
    expect(body.metadata.renderer).toBe('vue-server-renderer');
    expect(vue.createSSRApp).toHaveBeenCalledWith(Hero, { title: 'From the form' });
  });

  it('builds one app per render, because an app carries the props it was created with', async () => {
    await post();
    await post();

    expect(vue.createSSRApp).toHaveBeenCalledTimes(2);
  });

  it('refuses a fragment id the registry does not contain, without saying more', async () => {
    const response = await post('not-registered');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'fragment' });
  });

  it('marks every answer private and names the protocol version', async () => {
    const response = await post();

    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-payload-fragment-version')).toBe('1');
  });

  it('answers 500 and says once, in development, when a render throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = { render: () => Promise.reject(new Error('component exploded')) };

    expect((await post('hero', failing)).status).toBe(500);
    expect((await post('hero', failing)).status).toBe(500);

    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines.filter((line) => line.includes('component exploded'))).toHaveLength(1);
    warn.mockRestore();
  });
});
