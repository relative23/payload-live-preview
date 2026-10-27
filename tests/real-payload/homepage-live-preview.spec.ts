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
 *         → real Astro preview page with our injected runtime
 *           → real DOM patch
 *
 * The admin auto-logs-in the seeded editor (see `payload.config.ts`), so
 * there are no credentials to type. Payload renders Live Preview as a
 * toggleable panel inside the edit view (not a separate route); we click
 * its toggler, then assert the cross-origin preview iframe updates as we
 * type.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openLivePreviewPanel } from './live-preview-panel';

const previewPort = process.env['PLP_E2E_PORT'] ?? '4173';
/** The Payload the admin runs: the nightly watch installs 3.x's latest and 4's beta over the fixture. */
const payloadMajor = Number(
  (
    JSON.parse(
      readFileSync(
        new URL(
          '../../examples/payload-backend/node_modules/payload/package.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { version: string }
  ).version.split('.')[0],
);
const PREVIEW_IFRAME = `iframe[src*="localhost:${previewPort}"]`;

test.describe('real Payload admin → live preview iframe', () => {
  test.beforeEach(async ({ page }) => {
    // The seeded homepage global; autoLogin means we land straight in.
    await page.goto('/admin/globals/homepage');
    await expect(page.locator('#field-title')).toBeVisible();
    // Let the admin hydrate so the toggler's click handler is attached.
    await page.waitForLoadState('networkidle');

    await openLivePreviewPanel(page);

    // A cold Astro build and preview start can take several seconds before the
    // loader reveals the iframe, so allow generous headroom here.
    const iframe = page.locator(PREVIEW_IFRAME);
    await expect(iframe).toBeVisible({ timeout: 30_000 });
    await expect(iframe).toHaveAttribute('src', /[?&]preview=true(?:&|$)/u);
  });

  test('the config plugin supplies the live-preview breakpoint', async ({ page }) => {
    const chooser = page.locator('.live-preview-toolbar-controls__breakpoint');
    await expect(chooser).toBeVisible();
    await chooser.click();

    const pluginBreakpoint = page.getByText('Plugin mobile', { exact: true });
    await expect(pluginBreakpoint).toBeVisible();
    await pluginBreakpoint.click();
    await expect(chooser).toContainText('Plugin mobile');
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

  test('an Astro router commit locally reapplies the unsaved document', async ({ page }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    const title = preview.locator('[data-payload-field="title"]');
    const unsaved = 'Unsaved across a real Payload router commit';
    await page.locator('#field-title').fill(unsaved);
    await expect(title).toHaveText(unsaved);

    const acceptedBefore = await preview.locator('body').evaluate(() => {
      const runtime = (
        window as Window & {
          __livePreview?: { inspect(): { revisions: { accepted: number } } };
        }
      ).__livePreview;
      return runtime?.inspect().revisions.accepted;
    });
    expect(acceptedBefore).toBeGreaterThan(0);

    await preview.getByTestId('real-payload-soft-navigation').click();
    await expect(preview.getByTestId('real-payload-soft-route')).toBeVisible();
    await expect(title).toHaveText(unsaved);

    const acceptedAfter = await preview.locator('body').evaluate(() => {
      const runtime = (
        window as Window & {
          __livePreview?: { inspect(): { revisions: { accepted: number } } };
        }
      ).__livePreview;
      return runtime?.inspect().revisions.accepted;
    });
    if (payloadMajor >= 4) {
      // Payload 4's admin posts the document again right after the router commit: measured on
      // 4.0.0-canary.39 (2026-10-17), the counter went from 6 to 7 within 90 ms of the click, with
      // the same title on screen. The reapply is then the admin's as well as the runtime's, so only
      // the title above is asserted, and a count that went down would still be wrong.
      expect(acceptedAfter).toBeGreaterThanOrEqual(acceptedBefore ?? 0);
    } else {
      expect(acceptedAfter).toBe(acceptedBefore);
    }
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
