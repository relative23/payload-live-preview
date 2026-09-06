import { createHash } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * `delivery: 'asset'` through the Nuxt adapter (`examples/nuxt-payload`). The
 * whole fixture is on asset delivery, so its other suites — the fragment
 * endpoint, Vue's hydration, the reveal — already run against a runtime that
 * arrives after the page. What is asserted here is the delivery itself.
 *
 * The integrity check is the load-bearing one. Nitro's rollup rewrites
 * `typeof window` to `"undefined"` everywhere in a bundle, string literals
 * included, and it took a failing SRI check to notice: a Nuxt production build
 * had every occurrence in the embedded runtime rewritten. The generated
 * constants are split around those tokens now
 * (`scripts/serialize-source.ts`), and this is what fails if that stops
 * working end to end.
 */

const APP = 'http://localhost:4176';
const RUNTIME_MARKER = 'LP0101';
const ASSET_URL = /"(\/payload-live-preview\/runtime\.[0-9a-f]{16}\.js)"/u;

async function previewHtml(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${APP}/?preview=true`);
  expect(response.status()).toBe(200);
  return response.text();
}

test.describe('asset delivery (Nuxt)', () => {
  test('the page carries the bootstrap and the asset URL, not the runtime', async ({ request }) => {
    const html = await previewHtml(request);

    expect(html).toMatch(ASSET_URL);
    expect(html).not.toContain(RUNTIME_MARKER);
    expect(html).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  test('the served bytes are the bytes the page vouched for', async ({ request }) => {
    const html = await previewHtml(request);
    const src = ASSET_URL.exec(html)?.[1];
    const integrity = /"(sha384-[A-Za-z0-9+/=]+)"/u.exec(html)?.[1];
    expect(src).toBeDefined();

    const response = await request.get(`${APP}${src!}`);
    const body = await response.body();

    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(`sha384-${createHash('sha384').update(body).digest('base64')}`).toBe(integrity);
    // The token Nitro would have rewritten, intact in what a browser receives.
    expect(body.toString('utf8')).toContain('typeof window');
  });

  test('a name this build does not produce is a miss, not different bytes', async ({ request }) => {
    const response = await request.get(`${APP}/payload-live-preview/runtime.0000000000000000.js`);

    expect(response.status()).toBe(404);
  });

  test('a page without preview intent gets neither runtime nor bootstrap', async ({ request }) => {
    const html = await (await request.get(`${APP}/`)).text();

    expect(html).not.toMatch(ASSET_URL);
    expect(html).not.toContain('__LIVE_PREVIEW_CONFIG__');
  });
});
