import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * The lean runtime in a real browser (`examples/pure-html`, which bakes both
 * artifacts into two otherwise identical pages). The unit suite proves what the
 * build left out; this proves the result still works where it counts — a page
 * with no framework at all, the floor every adapter stands on.
 */

const APP = 'http://localhost:4180';

async function open(page: Page, target: string): Promise<Frame> {
  await page.goto(`${APP}/admin.html?target=${encodeURIComponent(target)}`);
  const frame = await waitForPreviewFrame(page, target);
  await waitForStarted(frame);
  return frame;
}

test.describe('the lean profile', () => {
  test('is smaller than the full one, byte for byte', async ({ page }) => {
    const [full, lean] = await Promise.all([
      page.request.get(`${APP}/full.html`).then((response) => response.text()),
      page.request.get(`${APP}/lean.html`).then((response) => response.text()),
    ]);

    // The two pages differ only in which runtime they carry.
    expect(lean.length).toBeLessThan(full.length * 0.85);
  });

  test('patches the bindings it does carry', async ({ page }) => {
    const frame = await open(page, '/lean.html');

    await post(page, { title: 'Typed in the admin', subtitle: 'and the second field' });

    await expect(frame.getByTestId('title')).toHaveText('Typed in the admin');
    await expect(frame.getByTestId('subtitle')).toHaveText('and the second field');
  });

  test('leaves an array alone and says which feature it does not carry', async ({ page }) => {
    const messages: string[] = [];
    page.on('console', (message) => messages.push(message.text()));
    const frame = await open(page, '/lean.html');

    await post(page, { title: 'Still patched', tags: ['one', 'two', 'three'] });

    // The bound text is patched; the array is left exactly as rendered.
    await expect(frame.getByTestId('title')).toHaveText('Still patched');
    await expect(frame.getByTestId('tags').locator('li')).toHaveCount(1);
    await expect.poll(() => messages.join('\n')).toContain('LP0104');
    expect(messages.join('\n')).toContain('structural arrays');
  });

  test('the full profile renders the same array on the same markup', async ({ page }) => {
    const frame = await open(page, '/full.html');

    await post(page, { title: 'Full', tags: ['one', 'two', 'three'] });

    await expect(frame.getByTestId('tags').locator('li')).toHaveCount(3);
  });
});
