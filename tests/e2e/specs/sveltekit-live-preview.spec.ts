/**
 * End-to-end tests for the SvelteKit adapter (`livePreviewHandle`).
 *
 * The fixture is the SvelteKit example under `examples/sveltekit-payload`,
 * expected to be running on port 4175 (`npm --prefix
 * examples/sveltekit-payload run dev`). The static `/admin.html` page
 * emulates the Payload admin: it embeds `/` in an iframe and posts
 * updates whenever the form changes. Because the iframe load carries
 * `Sec-Fetch-Dest: iframe`, the handle's default `'preview-only'`
 * injection kicks in — so a passing suite also proves preview gating,
 * not just DOM patching.
 *
 * URLs are absolute on purpose: the repo-level Playwright `baseURL`
 * points at the Astro example (port 4173), and this spec must not
 * depend on it.
 */
import { expect, test } from '@playwright/test';

const APP = 'http://localhost:4175';

test.describe('sveltekit live preview — admin → iframe updates', () => {
  test('updating the title field in the admin updates the preview iframe', async ({ page }) => {
    await page.goto(`${APP}/admin.html`);

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();

    await page.getByTestId('title-input').fill('Brand new title');
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText('Brand new title');
  });

  test('updating the subtitle updates the preview', async ({ page }) => {
    await page.goto(`${APP}/admin.html`);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('subtitle-input').fill('Watch this update live.');
    await expect(preview.locator('[data-payload-field="subtitle"]')).toHaveText(
      'Watch this update live.',
    );
  });

  test('XSS attempt in title is rendered as plain text', async ({ page }) => {
    await page.goto(`${APP}/admin.html`);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('title-input').fill('<script>window.__pwned=true</script>OK');
    await expect(preview.locator('[data-payload-field="title"]')).toContainText('<script>');
    const pwned = await preview.locator('html').evaluate(() => {
      const win = window as unknown as { __pwned?: boolean };
      return win.__pwned === true;
    });
    expect(pwned).toBe(false);
  });
});

test.describe('sveltekit live preview — origin enforcement', () => {
  test('messages from an untrusted origin are ignored', async ({ page }) => {
    await page.goto(`${APP}/`);
    // Mimic a malicious page that tries to drive the preview. On a
    // top-level navigation the handle does not inject the runtime
    // (no preview signal) and the runtime would refuse to start
    // outside an iframe anyway — the DOM must not change.
    await page.evaluate(() => {
      window.postMessage(
        {
          type: 'payload-live-preview',
          data: { title: 'attacker-controlled' },
        },
        '*',
      );
    });
    // Give the runtime time to (not) react. Since 1.1.0 a public response
    // carries no binding at all, so there is nothing an attacker could even
    // address — the heading is plain markup and stays what it was.
    await page.waitForTimeout(150);
    await expect(page.locator('[data-payload-field]')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveText('Hello from the demo');
  });
});

test.describe('sveltekit live preview — authorized preview context (ADR 0006)', () => {
  async function token(request: Parameters<Parameters<typeof test>[2]>[0]['request']) {
    const response = await request.get(`${APP}/preview-token?path=/`);
    return response.text();
  }

  test('a public request carries no binding, no runtime and no preview CSP', async ({
    request,
  }) => {
    const response = await request.get(`${APP}/`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toMatch(/\sdata-payload-[a-z-]+="/);
    expect(html).not.toContain('__LIVE_PREVIEW_CONFIG__');
    expect(response.headers()['content-security-policy']).toBeUndefined();
  });

  test('intent without a token is refused the same way', async ({ request }) => {
    const response = await request.get(`${APP}/?preview=true`, {
      headers: { 'sec-fetch-dest': 'iframe' },
    });
    const html = await response.text();
    expect(html).not.toMatch(/\sdata-payload-[a-z-]+="/);
    expect(html).not.toContain('__LIVE_PREVIEW_CONFIG__');
    expect(response.headers()['content-security-policy']).toBeUndefined();
  });

  test('a token bound to another path is refused', async ({ request }) => {
    const other = await request.get(`${APP}/preview-token?path=/elsewhere`);
    const response = await request.get(`${APP}/?preview=true&previewToken=${await other.text()}`);
    const html = await response.text();
    expect(html).not.toMatch(/\sdata-payload-[a-z-]+="/);
    expect(html).not.toContain('__LIVE_PREVIEW_CONFIG__');
  });

  test('a valid token yields bindings, runtime and CSP together', async ({ request }) => {
    const response = await request.get(`${APP}/?preview=true&previewToken=${await token(request)}`);
    const html = await response.text();
    expect(html).toContain('data-payload-field="title"');
    expect(html).toContain('data-payload-owner="collection:pages"');
    expect(html).toContain('__LIVE_PREVIEW_CONFIG__');
    expect(response.headers()['content-security-policy']).toContain('frame-ancestors');
  });
});
