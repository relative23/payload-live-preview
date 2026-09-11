/**
 * End-to-end tests for the documented Next.js (App Router) wiring.
 *
 * The fixture is `examples/nextjs-payload`: the root layout renders
 * `<LivePreviewScript />`, the async server component that waits for
 * `authorizePreview` before it renders anything — the pattern
 * docs/nextjs.md documents (no middleware injection). The static mock
 * admin at `/admin.html` enters through `/preview-session`, which mints
 * the signed token the layout verifies, and posts `payload-live-preview`
 * messages on form input, mirroring the Astro fixture.
 *
 * URLs are absolute on purpose: the Playwright `baseURL` points at
 * the Astro example, and this spec must not depend on it.
 */
import { expect, test } from '@playwright/test';
import { requirePreviewFrame } from '../helpers/preview';

const NEXT_ORIGIN = 'http://localhost:4174';
const ADMIN_URL = `${NEXT_ORIGIN}/admin.html`;

interface HydrationApi {
  inspect: () => { hydration: { mode: string; state: string } };
}

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
    // Through the entry route, so the page is one an editor could be
    // looking at: without the cookie it minted the layout renders no
    // runtime at all, and "the message changed nothing" would be true
    // for a reason that has nothing to do with origins.
    await page.goto(`${NEXT_ORIGIN}/preview-session?to=%2F`);
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

/**
 * ADR 0015. Measured 2026-09-11 before the guard existed: the mock admin
 * answers `ready` at once, the runtime wrote the document 81 ms before React
 * hydrated the page, React threw `Hydration failed because the server rendered
 * text didn't match the client` and regenerated the tree — the write was gone
 * until the admin's next message. Once per framed load of `/`, four times per
 * Chromium run, and no spec listened to `pageerror`, so the suite was green.
 */
test.describe('live preview (Next.js) — the first message and React', () => {
  test('the first write lands after hydration, so React finds the markup it rendered', async ({
    page,
  }) => {
    // The dev server compiles `/` and its client chunk on first request; the
    // first load warms it so the measured load below is the page as served.
    await page.goto(ADMIN_URL);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();

    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await page.goto(ADMIN_URL);
    // The admin's document differs from the server's markup in `hero.alt`
    // ("Hero image" against "Mountains at dusk"), so a write that landed
    // shows here — and so would a regeneration that took it back.
    await expect(preview.locator('[data-payload-field="hero"]')).toHaveAttribute(
      'alt',
      'Hero image',
    );
    // Long enough for a regeneration to have happened and been reported;
    // measured, the error came 87 ms after the write.
    await page.waitForTimeout(500);
    expect(errors.filter((message) => message.includes('Hydration failed'))).toEqual([]);
    expect(errors).toEqual([]);
    await expect(preview.locator('[data-payload-field="hero"]')).toHaveAttribute(
      'alt',
      'Hero image',
    );
    const frame = requirePreviewFrame(page);
    const hydration = await frame.evaluate(
      () =>
        (window as Window & { __livePreview?: HydrationApi }).__livePreview?.inspect().hydration,
    );
    expect(hydration).toEqual({ mode: 'react', state: 'committed' });
  });
});
