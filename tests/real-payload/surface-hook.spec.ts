/**
 * The React hook and the Vue composable against the REAL Payload admin. These
 * pages render from the merged document, not from bindings a DOM runtime patches:
 * the real admin's messages reach the hook, which re-fetches the document from
 * Payload's REST API with the editor's session (cross-origin, so the backend
 * answers CORS for exactly this site) and hands the merge to the component tree.
 * `playwright.real-payload.config.ts` starts the example page named by
 * `PLP_REAL_PAYLOAD_TARGET` (`nextjs-hook`, `nuxt-composable`) and the admin.
 */
import { expect, test } from '@playwright/test';

const PORT = process.env['PLP_REAL_PAYLOAD_PORT'] ?? '4474';
const SURFACE = process.env['PLP_REAL_PAYLOAD_SURFACE'] ?? 'nextjs-hook';
const PATH = process.env['PLP_REAL_PAYLOAD_PATH'] ?? '/hook';
const PREVIEW_IFRAME = `iframe[src*="localhost:${PORT}${PATH}"]`;

test.describe(`real Payload admin → ${SURFACE}`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.locator('#field-email').fill('e2e@example.com');
    await page.locator('#field-password').fill('test1234');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/admin(?!\/login)/u);
    await page.goto('/admin/globals/homepage');
    await expect(page.locator('#field-title')).toBeVisible();
    await page.waitForLoadState('networkidle');

    const panel = page.locator('.live-preview-window');
    const isOpen = async (): Promise<boolean> =>
      panel.evaluate((el) => el instanceof HTMLElement && el.offsetWidth > 0).catch(() => false);
    if (!(await isOpen())) {
      await page.locator('.live-preview-toggler').click();
      await expect.poll(isOpen, { timeout: 15_000 }).toBe(true);
    }
    await expect(page.locator(PREVIEW_IFRAME)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(PREVIEW_IFRAME)).toHaveAttribute('src', /[?&]preview=true(?:&|$)/u);
  });

  test('the saved document arrives when the frame loads, before any edit', async ({ page }) => {
    // Payload posts the form's document when the iframe loads, so the page leaves
    // its initial data without a keystroke and the merge has already settled.
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.getByTestId('title')).toHaveText('Seeded title', { timeout: 60_000 });
    await expect(preview.getByTestId('status')).toHaveText('live');
  });

  test('typing the title in the real admin reaches the component tree', async ({ page }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.getByTestId('title')).toBeVisible({ timeout: 60_000 });
    await page.locator('#field-title').fill('Typed in the real admin');
    await expect(preview.getByTestId('title')).toHaveText('Typed in the real admin');
  });

  test('typing the subtitle in the real admin reaches the component tree', async ({ page }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.getByTestId('subtitle')).toBeVisible({ timeout: 60_000 });
    await page.locator('#field-subtitle').fill('Driven by the real Payload protocol');
    await expect(preview.getByTestId('subtitle')).toHaveText('Driven by the real Payload protocol');
  });

  test("a relationship is populated by Payload's REST API as the editor, cross-origin", async ({
    page,
  }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.getByTestId('title')).toBeVisible({ timeout: 60_000 });
    const asked = page.waitForResponse(
      (response) =>
        response.url().startsWith('http://localhost:3001/api/globals/homepage') &&
        response.request().method() === 'POST' &&
        response.request().headers()['x-payload-http-method-override'] === 'GET',
      { timeout: 30_000 },
    );
    await page.locator('#field-author').click();
    await page.getByRole('option', { name: 'e2e@example.com' }).click();
    // The merge is a credentialed POST that Payload reads as a GET (its method
    // override), from the preview's origin to the admin's: CORS and the session.
    const response = await asked;
    expect(response.status()).toBe(200);
    await expect(preview.getByTestId('author')).toHaveText('e2e@example.com', { timeout: 15_000 });
    await expect(preview.getByTestId('status')).toHaveText('live');
    await expect(preview.getByTestId('error')).toHaveCount(0);
  });

  test('an XSS attempt typed into the real admin is text in the component tree', async ({
    page,
  }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.getByTestId('title')).toBeVisible({ timeout: 60_000 });
    await page.locator('#field-title').fill('<img src=x onerror=alert(1)>done');
    await expect(preview.getByTestId('title')).toContainText('<img src=x');
    expect(await preview.getByTestId('title').locator('img').count()).toBe(0);
  });
});
