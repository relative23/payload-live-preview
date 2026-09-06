import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint, defineFragment } from '@adapters/nextjs/fragments';
import { issuePreviewToken } from '@security/preview-authorization';
import { resetDevWarnings } from '@adapters/shared/dev-warning';

/**
 * A project that installs neither `react` nor `react-dom` — the majority, since
 * both are optional peers. Importing the adapter must still work, and the first
 * fragment render must say what is missing rather than fail as "render error".
 * The mocks throw at import time, which is what a missing package does.
 */
const attempts = vi.hoisted(() => ({ count: 0 }));

vi.mock('react', () => {
  attempts.count += 1;
  throw new Error("Cannot find package 'react'");
});
vi.mock('react-dom/server', () => {
  throw new Error("Cannot find package 'react-dom'");
});

const SITE = 'https://site.example.com';
const SECRET = 'fragment-endpoint-secret-that-is-long-enough-1234';

function Hero(props: { title: string }): string {
  return props.title;
}

const endpoint = createFragmentEndpoint({
  registry: { hero: defineFragment(Hero, () => ({ title: 'x' })) },
  authorize: { type: 'signed-token', secret: SECRET, audience: SITE },
});

async function post(): Promise<Response> {
  const previewToken = await issuePreviewToken(
    { audience: SITE, path: '/page' },
    { secret: SECRET },
  );
  return endpoint(
    new Request(`${SITE}/payload/fragment`, {
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
    }),
  );
}

beforeEach(() => {
  resetDevWarnings();
});

describe('the Next.js fragment endpoint without React installed', () => {
  it('imports and builds without touching React', () => {
    // Nothing above threw: the peers are loaded at the first render, not at
    // import, so an adapter that only injects the script needs neither.
    expect(typeof endpoint).toBe('function');
  });

  it('names the missing peers in the server log, and stays generic to the browser', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await post();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'render' });
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('`react` and `react-dom`, optional peers');
    expect(logged).toContain('hero');
    warn.mockRestore();
  });

  it('retries the import on the next request, so installing React needs no restart', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = attempts.count;

    expect((await post()).status).toBe(500);
    expect((await post()).status).toBe(500);

    // A cached failure would answer every later request from the first bad
    // start, and a project that installs React would have to restart the server.
    expect(attempts.count).toBe(before + 2);
    warn.mockRestore();
  });
});
