/**
 * The field findings against the REAL Payload admin: what jsdom cannot show is that
 * Payload's own messages carry what each of these rules reads. Row ids after a move, an
 * option's value and not its label, an edit in a rich-text block, the save event. The page
 * is `examples/pure-html/dist/findings.html`; the global is seeded on boot.
 */
import { expect, test, type Page } from '@playwright/test';
import { openLivePreviewPanel } from './live-preview-panel';

const PORT = process.env['PLP_REAL_PAYLOAD_PORT'] ?? '4477';
const IFRAME = `iframe[src*="localhost:${PORT}"]`;

interface Session {
  readonly lines: string[];
  readonly pageLoads: () => number;
}

async function open(page: Page): Promise<Session> {
  const lines: string[] = [];
  let loads = 0;
  page.on('console', (message) => lines.push(message.text()));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/findings.html') loads += 1;
  });
  await page.goto('/admin/globals/findings');
  await expect(page.locator('#field-title')).toBeVisible();
  await openLivePreviewPanel(page);
  const preview = page.frameLocator(IFRAME);
  await expect(preview.getByTestId('title')).toBeVisible({ timeout: 60_000 });
  return { lines, pageLoads: () => loads };
}

/** The first message has arrived once typing shows, and only then are baselines set. */
async function typeTitle(page: Page, text: string): Promise<void> {
  await page.locator('#field-title').fill(text);
  await expect(page.frameLocator(IFRAME).getByTestId('title')).toHaveText(text);
}

test.describe('real Payload admin → the field findings', () => {
  test('a moved row is reported, because Payload sends the ids of its rows', async ({ page }) => {
    const session = await open(page);
    await typeTitle(page, 'Before the move');
    await page
      .locator('.array-field .array-actions__button')
      .or(page.getByRole('button', { name: /^more options: row 0?1$/iu }))
      .first()
      .click();
    // A button in Payload 3, a menu item in Payload 4's redesign.
    await page
      .getByRole('button', { name: /^move down$/iu })
      .or(page.getByRole('menuitem', { name: /^move down$/iu }))
      .first()
      .click();
    const preview = page.frameLocator(IFRAME);
    await expect(preview.locator('li').first()).toHaveText('Second row');
    await expect
      .poll(() => session.lines.join('\n'))
      .toMatch(/LP0411[^\n]*rows\.0\.label[^\n]*stands in a row that moved/u);
  });

  test('a select shows its value and the page hears why', async ({ page }) => {
    const session = await open(page);
    await typeTitle(page, 'Before the option');
    await page.locator('#field-status .rs__control').click();
    await page.locator('.rs__option', { hasText: 'On sale' }).click();
    await expect(page.frameLocator(IFRAME).getByTestId('status')).toHaveText('sale');
    await expect
      .poll(() => session.lines.join('\n'))
      .toMatch(/LP0412: "status" showed "Coming soon", the patch wrote "soon"/u);
  });

  test('a page on the coverage default hears what 3.0 changes for its group', async ({ page }) => {
    const session = await open(page);
    await typeTitle(page, 'Before the coverage warning');
    await expect
      .poll(() => session.lines.join('\n'))
      .toMatch(/LP0204: no binding names "(?:rows|seo\.description)"/u);
  });

  test('an edit inside closed details opens them', async ({ page }) => {
    await open(page);
    // The first message only sets what later ones are compared with.
    await typeTitle(page, 'Before the closed box');
    const preview = page.frameLocator(IFRAME);
    await expect(preview.getByTestId('details')).not.toHaveAttribute('open');
    await page.locator('#field-deep').fill('Typed into the closed box');
    await expect(preview.getByTestId('deep')).toHaveText('Typed into the closed box');
    await expect(preview.getByTestId('details')).toHaveAttribute('open');
  });

  test('a chosen image replaces the sources of its picture', async ({ page }) => {
    await open(page);
    const preview = page.frameLocator(IFRAME);
    await page.locator('#field-photo button.upload__listToggler').click();
    // Payload 4 keeps the original under a name of its own, so the seed's filename can differ.
    await page.locator('dialog.list-drawer tbody tr').first().getByRole('button').first().click();
    const image = preview.getByTestId('photo');
    await expect(image).toHaveAttribute('src', /\/api\/media\/file\/e2e-pixel[^/]*\.png$/u);
    await expect(preview.locator('[data-testid="picture"] source')).toHaveCount(0);
    // What the browser shows, which a `<source>` left behind would have decided.
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.currentSrc))
      .toMatch(/\/api\/media\/file\/e2e-pixel[^/]*\.png$/u);
  });

  test('rich text names an internal link and reports an edit in a block it cannot draw', async ({
    page,
  }) => {
    const session = await open(page);
    const preview = page.frameLocator(IFRAME);
    const editor = page.locator('.rich-text-lexical [contenteditable="true"]');
    await editor.getByText('Seeded text').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed');
    await expect(preview.getByTestId('rich')).toContainText('typed');
    await expect(preview.locator('[data-testid="rich"] a')).toHaveAttribute(
      'href',
      /^\/users\/\d+$/u,
    );
    await expect(preview.getByTestId('callout')).toHaveText('Drawn by the server');
    await page.locator('.rich-text-lexical input[value="Seeded callout"]').fill('Changed');
    await expect
      .poll(() => session.lines.join('\n'))
      .toMatch(/LP0411[^\n]*rich[^\n]*changed a block no renderer draws/u);
  });

  // Last: it saves, and the other tests read the seeded document.
  test('an edit nothing on the page shows waits for the save, then the route refreshes', async ({
    page,
  }) => {
    const session = await open(page);
    await typeTitle(page, 'Typed title');
    const before = session.pageLoads();
    await page.locator('#field-notes').fill('Notes no element shows');
    await page.waitForTimeout(2_000);
    expect(session.pageLoads()).toBe(before);
    await page.locator('#action-save').click();
    await expect.poll(session.pageLoads, { timeout: 30_000 }).toBeGreaterThan(before);
  });
});
