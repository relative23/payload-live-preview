/**
 * The critical smoke of a surface against the REAL Payload admin.
 *
 * The mock admin in `tests/e2e` proves a surface's contracts with messages the
 * suite builds itself. This spec keeps only what a mock cannot supply: the real
 * admin frames the surface's preview with the URL the config plugin builds, and
 * what the editor types reaches the page through Payload's own postMessage
 * traffic. Where the surface's preview verifies the editor's session, the editor
 * signs in through the real login form first (`surface-session.spec.ts` holds
 * what only that surface can show). `playwright.real-payload.config.ts` starts
 * the surface named by `PLP_REAL_PAYLOAD_TARGET` and the admin beside it.
 */
import { expect, test, type Page } from '@playwright/test';

const PORT = process.env['PLP_REAL_PAYLOAD_PORT'] ?? '4474';
const SURFACE = process.env['PLP_REAL_PAYLOAD_SURFACE'] ?? 'nextjs';
const PREVIEW_IFRAME = `iframe[src*="localhost:${PORT}"]`;

/**
 * Payload issues `payload-token` only to a real sign-in. A surface whose preview
 * does not ask who the editor is leaves the admin on its autoLogin.
 */
async function signIn(page: Page): Promise<void> {
  if (process.env['PLP_REAL_PAYLOAD_SESSION'] !== '1') return;
  await page.goto('/admin/login');
  await page.locator('#field-email').fill('e2e@example.com');
  await page.locator('#field-password').fill('test1234');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin(?!\/login)/u);
}

test.describe(`real Payload admin → ${SURFACE} live preview`, () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/globals/homepage');
    await expect(page.locator('#field-title')).toBeVisible();
    await page.waitForLoadState('networkidle');

    // The toggle is a per-user preference and may already be open.
    const panel = page.locator('.live-preview-window');
    const isOpen = async (): Promise<boolean> =>
      panel.evaluate((el) => el instanceof HTMLElement && el.offsetWidth > 0).catch(() => false);
    if (!(await isOpen())) {
      await page.locator('.live-preview-toggler').click();
      await expect.poll(isOpen, { timeout: 15_000 }).toBe(true);
    }
    const iframe = page.locator(PREVIEW_IFRAME);
    await expect(iframe).toBeVisible({ timeout: 60_000 });
    await expect(iframe).toHaveAttribute('src', /[?&]preview=true(?:&|$)/u);
  });

  test("the editor's session authorizes the preview and the runtime starts", async ({ page }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(
        () =>
          preview.locator('body').evaluate(() => {
            const runtime = (
              window as Window & {
                __livePreview?: { inspect(): { started: boolean; hydration: { state: string } } };
              }
            ).__livePreview;
            if (runtime === undefined) return 'absent';
            const { started, hydration } = runtime.inspect();
            return started && hydration.state !== 'waiting' ? 'running' : 'waiting';
          }),
        { timeout: 30_000 },
      )
      .toBe('running');
  });

  test('typing the title in the real admin patches the preview', async ({ page }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible({ timeout: 60_000 });
    await page.locator('#field-title').fill('Typed in the real admin');
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText(
      'Typed in the real admin',
    );
  });

  test('typing the subtitle in the real admin patches the preview', async ({ page }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.locator('[data-payload-field="subtitle"]')).toBeVisible({
      timeout: 60_000,
    });
    await page.locator('#field-subtitle').fill('Driven by the real Payload protocol');
    await expect(preview.locator('[data-payload-field="subtitle"]')).toHaveText(
      'Driven by the real Payload protocol',
    );
  });

  test('an XSS attempt typed into the real admin is escaped in the preview', async ({ page }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible({ timeout: 60_000 });
    await page.locator('#field-title').fill('<img src=x onerror=alert(1)>done');
    await expect(preview.locator('[data-payload-field="title"]')).toContainText('<img src=x');
    expect(await preview.locator('[data-payload-field="title"] img').count()).toBe(0);
  });

  test('after a frame reload the next keystroke brings the whole unsaved document back', async ({
    page,
  }) => {
    // Payload posts the document when its form state changes, not when the frame
    // reloads, and every message carries all of it: one keystroke after the
    // reload is what the preview needs to show both edits again.
    const preview = page.frameLocator(PREVIEW_IFRAME);
    const title = preview.locator('[data-payload-field="title"]');
    const subtitle = preview.locator('[data-payload-field="subtitle"]');
    await expect(title).toBeVisible({ timeout: 60_000 });
    await page.locator('#field-subtitle').fill('Subtitle typed before the reload');
    await page.locator('#field-title').fill('Title typed before the reload');
    await expect(subtitle).toHaveText('Subtitle typed before the reload');
    await expect(title).toHaveText('Title typed before the reload');
    await page.waitForTimeout(1_000);
    // The new document, not the old one still on screen while a dev server renders.
    await page.locator(PREVIEW_IFRAME).evaluate(
      (frame) =>
        new Promise<void>((resolve) => {
          const element = frame as HTMLIFrameElement;
          element.addEventListener(
            'load',
            () => {
              resolve();
            },
            { once: true },
          );
          element.setAttribute('src', element.src);
        }),
    );
    await expect
      .poll(
        () =>
          preview.locator('body').evaluate(() => {
            const runtime = (
              window as Window & { __livePreview?: { inspect(): { started: boolean } } }
            ).__livePreview;
            return runtime?.inspect().started === true;
          }),
        { timeout: 30_000 },
      )
      .toBe(true);
    await page.locator('#field-title').fill('Title typed after the reload');
    await expect(title).toHaveText('Title typed after the reload');
    await expect(subtitle).toHaveText('Subtitle typed before the reload');
  });
});
