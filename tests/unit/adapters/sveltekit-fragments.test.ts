import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint } from '@adapters/sveltekit/fragments';
import { issuePreviewToken } from '@security/preview-authorization';
import { resetDevWarnings } from '@adapters/shared/dev-warning';

/**
 * The same endpoint as Astro's and Next's, rendering through Svelte. `svelte`
 * is an optional peer this package does not install, so the server renderer is
 * stood in for here — the binding imports it lazily and through a variable
 * specifier, exactly so a project without Svelte can still install the package.
 */
const svelte = vi.hoisted(() => ({
  render: vi.fn((_component: unknown, options: { props: Record<string, unknown> }) => ({
    head: '<title>ignored</title>',
    body: `<h1>${String(options.props['title'])}</h1>`,
  })),
}));
vi.mock('svelte/server', () => svelte);

const SITE = 'https://site.example.com';
const SECRET = 'fragment-endpoint-secret-that-is-long-enough-1234';

/** A compiled Svelte component is opaque here; the registry only passes it through. */
const Hero = { $$render: true };

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
  return endpoint(overrides)({
    request: new Request(`${SITE}/payload/fragment`, {
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
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDevWarnings();
});

describe('createFragmentEndpoint — SvelteKit', () => {
  it('takes the event SvelteKit hands a +server route and renders the registered component', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { html: string; metadata: { renderer: string } };
    expect(body.html).toBe('<h1>From the form</h1>');
    expect(body.metadata.renderer).toBe('svelte-server');
    expect(svelte.render).toHaveBeenCalledWith(Hero, { props: { title: 'From the form' } });
  });

  it('delivers the body only, because a boundary is a region of the body', async () => {
    // `<svelte:head>` output belongs to the document head, which the route
    // strategy owns; morphed into the boundary it would show up as text.
    const { html } = (await post().then((response) => response.json())) as { html: string };

    expect(html).not.toContain('<title>');
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
