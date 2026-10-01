import { expect, test } from '@playwright/test';
import { NEXT_ORIGIN, post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * What only a base path or a rewrite can break in a Next.js preview (H16).
 * playwright.next-base-path.config.ts serves the fixture under `/docs` and runs
 * the other Next specs against that build too; this file holds the paths
 * themselves. In the development suite the base path is empty and the same
 * cases hold at the site root.
 */

const BASE = new URL(NEXT_ORIGIN).pathname.replace(/\/$/u, '');
const OWNER = { globalSlug: 'home' };

test.describe('Next.js under a base path and through a rewrite', () => {
  test('the fragment request goes to the endpoint under the base path and renders', async ({
    page,
  }) => {
    const fragmentRequests: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/payload/fragment')) fragmentRequests.push(path);
    });
    await page.goto(`${NEXT_ORIGIN}/hybrid/host`);
    const frame = await waitForPreviewFrame(page, 'preview=true');
    await waitForStarted(frame);

    await post(page, { title: 'Under the base path', subtitle: 'Rendered', body: 'a b' }, OWNER);

    await expect(frame.getByTestId('hero-subtitle')).toHaveText('Rendered');
    expect(fragmentRequests.length).toBeGreaterThan(0);
    expect(fragmentRequests.every((path) => path === `${BASE}/payload/fragment`)).toBe(true);
  });

  test('the bootstrap fetches the runtime from under the base path', async ({ page }) => {
    const assets: { path: string; status: number }[] = [];
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (path.includes('/payload-live-preview/')) assets.push({ path, status: response.status() });
    });
    await page.goto(`${NEXT_ORIGIN}/asset/host`);
    const frame = await waitForPreviewFrame(page, 'preview=true');
    await waitForStarted(frame);

    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(asset.path.startsWith(`${BASE}/payload-live-preview/`), asset.path).toBe(true);
      expect(asset.status, asset.path).toBe(200);
    }
  });

  test('a preview reached through a rewrite keeps its URL and patches', async ({ page }) => {
    await page.goto(`${NEXT_ORIGIN}/admin.html?target=/alias/reveal`);
    const frame = await waitForPreviewFrame(page, '/alias/reveal');
    await waitForStarted(frame);
    expect(new URL(frame.url()).pathname).toBe(`${BASE}/alias/reveal`);

    // As in reveal.spec.ts: React may hydrate over the first write, so the
    // message is posted again until its value stays.
    await expect(async () => {
      await post(page, { heroTitle: 'Through a rewrite' });
      await expect(frame.getByTestId('hero')).toHaveText('Through a rewrite', { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
  });
});
