import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * PHD-02: owner scoping reaches the route. `examples/pure-html` bakes a page
 * with `scopeBindingsByOwner` and the route strategy; each of its two
 * documents carries a route marker. An edit asks for a refresh only through a
 * marker the edited document owns, so the other document's marker costs no
 * request of the route.
 */

const APP = 'http://localhost:4180';
const TARGET = '/owners-route.html';

/** Every refresh request the route strategy makes, counted from the start. */
async function open(page: Page): Promise<{ frame: Frame; refreshes: () => number }> {
  let refreshes = 0;
  page.on('request', (request) => {
    if (request.headers()['x-payload-live-preview'] === 'route') refreshes += 1;
  });
  await page.goto(`${APP}/admin.html?target=${encodeURIComponent(TARGET)}`);
  const frame = await waitForPreviewFrame(page, TARGET);
  await waitForStarted(frame);
  return { frame, refreshes: () => refreshes };
}

test.describe('owner-scoped route planning', () => {
  test('an edit another document marks for the route is patched without a refresh', async ({
    page,
  }) => {
    const { frame, refreshes } = await open(page);

    await post(page, { title: 'Edited title' }, { globalSlug: 'home' });

    await expect(frame.getByTestId('title')).toHaveText('Edited title');
    // A refresh would start in the same turn as the patch; give it a window.
    await page.waitForTimeout(300);
    expect(refreshes()).toBe(0);
  });

  test('an edit the edited document marks for the route refreshes it once', async ({ page }) => {
    const { frame, refreshes } = await open(page);

    await post(page, { teaser: 'Edited teaser' }, { globalSlug: 'home' });

    await expect.poll(refreshes).toBe(1);
    await expect(frame.getByTestId('teaser')).toHaveText('Edited teaser');
  });
});
