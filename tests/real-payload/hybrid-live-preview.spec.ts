import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * The hybrid strategies against a REAL Payload admin (roadmap 1.7.0
 * production gate): the admin at :3001 frames the SSR hybrid fixture at
 * :4177, the fixture authorizes the editor's session through
 * `/api/users/me`, and typing in the real admin drives patch (footer),
 * fragment (the subtitle section rendered by Astro on the server) and route
 * (the title, bound in `<head>`) — in whichever engine this project runs.
 */

const PORT = process.env['PLP_E2E_PORT'] ?? '4177';
const PREVIEW_IFRAME = `iframe[src*="localhost:${PORT}"]`;

interface Api {
  inspect: () => {
    started: boolean;
    fragments: { handler: boolean; rendered: number; failed: number };
    route: { handler: boolean; refreshes: number; failed: number };
  };
}

function previewFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame.url().includes(`localhost:${PORT}`));
}

test.describe('real Payload admin → hybrid fixture', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/globals/homepage');
    await expect(page.locator('#field-title')).toBeVisible();
    // Not networkidle: the hybrid preview keeps the network busy (fragment and
    // route fetches), so the page never idles. Wait for the toggler instead.
    const panel = page.locator('.live-preview-window');
    await expect(page.locator('.live-preview-toggler')).toBeVisible({ timeout: 15_000 });
    const isOpen = async (): Promise<boolean> =>
      panel.evaluate((el) => el instanceof HTMLElement && el.offsetWidth > 0).catch(() => false);
    if (!(await isOpen())) {
      await page.locator('.live-preview-toggler').click();
      await expect.poll(isOpen, { timeout: 15_000 }).toBe(true);
    }
    await expect(page.locator(PREVIEW_IFRAME)).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        () =>
          previewFrame(page)?.evaluate(
            () => (window as Window & { __livePreview?: Api }).__livePreview?.inspect().started,
          ) ?? false,
        { timeout: 30_000 },
      )
      .toBe(true);
  });

  test('the session-authorized page carries the fragment and route clients', async ({ page }) => {
    const frame = previewFrame(page);
    if (!frame) throw new Error('preview frame missing');
    const state = await frame.evaluate(() => {
      const api = (window as Window & { __livePreview?: Api }).__livePreview!.inspect();
      return { fragment: api.fragments.handler, route: api.route.handler };
    });
    expect(state).toEqual({ fragment: true, route: true });
  });

  test('typing the subtitle makes Astro render the conditional section on the server', async ({
    page,
  }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await page.locator('#field-subtitle').fill('Rendered by the real admin');
    // The subtitle section exists only when the field is non-empty, so its
    // presence with this text is proof the server rendered the fragment.
    await expect(preview.getByTestId('hero-subtitle')).toHaveText('Rendered by the real admin');
    const frame = previewFrame(page);
    if (!frame) throw new Error('preview frame missing');
    await expect
      .poll(() =>
        frame.evaluate(
          () => (window as Window & { __livePreview?: Api }).__livePreview!.inspect().fragments,
        ),
      )
      .toMatchObject({ failed: 0 });
    expect(
      (
        await frame.evaluate(
          () => (window as Window & { __livePreview?: Api }).__livePreview!.inspect().fragments,
        )
      ).rendered,
    ).toBeGreaterThanOrEqual(1);
  });

  test('typing the title updates the head and the hero against the real admin', async ({
    page,
  }) => {
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await page.locator('#field-title').fill('Real admin, real route');
    const frame = previewFrame(page);
    if (!frame) throw new Error('preview frame missing');
    // The title is bound in the <head> and in the hero. The head <title>
    // reaching the unsaved value is the end-to-end proof that the hybrid
    // preview delivered the edit to the whole document — assert that (with
    // generous headroom: a real admin plus a cold route fetch is slow on a
    // shared runner, Firefox especially) and the hero. Whether the head is
    // reached by a route refresh or the patch fallback is a per-message race
    // against a real admin; the route-refresh mechanics are proven
    // deterministically in tests/e2e/specs/hybrid-fragment.spec.ts across all
    // three engines, so this real-admin test asserts the observable outcome,
    // not the internal strategy counter.
    await expect.poll(() => frame.title(), { timeout: 30_000 }).toBe('Real admin, real route');
    await expect(preview.getByTestId('hero-title')).toHaveText('Real admin, real route');
  });
});
