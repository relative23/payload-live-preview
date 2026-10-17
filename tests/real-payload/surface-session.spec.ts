/**
 * Where a surface's preview verifies the editor's session (`payload-session`),
 * the real admin is what supplies it: the editor signs in through the real login
 * form, Payload issues `payload-token`, and the cookie reaches the preview site
 * with the iframe request. The runtime is part of the response only for that
 * request. `surface-smoke.spec.ts` holds what every surface shares.
 */
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { SEEDED_MEDIA, chooseSeededMedia, waitForPopulation } from './upload-media';

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

/** The runtime in the preview has started: the admin's next message is one it hears. */
async function runtimeStarted(preview: FrameLocator): Promise<void> {
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
}

/**
 * Cuts the preview's population request that carries `field`'s chosen value, on the network: the
 * admin's own calls to its API go through, and so does the request the page makes at load, which
 * carries no value yet. `cuts()` counts the requests that were cut, `restore()` lets the next one through.
 */
async function cutPopulation(
  page: Page,
  field: string,
): Promise<{ cuts: () => number; restore: () => void }> {
  let failing = true;
  let cut = 0;
  await page.route('http://localhost:3001/api/globals/homepage**', async (route) => {
    const request = route.request();
    const fromPreview = request.frame().url().startsWith(PREVIEW_ORIGIN);
    if (failing && fromPreview && request.headers()['x-payload-http-method-override'] === 'GET') {
      const body = request.postDataJSON() as { data?: Record<string, unknown> } | null;
      if (body?.data?.[field] != null) {
        cut += 1;
        await route.abort('failed');
        return;
      }
    }
    await route.continue();
  });
  return {
    cuts: () => cut,
    restore: () => {
      failing = false;
    },
  };
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
    await runtimeStarted(preview);
    await expect(author).toHaveText('');

    // The admin posts the relationship as an id; the runtime asks Payload's REST API for the document
    // with the editor's session (a credentialed POST that Payload reads as a GET), and the binding on
    // `author.email` shows the populated value.
    const asked = waitForPopulation(page);
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
    await runtimeStarted(preview);

    const network = await cutPopulation(page, 'author');
    await page.locator('#field-author').click();
    await page.getByRole('option', { name: 'e2e@example.com' }).click();
    await expect.poll(network.cuts, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(author).toHaveText('');

    network.restore();
    await page.locator('#field-subtitle').fill('Typed once the network is back');
    await expect(subtitle).toHaveText('Typed once the network is back');
    await expect(author).toHaveText('e2e@example.com');
  });

  test('an upload chosen in the real admin is populated as the editor and shown by bindings on the media', async ({
    page,
  }) => {
    await signIn(page);
    await openPreview(page);
    const preview = page.frameLocator(PREVIEW_IFRAME);
    const filename = preview.locator('[data-payload-field="image.filename"]');
    const image = preview.locator('[data-payload-field="image"]');
    await expect(filename).toBeAttached({ timeout: 60_000 });
    await runtimeStarted(preview);
    await expect(filename).toHaveText('');
    await expect(image).not.toHaveAttribute('src');

    // The admin posts the upload as the media's id, like a relationship; the runtime asks Payload for the
    // document, and the `upload` renderer writes what it finds. `src` is the URL Payload returned: the
    // backend sets no `serverURL`, so that is a path on the admin's origin, not on the preview's.
    const asked = waitForPopulation(page);
    await chooseSeededMedia(page);
    expect((await asked).status()).toBe(200);
    await expect(filename).toHaveText(SEEDED_MEDIA.filename);
    await expect(image).toHaveAttribute('alt', SEEDED_MEDIA.alt);
    await expect(image).toHaveAttribute('src', /\/api\/media\/file\/e2e-pixel\.png$/u);
  });

  test('an upload population that fails on the network leaves the page as it was, and the next change populates', async ({
    page,
  }) => {
    await signIn(page);
    await openPreview(page);
    const preview = page.frameLocator(PREVIEW_IFRAME);
    const filename = preview.locator('[data-payload-field="image.filename"]');
    const image = preview.locator('[data-payload-field="image"]');
    const subtitle = preview.locator('[data-payload-field="subtitle"]');
    await expect(filename).toBeAttached({ timeout: 60_000 });
    await runtimeStarted(preview);

    const network = await cutPopulation(page, 'image');
    await chooseSeededMedia(page);
    await expect.poll(network.cuts, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(filename).toHaveText('');
    await expect(image).not.toHaveAttribute('src');

    network.restore();
    await page.locator('#field-subtitle').fill('Typed once the network is back');
    await expect(subtitle).toHaveText('Typed once the network is back');
    await expect(filename).toHaveText(SEEDED_MEDIA.filename);
    await expect(image).toHaveAttribute('src', /\/api\/media\/file\/e2e-pixel\.png$/u);
  });
});
