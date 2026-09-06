import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * The unbound-fields overlay (`examples/vanilla-client`, the npm-import path
 * where plugins exist at all). Two pages carry the same markup — one binding,
 * `title` — and differ only in whether the client runs with `debug: true`.
 */

const APP = 'http://localhost:4181';
const PANEL = '#payload-live-preview-unbound';

async function open(page: Page, target: string): Promise<Frame> {
  await page.goto(`${APP}/admin.html?target=${encodeURIComponent(target)}`);
  const frame = await waitForPreviewFrame(page, target);
  await waitForStarted(frame, '__lpClient');
  return frame;
}

test.describe('the unbound-fields overlay', () => {
  test('lists what the page cannot show, and offers the attribute for it', async ({ page }) => {
    const frame = await open(page, '/overlay.html');

    await post(page, { title: 'Bound', subtitle: 'nowhere to land', tags: ['a'] });

    // Located by text, not by role: the panel is `aria-hidden`, because a
    // development tool has no business in the preview's accessibility tree.
    const panel = frame.locator(PANEL);
    await expect(panel).toBeVisible();
    const entry = (name: string) => panel.locator('button', { hasText: name });
    await expect(entry('subtitle')).toBeVisible();
    await expect(entry('tags')).toBeVisible();
    // `title` has a binding, so it is not on the list.
    await expect(panel.locator('button')).toHaveCount(2);

    // That the click reaches the clipboard is asserted in the unit test, where
    // `navigator.clipboard` can be observed; here it is the affordance that
    // matters, and the confirmation the editor actually sees.
    await entry('subtitle').click();
    await expect(entry('subtitle ✓')).toBeVisible();
  });

  test('stays away when the client is not in debug mode', async ({ page }) => {
    const frame = await open(page, '/overlay-quiet.html');

    await post(page, { title: 'Bound', subtitle: 'nowhere to land' });

    await expect(frame.getByTestId('title')).toHaveText('Bound');
    await expect(frame.locator(PANEL)).toHaveCount(0);
  });
});
