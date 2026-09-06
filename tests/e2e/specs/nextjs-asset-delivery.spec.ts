import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * `delivery: 'asset'` through the Next.js adapter. Both fixtures live in
 * `examples/nextjs-payload`: `/` is the inline default, `/asset` carries the
 * bootstrap and fetches the runtime from the route handler in
 * `app/payload-live-preview/[file]`.
 *
 * What is asserted is the trade the option makes. The page gets small, the
 * runtime arrives as one cacheable file whose name is its hash, the browser
 * verifies it against the integrity the page stated, and the second page pays
 * nothing because the first one's copy is still good.
 */

const APP = 'http://localhost:4174';
// A diagnostic code the runtime carries and the bootstrap — 679 bytes of
// context check and one `createElement('script')` — does not.
const RUNTIME_MARKER = 'LP0101';

async function pageBody(page: Page, path: string): Promise<string> {
  const response = await page.request.get(`${APP}${path}`);
  expect(response.status()).toBe(200);
  return response.text();
}

test.describe('asset delivery (Next.js)', () => {
  test('the page carries the bootstrap and the asset URL, not the runtime', async ({ page }) => {
    const html = await pageBody(page, '/asset?preview=true');

    expect(html).toMatch(/\/payload-live-preview\/runtime\.[0-9a-f]{16}\.js/u);
    expect(html).toContain('sha384-');
    expect(html).not.toContain(RUNTIME_MARKER);

    // The inline half of the same fixture, for the comparison this option
    // exists for. Both pages are otherwise the same shell, so the difference is
    // the runtime: about 97 KB of it, against 679 bytes of bootstrap.
    const inline = await pageBody(page, '/?preview=true');
    expect(inline).toContain(RUNTIME_MARKER);
    expect(inline.length - html.length).toBeGreaterThan(90_000);
  });

  test('the asset is immutable and matches the integrity the page stated', async ({ page }) => {
    const html = await pageBody(page, '/asset?preview=true');
    const src = /"(\/payload-live-preview\/runtime\.[0-9a-f]{16}\.js)"/u.exec(html)?.[1];
    const integrity = /"(sha384-[A-Za-z0-9+/=]+)"/u.exec(html)?.[1];
    expect(src).toBeDefined();
    expect(integrity).toBeDefined();

    const response = await page.request.get(`${APP}${src!}`);

    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers()['content-type']).toContain('text/javascript');
    const digest = createHash('sha384')
      .update(await response.body())
      .digest('base64');
    expect(`sha384-${digest}`).toBe(integrity);
  });

  test('a name this build does not produce is a miss, not different bytes', async ({ page }) => {
    const response = await page.request.get(
      `${APP}/payload-live-preview/runtime.0000000000000000.js`,
    );

    expect(response.status()).toBe(404);
  });

  test('the fetched runtime boots and patches, integrity check included', async ({ page }) => {
    await page.goto(`${APP}/asset/host`);
    const frame = await waitForPreviewFrame(page, '/asset?preview=true');
    await waitForStarted(frame);

    await post(page, { title: 'Delivered as an asset', count: 41 });

    await expect(frame.locator('[data-payload-field="title"]')).toHaveText('Delivered as an asset');
    await expect(frame.locator('[data-payload-field="count"]')).toHaveText('41');
  });

  test('every page points at the same URL, so one cached copy serves them all', async ({
    page,
  }) => {
    const urlIn = (html: string): string | undefined =>
      /"(\/payload-live-preview\/runtime\.[0-9a-f]{16}\.js)"/u.exec(html)?.[1];

    const first = urlIn(await pageBody(page, '/asset?preview=true'));
    const second = urlIn(await pageBody(page, '/asset?preview=true&cb=2'));

    expect(first).toBeDefined();
    expect(second).toBe(first);
    // Which is the trade the option makes: the URL is a constant of the package
    // version, so the year-long `immutable` entry above is written once and read
    // by every preview page after it. That a browser honours it is the header's
    // guarantee, not this harness's — under Playwright the dev server is
    // re-asked on each navigation, so asserting a cache hit here would be
    // testing the harness rather than the option.
  });
});
