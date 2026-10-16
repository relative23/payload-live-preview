/**
 * Observe the stock admin's saved-document event and populated relationship.
 * This is one deliberately separate native characterization per browser, with
 * the family identity fixed by the installed consumer rather than its wire.
 */
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('actual saved-document and relationship wire is characterized without version-derived protocol grants', async ({
  page,
}, info) => {
  const admin = process.env.PLP_R6_ADMIN;
  const work = process.env.PLP_R6_WORK;
  const frontend = 'http://localhost:' + process.env.PLP_R6_FRONTEND_PORT;
  try {
    await page.goto(admin + '/admin/login');
    await page.locator('#field-email').fill('e2e@example.com');
    await page.locator('#field-password').fill('test1234');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/admin(?!\/login)/u);
  } catch {
    throw Error('Isolated wire-fixture sign-in did not complete');
  }
  const preview = page.frameLocator('iframe[src*="' + frontend + '"]');
  let rows = [];
  try {
    await page.goto(admin + '/admin/globals/homepage');
    await expect(page.locator('#field-title')).toBeEditable({ timeout: 60_000 });
    const panel = page.locator('.live-preview-window');
    const visible = () => panel.evaluate((element) => element.offsetWidth > 0).catch(() => false);
    if (!(await visible())) {
      await page.locator('.live-preview-toggler').click();
      await expect.poll(visible).toBe(true);
    }
    await expect(preview.getByTestId('title')).toBeVisible({ timeout: 60_000 });
    const marker = 'Wire characterization ' + info.project.name;
    await page.locator('#field-title').fill(marker);
    await expect(preview.getByTestId('title')).toHaveText(marker);
    await expect(preview.getByTestId('author')).toHaveText('e2e@example.com');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(
        () =>
          preview
            .locator('body')
            .evaluate(() =>
              (window.__r6?.wireMetadata ?? []).some(
                (row) => row.type === 'payload-document-event',
              ),
            ),
        { timeout: 20_000 },
      )
      .toBe(true);
    // This API request holds the same editor cookie and names the configured
    // admin origin, so the explicit CSRF list applies to the actual saved read.
    const saved = await page
      .context()
      .request.get(admin + '/api/globals/homepage?depth=1', { headers: { Origin: admin } });
    expect(saved.status()).toBe(200);
    const data = await saved.json();
    expect(data.title).toBe(marker);
    expect(data.author.email).toBe('e2e@example.com');
  } finally {
    let timeout;
    try {
      rows = await Promise.race([
        preview.locator('body').evaluate(() => (window.__r6?.wireMetadata ?? []).slice(-128)),
        new Promise((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Bounded wire observation unavailable')),
            1000,
          );
        }),
      ]);
    } catch {
      /* The missing observation remains explicit. */
    } finally {
      clearTimeout(timeout);
    }
    const directory = resolve(work, 'observations', info.project.name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, 'wire-shape-saved-document.json'),
      JSON.stringify(
        {
          archiveSHA256: process.env.PLP_R6_ARCHIVE_SHA,
          payloadVersion: process.env.PLP_VERSION_LANE_VERSION,
          browser: info.project.name,
          rows,
          credentialValuesRetained: false,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
});
