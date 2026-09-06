import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint, defineFragment } from '@adapters/nextjs/fragments';
import { issuePreviewToken } from '@security/preview-authorization';
import { resetDevWarnings } from '@adapters/shared/dev-warning';

/**
 * The same endpoint as Astro's, rendering through React instead of Astro's
 * container. `react` and `react-dom` are optional peers this package does not
 * install, so both are stood in for here — the renderer imports them lazily and
 * through a variable specifier, exactly so a project without React can still
 * install the package.
 */
const react = vi.hoisted(() => ({
  createElement: vi.fn((component: unknown, props: unknown) => ({ component, props })),
}));
const server = vi.hoisted(() => ({
  renderToString: vi.fn(
    (element: { props: Record<string, unknown> }) => `<h1>${String(element.props['title'])}</h1>`,
  ),
}));
vi.mock('react', () => react);
vi.mock('react-dom/server', () => server);

const SITE = 'https://site.example.com';
const SECRET = 'fragment-endpoint-secret-that-is-long-enough-1234';

function Hero(props: { title: string }): string {
  return props.title;
}

const registry = {
  hero: defineFragment(Hero, (input) => ({
    title: typeof input.fields['title'] === 'string' ? input.fields['title'] : '',
  })),
};

function endpoint(overrides: Record<string, unknown> = {}) {
  return createFragmentEndpoint({
    registry,
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

describe('createFragmentEndpoint — Next.js', () => {
  it('renders the registered component through react-dom/server', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { html: string; metadata: { renderer: string } };
    expect(body.html).toBe('<h1>From the form</h1>');
    expect(body.metadata.renderer).toBe('react-dom');
    expect(react.createElement).toHaveBeenCalledWith(Hero, { title: 'From the form' });
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

describe('defineFragment', () => {
  it('pairs a component with the props it takes, so the two cannot drift', () => {
    const entry = defineFragment(Hero, () => ({ title: 'x' }));

    expect(entry.component).toBe(Hero);
    // @ts-expect-error -- the component takes `title`, not `heading`.
    defineFragment(Hero, () => ({ heading: 'x' }));
  });
});
