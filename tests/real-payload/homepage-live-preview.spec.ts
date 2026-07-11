/**
 * Full-chain E2E against a REAL running Payload instance.
 *
 * Every other test in this repo either emulates the Payload admin (the
 * Astro `/admin` mock in `tests/e2e`) or replays a captured message
 * (`tests/integration/real-payload-protocol.test.ts`). This spec closes
 * the last gap: it boots an actual Payload 3.x server
 * (`examples/payload-backend`, SQLite, seeded), opens the *real* admin's
 * Live Preview panel, and drives the *real* postMessage protocol that
 * Payload's own admin emits — no mock, no fixture, no stub.
 *
 * The chain exercised here is exactly what a consumer runs in production:
 *
 *   real Payload admin (:3001)
 *     → real form field
 *       → real `window.postMessage('payload-live-preview', …)`
 *         → real Astro preview page (:4173) with our injected runtime
 *           → real DOM patch
 *
 * The admin auto-logs-in the seeded editor (see `payload.config.ts`), so
 * there are no credentials to type. Payload renders Live Preview as a
 * toggleable panel inside the edit view (not a separate route); we click
 * its toggler, then assert the cross-origin preview iframe updates as we
 * type.
 */
import { expect, test } from '@playwright/test';

const PREVIEW_IFRAME = 'iframe[src*="localhost:4173"]';

test.describe('real Payload admin → live preview iframe', () => {
  test.beforeEach(async ({ page }) => {
    // The seeded homepage global; autoLogin means we land straight in.
    await page.goto('/admin/globals/homepage');
    await expect(page.locator('#field-title')).toBeVisible();
    // Let the admin hydrate so the toggler's click handler is attached.
    await page.waitForLoadState('networkidle');

    // Drive the Live Preview panel to OPEN. Payload persists the toggle as
    // a per-user preference, so it may already be open on a warm profile;
    // decide from the panel's rendered size (a 0×0 panel is closed) rather
    // than the iframe, which its loader keeps hidden until `onLoad` fires.
    const panel = page.locator('.live-preview-window');
    const isOpen = async (): Promise<boolean> =>
      panel.evaluate((el) => el instanceof HTMLElement && el.offsetWidth > 0).catch(() => false);
    if (!(await isOpen())) {
      await page.locator('.live-preview-toggler').click();
      await expect.poll(isOpen, { timeout: 15_000 }).toBe(true);
    }

    // A cold Astro dev compile can take several seconds before the loader
    // reveals the iframe, so allow generous headroom here.
    await expect(page.locator(PREVIEW_IFRAME)).toBeVisible({ timeout: 30_000 });
  });

  test('typing the title in the real admin patches the preview DOM', async ({ page }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    // The runtime is live once the bound element is present in the iframe.
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();

    await page.locator('#field-title').fill('Real Payload live-preview title');
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText(
      'Real Payload live-preview title',
    );
  });

  test('typing the subtitle in the real admin patches the preview DOM', async ({ page }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await page.locator('#field-subtitle').fill('Driven by the real Payload protocol');
    await expect(preview.locator('[data-payload-field="subtitle"]')).toHaveText(
      'Driven by the real Payload protocol',
    );
  });

  test('an XSS attempt typed into the real admin is escaped in the preview', async ({ page }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await page.locator('#field-title').fill('<img src=x onerror=alert(1)>done');
    // Rendered verbatim as text — never parsed into an element.
    await expect(preview.locator('[data-payload-field="title"]')).toContainText('<img src=x');
    const injected = await preview.locator('[data-payload-field="title"] img').count();
    expect(injected).toBe(0);
  });
});
