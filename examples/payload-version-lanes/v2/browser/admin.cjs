/**
 * What the native Payload 2 specs do alike in the real admin: sign in through the form, open the
 * preview of a global, pick an author in the relationship field, read the stored global with the
 * editor's cookie and export the receiver's record. The run file supplies the origins and the
 * ephemeral credentials; a failed login names no credential.
 */
const { readFileSync } = require('node:fs');
const { expect } = require('./test-tool.cjs');
const settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));
const selector = `iframe.live-preview-iframe[src^="${settings.site}/${settings.surface}"]`;

async function signIn(page) {
  try {
    await page.goto('/admin/login');
    await page.locator('#field-email').fill(settings.email);
    await page.locator('#field-password').fill(settings.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/admin(?!\/login)/u);
  } catch {
    throw new Error('Real Payload 2 form login did not complete; credential details withheld');
  }
}

/** The receiver's closed record: owners, ingress, reads and checkpoints, never a value or header. */
function state(frame) {
  return frame.evaluate(() => window.__r6Witness.export());
}

/**
 * Open the global's preview tab and wait until the hook listens: the page served as a preview
 * navigation, a live status and the first schema packet in the receiver's own record. Typing at
 * once would otherwise race the hook.
 */
async function open(page, slug = 'homepage') {
  await page.goto('/admin/globals/' + slug);
  await expect(page.locator('#field-title')).toBeVisible();
  const response = page.waitForResponse(
    (value) =>
      value.url().startsWith(settings.site + '/' + settings.surface) &&
      value.request().isNavigationRequest(),
    { timeout: 20_000 },
  );
  await page.locator('a[href$="/admin/globals/' + slug + '/preview"]').click();
  const html = await response;
  expect(html.status()).toBe(200);
  expect((await html.text()).includes('r6-props')).toBe(true);
  await expect(page.locator(selector)).toHaveAttribute('src', /[?&]preview=true(?:&|$)/u);
  const element = await page.locator(selector).elementHandle();
  const frame = await element.contentFrame();
  expect(frame).not.toBeNull();
  await expect.poll(() => frame.evaluate(() => window.__r6?.ready)).toBe(true);
  await expect(frame.getByTestId('status')).toHaveText('live');
  await expect
    .poll(async () => (await state(frame)).traffic.some((row) => row.schemaShape === 'array'))
    .toBe(true);
  return frame;
}

async function choose(page, name) {
  const field = page.locator('#field-author');
  const combobox = field.getByRole('combobox');
  // Firefox keeps the picker's input as the admin document's focused element after a click inside
  // the preview frame: the next click on it opens the menu and the late blur closes it again. An
  // editor goes back to the form between two picks; do the same with the title field (focus only).
  await page.locator('#field-title').click();
  await combobox.click();
  // Opening the picker is this helper's own precondition: say so in seconds when it did not happen.
  await expect(combobox, 'the author picker opened').toHaveAttribute('aria-expanded', 'true', {
    timeout: 5_000,
  });
  // react-select 5.7.4 gives its option divs no role, so Payload's rs prefix is the handle.
  await field
    .locator('.rs__option')
    .filter({ hasText: new RegExp('^' + name + '$', 'u') })
    .click();
}

async function saved(page, slug = 'homepage') {
  const response = await page
    .context()
    .request.get(settings.admin + '/api/globals/' + slug + '?depth=0');
  expect(response.status()).toBe(200);
  return response.json();
}

module.exports = { choose, open, saved, signIn, state };
