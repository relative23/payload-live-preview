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
import { SEEDED_MEDIA, chooseSeededMedia, waitForPopulation } from './upload-media';

const PORT = process.env['PLP_REAL_PAYLOAD_PORT'] ?? '4474';
const SURFACE = process.env['PLP_REAL_PAYLOAD_SURFACE'] ?? 'nextjs-hook';
const PATH = process.env['PLP_REAL_PAYLOAD_PATH'] ?? '/hook';
const PREVIEW_IFRAME = `iframe[src*="localhost:${PORT}${PATH}"]`;
/** The admin's own requests carry its origin; with Payload's CSRF list on, one without it is not the editor's. */
const ADMIN_ORIGIN = { origin: 'http://localhost:3001' };

test.describe(`real Payload admin → ${SURFACE}`, () => {
  // The first test of a run also pays for the browser's first page and the preview page's cold compile.
  // On a CI runner WebKit once took 20.5 s to create that page, and the frame wait below allows 60 s.
  test.describe.configure({ timeout: 120_000 });

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
    // Visible SSR markup can precede the hook's initial population request.
    // Wait for that merge before observing the editor's relationship request.
    await expect(preview.getByTestId('status')).toHaveText('live');
    const routeState = () =>
      preview.locator('html').evaluate(() => {
        const runtime = (
          window as Window & {
            __livePreview?: {
              inspect(): {
                origins: { locked: string | undefined };
                revisions: {
                  accepted: number;
                  completed: number;
                  superseded: number;
                  display?: { state: string };
                };
                route: { partial: number };
              };
            };
          }
        ).__livePreview;
        if (runtime === undefined) throw new Error('The parallel DOM runtime is missing');
        const { origins, revisions, route } = runtime.inspect();
        const counters = [
          route.partial,
          revisions.accepted,
          revisions.completed,
          revisions.superseded,
        ];
        if (counters.some((counter) => !Number.isSafeInteger(counter) || counter < 0)) {
          throw new Error('The DOM runtime counters are invalid');
        }
        return {
          partial: route.partial,
          locked: origins.locked,
          accepted: revisions.accepted,
          completed: revisions.completed,
          superseded: revisions.superseded,
          displayState: revisions.display?.state,
        };
      });
    const routePartial = async () => (await routeState()).partial;
    if (SURFACE === 'nextjs-hook') {
      const acceptedBefore = (await routeState()).accepted;
      // The hook can answer its ready handshake before the inline runtime listens.
      // A real editor mutation gives both consumers a settled baseline before author changes.
      await page.locator('#field-title').fill('Relationship morph baseline');
      await expect(preview.getByTestId('title')).toHaveText('Relationship morph baseline');
      await expect(preview.getByTestId('status')).toHaveText('live');
      await expect
        .poll(async () => {
          const state = await routeState();
          return (
            state.accepted > acceptedBefore &&
            state.completed > 0 &&
            state.completed + state.superseded === state.accepted &&
            (state.displayState === 'current' ||
              state.displayState === 'partial' ||
              state.displayState === 'unconfirmed')
          );
        })
        .toBe(true);
      expect((await routeState()).locked).toBe('http://localhost:3001');
    }
    const partialBefore = SURFACE === 'nextjs-hook' ? await routePartial() : undefined;
    const asked = waitForPopulation(page);
    await page.locator('#field-author').click();
    await page.getByRole('option', { name: 'e2e@example.com' }).click();
    // The merge is a credentialed POST that Payload reads as a GET (its method
    // override), from the preview's origin to the admin's: CORS and the session.
    const response = await asked;
    expect(response.status()).toBe(200);
    await expect(preview.getByTestId('author')).toHaveText('e2e@example.com', { timeout: 15_000 });
    if (partialBefore !== undefined) {
      // The parallel runtime's later route morph must preserve the hook's committed DOM.
      await expect.poll(routePartial).toBeGreaterThan(partialBefore);
      await expect(preview.getByTestId('author')).toHaveText('e2e@example.com', {
        timeout: 15_000,
      });
    }
    await expect(preview.getByTestId('status')).toHaveText('live');
    await expect(preview.getByTestId('error')).toHaveCount(0);
  });

  test("an upload is populated by Payload's REST API as the editor, and the hook hands the media document to the component tree", async ({
    page,
  }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.getByTestId('title')).toBeVisible({ timeout: 60_000 });
    // Visible SSR markup can precede the hook's initial population request: wait for that merge, so
    // the one asked for below is the editor's choice.
    await expect(preview.getByTestId('status')).toHaveText('live');
    await expect(preview.getByTestId('image')).toHaveText('');
    const asked = waitForPopulation(page);
    await chooseSeededMedia(page);
    expect((await asked).status()).toBe(200);
    await expect(preview.getByTestId('image')).toHaveText(SEEDED_MEDIA.filename, {
      timeout: 15_000,
    });
    // The hook hands the document over as Payload returned it: the media's `url` is the path on
    // Payload's origin, which the component resolves itself (docs/react.md).
    await expect(preview.getByTestId('image-url')).toHaveText(SEEDED_MEDIA.path);
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

  test('after a frame reload the page forgets the unsaved edit, and the next change brings the whole unsaved document back', async ({
    page,
  }) => {
    // Payload posts the form's document when its form state changes, not when the frame reloads:
    // the reloaded page shows what it renders by itself, and one change after the reload is what
    // brings both the new edit and the one typed before the reload back.
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.getByTestId('status')).toHaveText('live', { timeout: 60_000 });
    await page.locator('#field-title').fill('Title typed before the reload');
    await expect(preview.getByTestId('title')).toHaveText('Title typed before the reload');

    // The reloaded page can take the admin's next message once its hook has announced itself: a
    // change typed before the hook is mounted is a message nobody hears.
    await page.evaluate((previewOrigin) => {
      const counter = window as Window & { __previewReady?: number };
      counter.__previewReady = 0;
      window.addEventListener('message', (event) => {
        if (event.origin !== previewOrigin) return;
        const data = event.data as { type?: string; ready?: boolean } | null;
        if (data?.type === 'payload-live-preview' && data.ready === true) {
          counter.__previewReady = (counter.__previewReady ?? 0) + 1;
        }
      });
    }, `http://localhost:${PORT}`);
    await page.locator(PREVIEW_IFRAME).evaluate(
      (frame) =>
        new Promise<void>((resolve) => {
          const element = frame as HTMLIFrameElement;
          element.addEventListener('load', () => resolve(), { once: true });
          element.setAttribute('src', element.src);
        }),
    );
    await expect
      .poll(
        () =>
          page.evaluate(() => (window as Window & { __previewReady?: number }).__previewReady ?? 0),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);
    await expect(preview.getByTestId('title')).not.toHaveText('Title typed before the reload');
    await expect(preview.getByTestId('status')).toHaveText('idle');

    await page.locator('#field-subtitle').fill('Subtitle typed after the reload');
    await expect(preview.getByTestId('subtitle')).toHaveText('Subtitle typed after the reload');
    await expect(preview.getByTestId('title')).toHaveText('Title typed before the reload');
    await expect(preview.getByTestId('status')).toHaveText('live');
  });

  test('a merge the server refuses once the session has ended keeps the last good document, and signing in again brings the preview back', async ({
    page,
  }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.getByTestId('status')).toHaveText('live', { timeout: 60_000 });
    await page.locator('#field-title').fill('Typed while the session is alive');
    await expect(preview.getByTestId('title')).toHaveText('Typed while the session is alive');
    await expect(preview.getByTestId('revision')).not.toHaveText('0');
    const goodRevision = await preview.getByTestId('revision').textContent();

    // Payload's own route ends the session: it expires `payload-token`, which the hook's merge
    // request carries from the preview's origin. The admin page stays where it is.
    const loggedOut = await page
      .context()
      .request.post('/api/users/logout', { headers: ADMIN_ORIGIN });
    expect(loggedOut.ok()).toBe(true);
    await page.locator('#field-title').fill('Typed after the session ended');
    await expect(preview.getByTestId('status')).toHaveText('unavailable', { timeout: 15_000 });
    // The refusal names the status; which of the two Payload answers is its business.
    await expect(preview.getByTestId('error')).toContainText(/\b40[13]\b/u);
    await expect(preview.getByTestId('title')).toHaveText('Typed while the session is alive');
    await expect(preview.getByTestId('revision')).toHaveText(goodRevision ?? '');

    const loggedIn = await page.context().request.post('/api/users/login', {
      data: { email: 'e2e@example.com', password: 'test1234' },
      headers: ADMIN_ORIGIN,
    });
    expect(loggedIn.ok()).toBe(true);
    await page.locator('#field-title').fill('Typed after signing in again');
    await expect(preview.getByTestId('title')).toHaveText('Typed after signing in again');
    await expect(preview.getByTestId('status')).toHaveText('live');
    await expect(preview.getByTestId('error')).toHaveCount(0);
  });

  test('a merge request that fails on the network keeps the last good document, and the next change catches up', async ({
    page,
  }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.getByTestId('status')).toHaveText('live', { timeout: 60_000 });
    await page.locator('#field-title').fill('Typed before the network fails');
    await expect(preview.getByTestId('title')).toHaveText('Typed before the network fails');

    // Only the preview's merge request is cut: the admin's own calls to its API go through.
    let failing = true;
    let cut = 0;
    await page.route('http://localhost:3001/api/globals/homepage**', async (route) => {
      const request = route.request();
      const fromPreview = request.frame().url().startsWith(`http://localhost:${PORT}`);
      if (failing && fromPreview && request.headers()['x-payload-http-method-override'] === 'GET') {
        cut += 1;
        await route.abort('failed');
        return;
      }
      await route.continue();
    });
    await page.locator('#field-title').fill('Typed while the network fails');
    await expect(preview.getByTestId('status')).toHaveText('unavailable', { timeout: 15_000 });
    await expect(preview.getByTestId('error')).not.toBeEmpty();
    await expect(preview.getByTestId('title')).toHaveText('Typed before the network fails');
    expect(cut).toBeGreaterThan(0);

    failing = false;
    await page.locator('#field-title').fill('Typed once the network is back');
    await expect(preview.getByTestId('title')).toHaveText('Typed once the network is back');
    await expect(preview.getByTestId('status')).toHaveText('live');
    await expect(preview.getByTestId('error')).toHaveCount(0);
  });
});
