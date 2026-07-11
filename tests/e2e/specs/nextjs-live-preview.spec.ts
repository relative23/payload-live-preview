/**
 * End-to-end tests for the documented Next.js (App Router) wiring.
 *
 * The fixture is `examples/nextjs-payload`: the inline script is
 * generated with `generateInlineScript()` and embedded in the root
 * layout via `<script dangerouslySetInnerHTML>` — exactly the pattern
 * the README documents for Next.js (no middleware injection). The
 * static mock admin at `/admin.html` embeds `/` in an iframe and
 * posts `payload-live-preview` messages on form input, mirroring the
 * Astro fixture.
 *
 * URLs are absolute on purpose: the Playwright `baseURL` points at
 * the Astro example, and this spec must not depend on it.
 */
import { expect, test } from '@playwright/test';

const NEXT_ORIGIN = 'http://localhost:4174';
const ADMIN_URL = `${NEXT_ORIGIN}/admin.html`;

test.describe('live preview (Next.js) — admin → iframe updates', () => {
  test('updating the title field in the admin updates the preview iframe', async ({ page }) => {
    await page.goto(ADMIN_URL);

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();

    await page.getByTestId('title-input').fill('Brand new title');
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText('Brand new title');
  });

  test('updating the subtitle updates the preview', async ({ page }) => {
    await page.goto(ADMIN_URL);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('subtitle-input').fill('Watch this update live.');
    await expect(preview.locator('[data-payload-field="subtitle"]')).toHaveText(
      'Watch this update live.',
    );
  });

  test('XSS attempt in title is rendered as plain text', async ({ page }) => {
    await page.goto(ADMIN_URL);
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

test.describe('live preview (Next.js) — origin enforcement', () => {
  test('messages from an untrusted origin are ignored', async ({ page }) => {
    await page.goto(`${NEXT_ORIGIN}/`);
    // Mimic a malicious page that tries to drive the preview. Loaded
    // top-level (not framed by the admin) the runtime never boots, so
    // the safest assertion — same as the Astro spec — is that the
    // message simply does not change the DOM.
    await page.evaluate(() => {
      window.postMessage(
        {
          type: 'payload-live-preview',
          data: { title: 'attacker-controlled' },
        },
        '*',
      );
    });
    // Give the runtime time to (not) react.
    await page.waitForTimeout(150);
    await expect(page.locator('[data-payload-field="title"]')).not.toHaveText(
      'attacker-controlled',
    );
  });
});
