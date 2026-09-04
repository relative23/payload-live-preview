/**
 * Document lifecycle in a real browser.
 *
 * The unit tests drive `pagehide`/`pageshow` against jsdom `EventTarget`s. That
 * proves the wiring, not that the shipped artifact carries it: the Astro
 * adapter injects the *inline* runtime, a separate build from the programmatic
 * client, and until this was bound there the feature was unreachable for every
 * adapter consumer. These tests exercise the injected script in Chromium,
 * Firefox and WebKit.
 *
 * What they deliberately do not cover: the browser's own back/forward-cache
 * eligibility. A preview runs inside an iframe or a popup, and the cache
 * applies to top-level navigations, so a genuine restore cannot be provoked
 * here. `persisted` is dispatched directly — the event our code reacts to,
 * raised the way the browser raises it.
 */
import { expect, test } from '@playwright/test';
import { requirePreviewFrame } from '../helpers/preview';

const FROZEN = 'typed while the document was away';
const RESTORED = 'typed after the restore';

test.describe('live preview — document lifecycle', () => {
  test('stops applying updates while hidden and applies them again after a persisted restore', async ({
    page,
  }) => {
    await page.goto('/admin');
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    const title = preview.locator('[data-payload-field="title"]');
    await expect(title).toBeVisible();

    await page.getByTestId('title-input').fill('before the document hides');
    await expect(title).toHaveText('before the document hides');

    const frame = requirePreviewFrame(page);

    await frame.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await page.getByTestId('title-input').fill(FROZEN);
    // Nothing should land: the runtime released its listener on hide. Give the
    // admin's debounce and a frame budget time to prove the absence.
    await page.waitForTimeout(500);
    await expect(title).not.toHaveText(FROZEN);

    await frame.evaluate(() => {
      const restore = new Event('pageshow');
      Object.defineProperty(restore, 'persisted', { value: true });
      window.dispatchEvent(restore);
    });

    await page.getByTestId('title-input').fill(RESTORED);
    await expect(title).toHaveText(RESTORED);
  });

  test('keeps working across an ordinary pageshow, which re-ran the script anyway', async ({
    page,
  }) => {
    await page.goto('/admin');
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    const title = preview.locator('[data-payload-field="title"]');
    await expect(title).toBeVisible();

    const frame = requirePreviewFrame(page);
    await frame.evaluate(() => {
      window.dispatchEvent(new Event('pageshow'));
    });

    await page.getByTestId('title-input').fill('still live after a plain pageshow');
    await expect(title).toHaveText('still live after a plain pageshow');
  });
});
