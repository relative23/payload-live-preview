import { expect, test } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * A custom renderer is a function, so it reaches a page only through a
 * bundled client: `examples/vanilla-client` registers `fixture:money` in a
 * plugin, and a static page's inline script has no way to carry one (H20).
 */

const ADMIN = 'http://localhost:4181/admin.html';

test('a bundled client renders a field through the project renderer its plugin registered', async ({
  page,
}) => {
  await page.goto(`${ADMIN}?target=/index.html`);
  const frame = await waitForPreviewFrame(page, '/index.html');
  await waitForStarted(frame, '__lpClient');

  await post(page, { title: 'Priced', price: 1234.5 });

  await expect(frame.getByTestId('title')).toHaveText('Priced');
  await expect(frame.getByTestId('price')).toHaveText('$1,234.50');
});
