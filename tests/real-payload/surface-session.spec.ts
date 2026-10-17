/**
 * Where a surface's preview verifies the editor's session (`payload-session`),
 * the real admin is what supplies it: the editor signs in through the real login
 * form, Payload issues `payload-token`, and the cookie reaches the preview site
 * with the iframe request. The runtime is part of the response only for that
 * request. `surface-smoke.spec.ts` holds what every surface shares.
 */
import { expect, test, type Page } from '@playwright/test';

const PORT = process.env['PLP_REAL_PAYLOAD_PORT'] ?? '4474';
const SURFACE = process.env['PLP_REAL_PAYLOAD_SURFACE'] ?? 'nextjs';
const PREVIEW_ORIGIN = `http://localhost:${PORT}`;
const PREVIEW_IFRAME = `iframe[src*="localhost:${PORT}"]`;
/** The admin's own requests carry its origin; with Payload's CSRF list on, one without it is not the editor's. */
const ADMIN_ORIGIN = { origin: 'http://localhost:3001' };

/** The editor signs in through the real login form: Payload issues `payload-token`. */
async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.locator('#field-email').fill('e2e@example.com');
  await page.locator('#field-password').fill('test1234');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin(?!\/login)/u);
}

/** The homepage global with its Live Preview panel open and the preview's frame in it. */
async function openPreview(page: Page): Promise<void> {
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
}

test.describe(`real Payload session → ${SURFACE} preview`, () => {
  test('a request without the session gets no runtime, the editor’s gets it', async ({
    page,
    request,
  }) => {
    await signIn(page);

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
    await signIn(page);
    await openPreview(page);
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

  test('a relationship chosen in the real admin is populated as the editor and shown by a binding on the populated path', async ({
    page,
  }) => {
    await signIn(page);
    await openPreview(page);
    const preview = page.frameLocator(PREVIEW_IFRAME);
    const author = preview.locator('[data-payload-field="author.email"]');
    await expect(author).toBeAttached({ timeout: 60_000 });
    await preview
      .locator('body')
      .waitForFunction(
        () =>
          (
            window as Window & { __livePreview?: { inspect(): { started: boolean } } }
          ).__livePreview?.inspect().started === true,
        undefined,
        { timeout: 30_000 },
      );
    await expect(author).toHaveText('');

    // The admin posts the relationship as an id; the runtime asks Payload's REST API for the document
    // with the editor's session (a credentialed POST that Payload reads as a GET), and the binding on
    // `author.email` shows the populated value.
    const asked = page.waitForResponse(
      (response) =>
        response.url().startsWith('http://localhost:3001/api/globals/homepage') &&
        response.request().method() === 'POST' &&
        response.request().headers()['x-payload-http-method-override'] === 'GET',
      { timeout: 30_000 },
    );
    await page.locator('#field-author').click();
    await page.getByRole('option', { name: 'e2e@example.com' }).click();
    expect((await asked).status()).toBe(200);
    await expect(author).toHaveText('e2e@example.com');
  });

  test('a population request that fails on the network leaves the page as it was, and the next change populates', async ({
    page,
  }) => {
    await signIn(page);
    await openPreview(page);
    const preview = page.frameLocator(PREVIEW_IFRAME);
    const author = preview.locator('[data-payload-field="author.email"]');
    const subtitle = preview.locator('[data-payload-field="subtitle"]');
    await expect(author).toBeAttached({ timeout: 60_000 });
    await preview
      .locator('body')
      .waitForFunction(
        () =>
          (
            window as Window & { __livePreview?: { inspect(): { started: boolean } } }
          ).__livePreview?.inspect().started === true,
        undefined,
        { timeout: 30_000 },
      );

    // Only the preview's population request is cut: the admin's own calls to its API go through.
    let failing = true;
    let cut = 0;
    await page.route('http://localhost:3001/api/globals/homepage**', async (route) => {
      const request = route.request();
      const fromPreview = request.frame().url().startsWith(PREVIEW_ORIGIN);
      if (failing && fromPreview && request.headers()['x-payload-http-method-override'] === 'GET') {
        cut += 1;
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await page.locator('#field-author').click();
    await page.getByRole('option', { name: 'e2e@example.com' }).click();
    await expect.poll(() => cut, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(author).toHaveText('');

    failing = false;
    await page.locator('#field-subtitle').fill('Typed once the network is back');
    await expect(subtitle).toHaveText('Typed once the network is back');
    await expect(author).toHaveText('e2e@example.com');
  });
});
