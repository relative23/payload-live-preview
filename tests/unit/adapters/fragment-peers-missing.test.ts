import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint as svelteEndpoint } from '@adapters/sveltekit/fragments';
import { createFragmentEndpoint as vueEndpoint } from '@adapters/nuxt/fragments';
import { issuePreviewToken } from '@security/preview-authorization';
import { resetDevWarnings } from '@adapters/shared/dev-warning';

/**
 * A project that installs neither Svelte nor Vue: the bindings must import and
 * build, and the first render must name the package that is missing rather than
 * fail as an anonymous render error. The mocks throw at import time, which is
 * what a package that is not installed does.
 */
vi.mock('svelte/server', () => {
  throw new Error("Cannot find package 'svelte'");
});
vi.mock('vue', () => {
  throw new Error("Cannot find package 'vue'");
});
vi.mock('vue/server-renderer', () => {
  throw new Error("Cannot find package 'vue'");
});

const SITE = 'https://site.example.com';
const SECRET = 'fragment-endpoint-secret-that-is-long-enough-1234';
const registry = { hero: { component: {}, props: () => ({ title: 'x' }) } };
const authorize = { type: 'signed-token', secret: SECRET, audience: SITE } as const;

async function request(): Promise<Request> {
  const previewToken = await issuePreviewToken(
    { audience: SITE, path: '/page' },
    { secret: SECRET },
  );
  return new Request(`${SITE}/payload/fragment`, {
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
      fields: { title: 'From the form' },
    }),
  });
}

// Both cases warn under the same key (`fragment-render:hero`), and that key is
// deliberately remembered for the life of the process.
beforeEach(() => {
  resetDevWarnings();
});

describe.each([
  {
    framework: 'SvelteKit',
    peer: '`svelte`',
    call: async () => svelteEndpoint({ registry, authorize })({ request: await request() }),
  },
  {
    framework: 'Nuxt',
    peer: '`vue`',
    call: async () => vueEndpoint({ registry, authorize })(await request()),
  },
])('$framework without its renderer installed', ({ peer, call }) => {
  it('names the missing peer in the server log and stays generic to the browser', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await call();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'render' });
    const logged = warn.mock.calls.map((line) => String(line[0])).join('\n');
    expect(logged).toContain(peer);
    expect(logged).toContain('an optional peer');
    warn.mockRestore();
  });
});
