/**
 * Payload's `autoLogin` signs the editor into the admin on the server and issues
 * no `payload-token` cookie. A preview site that verifies the session
 * (`payload-session`) has nothing to forward, so it serves the public page even
 * though the admin is "signed in" (docs/authorization.md). This spec frames the
 * Next.js example, which verifies the session, from an admin that keeps its
 * autoLogin; `playwright.real-payload.config.ts` starts both (`nextjs-autologin`).
 */
import { expect, test, type Page, type Response } from '@playwright/test';

const PORT = process.env['PLP_REAL_PAYLOAD_PORT'] ?? '4474';
const SURFACE = process.env['PLP_REAL_PAYLOAD_SURFACE'] ?? 'nextjs-autologin';
const PREVIEW_ORIGIN = `http://localhost:${PORT}`;
const PREVIEW_IFRAME = `iframe[src*="localhost:${PORT}"]`;
/** The admin's own requests carry its origin; with Payload's CSRF list on, one without it is not the editor's. */
const ADMIN_ORIGIN = { origin: 'http://localhost:3001' };
/** What the Next.js example's home page says to anyone; the editor's edits would replace it. */
const PUBLIC_TITLE = 'Hello from the demo';

/** The homepage global, with no sign-in: the admin's autoLogin is what lets the test in. */
async function openAdmin(page: Page): Promise<void> {
  await page.goto('/admin/globals/homepage');
  await expect(page.locator('#field-title')).toBeVisible();
  // Not networkidle: WebKit can keep a form-state POST the admin aborted in Playwright's
  // in-flight count, and the page then never idles (CI run 40096404670). Wait for the toggler.
  await expect(page.locator('.live-preview-toggler')).toBeVisible({ timeout: 15_000 });
}

/** The Live Preview panel open and the preview's frame in it. */
async function openPanel(page: Page): Promise<void> {
  const panel = page.locator('.live-preview-window');
  const isOpen = async (): Promise<boolean> =>
    panel.evaluate((el) => el instanceof HTMLElement && el.offsetWidth > 0).catch(() => false);
  if (!(await isOpen())) {
    await page.locator('.live-preview-toggler').click();
    await expect.poll(isOpen, { timeout: 15_000 }).toBe(true);
  }
  await expect(page.locator(PREVIEW_IFRAME)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(PREVIEW_IFRAME)).toHaveAttribute('src', /[?&]preview=true(?:&|$)/u);
}

/** What the frame's page says about its runtime; `navigating` while a read lands in a navigation. */
function runtimeIn(page: Page): () => Promise<string> {
  const body = page.frameLocator(PREVIEW_IFRAME).locator('body');
  return () =>
    body
      .evaluate(() => typeof (window as Window & { __livePreview?: unknown }).__livePreview)
      .catch(() => 'navigating');
}

/** The names of the cookies the browser holds for `localhost`, whatever the port. */
async function cookieNames(page: Page): Promise<string[]> {
  return (await page.context().cookies()).map((cookie) => cookie.name);
}

test.describe(`real Payload admin on autoLogin → ${SURFACE} preview`, () => {
  test('the admin works without a cookie, and its frame is the public page', async ({ page }) => {
    // The frame's own document request: what the browser sent with it and what came back.
    const framed: Response[] = [];
    page.on('response', (response) => {
      if (
        response.url().startsWith(`${PREVIEW_ORIGIN}/`) &&
        response.url().includes('preview=true') &&
        response.request().resourceType() === 'document'
      ) {
        framed.push(response);
      }
    });

    await openAdmin(page);
    await openPanel(page);
    await expect.poll(() => framed.length, { timeout: 60_000 }).toBeGreaterThan(0);

    // autoLogin authenticates a request that names no credential, and sets no cookie.
    const me = await page.context().request.get('/api/users/me');
    expect(me.ok()).toBe(true);
    const user = ((await me.json()) as { user?: { email?: string } }).user;
    expect(user?.email).toBe('e2e@example.com');
    expect(me.headers()['set-cookie']).toBeUndefined();
    expect(await cookieNames(page)).not.toContain('payload-token');
    await page.locator('#field-title').fill('Typed while the admin is on autoLogin');
    await expect(page.locator('#field-title')).toHaveValue('Typed while the admin is on autoLogin');

    // So the frame asked the site with no cookie, and got the page anyone gets.
    const document = framed[0];
    if (document === undefined) throw new Error('the frame never asked the site for its page');
    expect(document.status()).toBe(200);
    expect((await document.request().allHeaders())['cookie'] ?? '').not.toContain('payload-token');
    expect(await document.text()).not.toContain('__livePreview');
    const title = page.frameLocator(PREVIEW_IFRAME).locator('[data-payload-field="title"]');
    await expect(title).toHaveText(PUBLIC_TITLE, { timeout: 60_000 });
    // A read that lands while the frame navigates is "not yet": the page may still reload itself.
    await expect.poll(runtimeIn(page), { timeout: 30_000 }).toBe('undefined');
  });

  test('a sign-in that issues the cookie turns the same frame into a preview that takes edits', async ({
    page,
  }) => {
    await openAdmin(page);
    await openPanel(page);
    const title = page.frameLocator(PREVIEW_IFRAME).locator('[data-payload-field="title"]');
    const runtime = runtimeIn(page);
    await expect(title).toHaveText(PUBLIC_TITLE, { timeout: 60_000 });
    await expect.poll(runtime, { timeout: 30_000 }).toBe('undefined');

    // The site does ask who the editor is; under autoLogin it had no cookie to ask with. Payload's
    // login route issues one, and the next load of the frame is the editor's preview.
    const loggedIn = await page.context().request.post('/api/users/login', {
      data: { email: 'e2e@example.com', password: 'test1234' },
      headers: ADMIN_ORIGIN,
    });
    expect(loggedIn.ok()).toBe(true);
    expect(await cookieNames(page)).toContain('payload-token');
    await page.locator(PREVIEW_IFRAME).evaluate(
      (frame) =>
        new Promise<void>((resolve) => {
          const element = frame as HTMLIFrameElement;
          element.addEventListener('load', () => resolve(), { once: true });
          element.setAttribute('src', element.src);
        }),
    );
    await expect.poll(runtime, { timeout: 30_000 }).toBe('object');
    await page.locator('#field-title').fill('Typed once the cookie exists');
    await expect(title).toHaveText('Typed once the cookie exists');
  });
});
