/**
 * Astro's ClientRouter keeps the runtime alive while replacing the page. The
 * new route must receive the admin's current unsaved snapshot without another
 * keystroke, save or publish, and destroying the runtime must remove the
 * package's native lifecycle listener.
 */

import { expect, test } from '@playwright/test';
import { waitForPreviewFrame } from '../helpers/preview';

const ADMIN = 'http://localhost:4182/admin/?target=%2Fsoft-navigation%2Fone%2F';

test('Astro replays unsaved state after a ClientRouter commit and tears the listener down', async ({
  page,
}) => {
  await page.goto(ADMIN);
  const frame = await waitForPreviewFrame(page, '/soft-navigation/one/');
  const title = page
    .frameLocator('[data-testid="preview-frame"]')
    .getByTestId('soft-navigation-title');
  const input = page.getByTestId('soft-navigation-input');
  const readyCount = page.getByTestId('soft-navigation-ready-count');

  await expect(title).toBeVisible();
  await input.fill('Unsaved and never published');
  await expect(title).toHaveText('Unsaved and never published');

  // Startup has three delayed retries. Drain them before attributing a ready
  // handshake to one router commit.
  await page.waitForTimeout(2_100);
  await expect(readyCount).toHaveText('4');
  const beforeNavigation = 4;

  await title.locator('..').getByTestId('soft-navigation-next').click();
  await expect.poll(() => new URL(frame.url()).pathname).toBe('/soft-navigation/two/');
  await expect(title).toHaveText('Unsaved and never published');
  await expect.poll(async () => Number(await readyCount.textContent())).toBe(beforeNavigation + 1);

  await title.locator('..').getByTestId('soft-navigation-previous').click();
  await expect.poll(() => new URL(frame.url()).pathname).toBe('/soft-navigation/one/');
  await expect(title).toHaveText('Unsaved and never published');
  await expect.poll(async () => Number(await readyCount.textContent())).toBe(beforeNavigation + 2);

  const beforeDestroy = Number(await readyCount.textContent());
  await frame.evaluate(() => {
    const runtime = (window as Window & { __livePreview?: { destroy(): void } }).__livePreview;
    runtime?.destroy();
    document.dispatchEvent(new Event('astro:after-swap'));
    document.dispatchEvent(new Event('astro:page-load'));
  });
  await page.waitForTimeout(100);
  expect(Number(await readyCount.textContent())).toBe(beforeDestroy);
});
