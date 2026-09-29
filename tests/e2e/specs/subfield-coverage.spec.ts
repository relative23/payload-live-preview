import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * ADR 0022 in a browser. `examples/pure-html` bakes the same partly bound
 * group into two pages with the route strategy: `hero.eyebrow` is bound,
 * `hero.note` covered with `data-payload-covers`, `hero.description` shown by
 * nothing. Under `subfieldCoverage: 'declared'` only the description's edit
 * asks for the route; under the default, one bound child covers the group.
 */

const APP = 'http://localhost:4180';
const HERO = { eyebrow: 'Eyebrow', description: 'Saved description', note: 'Saved note' };

async function open(
  page: Page,
  target: string,
): Promise<{ frame: Frame; refreshes: () => number }> {
  let refreshes = 0;
  page.on('request', (request) => {
    if (request.headers()['x-payload-live-preview'] === 'route') refreshes += 1;
  });
  await page.goto(`${APP}/admin.html?target=${encodeURIComponent(target)}`);
  const frame = await waitForPreviewFrame(page, target);
  await waitForStarted(frame);
  // The saved document first: the page was rendered from it.
  await post(page, { hero: HERO });
  await expect(frame.getByTestId('eyebrow')).toHaveText('Eyebrow');
  return { frame, refreshes: () => refreshes };
}

/** A refresh would start in the same turn as the patch; give it a window before counting none. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(300);
}

test.describe("subfieldCoverage: 'declared'", () => {
  test('an edit of the unbound sibling asks for the route', async ({ page }) => {
    const { refreshes } = await open(page, '/groups-declared.html');

    await post(page, { hero: { ...HERO, description: 'Edited description' } });

    await expect.poll(refreshes).toBe(1);
  });

  test('an edit of the bound child is patched without a refresh', async ({ page }) => {
    const { frame, refreshes } = await open(page, '/groups-declared.html');

    await post(page, { hero: { ...HERO, eyebrow: 'Edited eyebrow' } });

    await expect(frame.getByTestId('eyebrow')).toHaveText('Edited eyebrow');
    await settle(page);
    expect(refreshes()).toBe(0);
  });

  test('an edit of the covered sibling asks for nothing', async ({ page }) => {
    const { refreshes } = await open(page, '/groups-declared.html');

    await post(page, { hero: { ...HERO, note: 'Edited note' } });

    await settle(page);
    expect(refreshes()).toBe(0);
  });
});

test.describe('the default coverage', () => {
  test('one bound child covers the group, so the unbound sibling asks for nothing', async ({
    page,
  }) => {
    const { refreshes } = await open(page, '/groups-descendant.html');

    await post(page, { hero: { ...HERO, description: 'Edited description' } });

    await settle(page);
    expect(refreshes()).toBe(0);
  });
});
