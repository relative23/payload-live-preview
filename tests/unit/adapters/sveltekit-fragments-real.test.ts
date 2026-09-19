import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFragmentEndpoint } from '@adapters/sveltekit/fragments';
import { issuePreviewToken } from '@security/preview-authorization';
import { resetDevWarnings } from '@adapters/shared/dev-warning';

/**
 * The SvelteKit fragment endpoint through the real `svelte/server`, with a
 * component compiled here by `svelte/compiler`: what the peer floor promises
 * (`svelte >=5`) is measured against Svelte itself, not against the stand-in
 * `sveltekit-fragments.test.ts` uses for the binding's own logic. The
 * hook-matrix job runs this file at the floor, the unit job at what the
 * lockfile installs (quality/compat-matrix.json).
 */

const SITE = 'https://site.example.com';
const SECRET = 'fragment-endpoint-secret-that-is-long-enough-1234';
const SOURCE = `<script>
  let { title, tags = [] } = $props();
</script>
<section class="hero"><h1>{title}</h1><ul>{#each tags as tag}<li>{tag}</li>{/each}</ul></section>`;

interface ServerComponent {
  readonly default: object;
}

/** Compile the component for the server and load it through the module graph, as Vite would. */
async function compileHero(): Promise<ServerComponent> {
  const { js } = compile(SOURCE, { generate: 'server', filename: 'Hero.svelte' });
  const directory = join(process.cwd(), 'node_modules', '.cache', 'payload-live-preview-tests');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'hero.server.mjs');
  writeFileSync(file, js.code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as ServerComponent;
}

async function post(component: object, fields: Record<string, unknown>): Promise<Response> {
  const previewToken = await issuePreviewToken(
    { audience: SITE, path: '/page' },
    { secret: SECRET },
  );
  const endpoint = createFragmentEndpoint({
    registry: {
      hero: {
        component,
        props: ({ fields: given }) => ({
          title: typeof given['title'] === 'string' ? given['title'] : '',
          tags: Array.isArray(given['tags']) ? given['tags'] : [],
        }),
      },
    },
    authorize: { type: 'signed-token', secret: SECRET, audience: SITE },
  });
  return endpoint({
    request: new Request(`${SITE}/payload/fragment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        origin: SITE,
      },
      body: JSON.stringify({
        fragment: 'hero',
        route: '/page',
        search: `?previewToken=${previewToken}`,
        revision: 1,
        globalSlug: 'home',
        fields,
      }),
    }),
  });
}

describe('the SvelteKit fragment endpoint through the real svelte/server', () => {
  beforeEach(() => {
    resetDevWarnings();
  });

  it('renders a compiled component with the props the registry derives, body only', async () => {
    const hero = await compileHero();
    const response = await post(hero.default, { title: 'From the <form>', tags: ['a', 'b'] });
    expect(response.status).toBe(200);
    const { html } = (await response.json()) as { html: string };
    // Svelte 5's server output carries its own hydration markers, and escapes
    // `<` and `&` in text but leaves `>` as it is.
    expect(html).toContain('<h1>From the &lt;form></h1>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<li>b</li>');
    expect(html).toContain('class="hero"');
    expect(html).not.toContain('<title');
  });

  it('renders again with different props from the same compiled component', async () => {
    const hero = await compileHero();
    const read = async (fields: Record<string, unknown>): Promise<string> =>
      ((await (await post(hero.default, fields)).json()) as { html: string }).html;
    const first = await read({ title: 'One', tags: [] });
    const second = await read({ title: 'Two', tags: ['x'] });
    expect(first).toContain('<h1>One</h1>');
    expect(first).not.toContain('<li>');
    expect(second).toContain('<h1>Two</h1>');
    expect(second).toContain('<li>x</li>');
  });
});
