import { createHash } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * `delivery: 'asset'` through the SvelteKit adapter (`examples/sveltekit-payload`).
 *
 * The fixture splits by route: `hooks.server.ts` gives `/asset` the bootstrap
 * and everything else the inlined runtime, so one dev server shows both and the
 * difference between the two responses is the delivery alone. Authorization is
 * unchanged — this fixture is the v2/strict showcase, so a preview still needs
 * a token bound to its path, and an asset page without one gets nothing.
 */

const APP = 'http://localhost:4175';
const RUNTIME_MARKER = 'LP0101';
const ASSET_URL = /"(\/payload-live-preview\/runtime\.[0-9a-f]{16}\.js)"/u;

async function tokenFor(request: APIRequestContext, path: string): Promise<string> {
  return (await request.get(`${APP}/preview-token?path=${encodeURIComponent(path)}`)).text();
}

async function previewHtml(request: APIRequestContext, path: string): Promise<string> {
  const token = encodeURIComponent(await tokenFor(request, path));
  const response = await request.get(`${APP}${path}?preview=true&previewToken=${token}`);
  expect(response.status()).toBe(200);
  return response.text();
}

test.describe('asset delivery (SvelteKit)', () => {
  test('one route carries the bootstrap, the other the runtime', async ({ request }) => {
    const asset = await previewHtml(request, '/asset');
    const inline = await previewHtml(request, '/');

    expect(asset).toMatch(ASSET_URL);
    expect(asset).not.toContain(RUNTIME_MARKER);
    expect(inline).toContain(RUNTIME_MARKER);
    expect(inline).not.toMatch(ASSET_URL);
    expect(inline.length - asset.length).toBeGreaterThan(90_000);
  });

  test('the asset is immutable and matches the integrity the page stated', async ({ request }) => {
    const html = await previewHtml(request, '/asset');
    const src = ASSET_URL.exec(html)?.[1];
    const integrity = /"(sha384-[A-Za-z0-9+/=]+)"/u.exec(html)?.[1];
    expect(src).toBeDefined();

    const response = await request.get(`${APP}${src!}`);

    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(
      `sha384-${createHash('sha384')
        .update(await response.body())
        .digest('base64')}`,
    ).toBe(integrity);
    expect((await request.get(`${APP}/payload-live-preview/runtime.0.js`)).status()).toBe(404);
  });

  test('delivery does not loosen the gate: no token, no bootstrap', async ({ request }) => {
    const response = await request.get(`${APP}/asset?preview=true`);

    const html = await response.text();
    expect(html).not.toMatch(ASSET_URL);
    expect(html).not.toContain('__LIVE_PREVIEW_CONFIG__');
    expect(html).not.toMatch(/\sdata-payload-[a-z-]+="/u);
  });

  test('the fetched runtime boots and patches', async ({ page }) => {
    // Driven through the fixture's own admin form, which posts the owner this
    // page's bindings are scoped to (`collectionSlug: 'pages'`).
    await page.goto(`${APP}/admin.html?target=/asset`);
    const frame = await waitForPreviewFrame(page, '/asset?preview=true');
    await waitForStarted(frame);

    await page.getByTestId('title-input').fill('Delivered as an asset');

    await expect(frame.locator('[data-payload-field="title"]')).toHaveText('Delivered as an asset');
  });
});
