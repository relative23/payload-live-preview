/**
 * Where a surface's preview verifies the editor's session (`payload-session`),
 * the real admin is what supplies it: the editor signs in through the real login
 * form, Payload issues `payload-token`, and the cookie reaches the preview site
 * with the iframe request. The runtime is part of the response only for that
 * request. `surface-smoke.spec.ts` holds what every surface shares.
 */
import { expect, test } from '@playwright/test';

const PORT = process.env['PLP_REAL_PAYLOAD_PORT'] ?? '4474';
const SURFACE = process.env['PLP_REAL_PAYLOAD_SURFACE'] ?? 'nextjs';
const PREVIEW_ORIGIN = `http://localhost:${PORT}`;
const PREVIEW_IFRAME = `iframe[src*="localhost:${PORT}"]`;
/** The admin's own requests carry its origin; with Payload's CSRF list on, one without it is not the editor's. */
const ADMIN_ORIGIN = { origin: 'http://localhost:3001' };

test.describe(`real Payload session → ${SURFACE} preview`, () => {
  test('a request without the session gets no runtime, the editor’s gets it', async ({
    page,
    request,
  }) => {
    await page.goto('/admin/login');
    await page.locator('#field-email').fill('e2e@example.com');
    await page.locator('#field-password').fill('test1234');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/admin(?!\/login)/u);

    const anonymous = await request.get(`${PREVIEW_ORIGIN}/?preview=true`);
    expect(anonymous.status()).toBe(200);
    expect(await anonymous.text()).not.toContain('__livePreview');
    const editor = await page.context().request.get(`${PREVIEW_ORIGIN}/?preview=true`);
    expect(editor.status()).toBe(200);
    expect(await editor.text()).toContain('__livePreview');
  });

  test('a frame reloaded after the editor signs out is the public page, and signing in again brings the runtime back', async ({
    page,
  }) => {
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
    const body = page.frameLocator(PREVIEW_IFRAME).locator('body');
    // A read that lands while the frame navigates loses its execution context: that is "not yet".
    const runtime = (): Promise<string> =>
      body
        .evaluate(() => typeof (window as Window & { __livePreview?: unknown }).__livePreview)
        .catch(() => 'navigating');
    const reload = (): Promise<void> =>
      page.locator(PREVIEW_IFRAME).evaluate(
        (frame) =>
          new Promise<void>((resolve) => {
            const element = frame as HTMLIFrameElement;
            element.addEventListener('load', () => resolve(), { once: true });
            element.setAttribute('src', element.src);
          }),
      );

    await expect.poll(runtime, { timeout: 60_000 }).toBe('object');

    // Payload's own route ends the session: it expires `payload-token`. The admin page stays where it
    // is, so the frame is the only thing that can show what the preview site decides next.
    const loggedOut = await page
      .context()
      .request.post('/api/users/logout', { headers: ADMIN_ORIGIN });
    expect(loggedOut.ok()).toBe(true);
    await reload();
    await expect.poll(runtime, { timeout: 30_000 }).toBe('undefined');

    const loggedIn = await page.context().request.post('/api/users/login', {
      data: { email: 'e2e@example.com', password: 'test1234' },
      headers: ADMIN_ORIGIN,
    });
    expect(loggedIn.ok()).toBe(true);
    await reload();
    await expect.poll(runtime, { timeout: 30_000 }).toBe('object');
  });
});
