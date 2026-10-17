/**
 * The real Payload 2 login, global form and relationship picker drive the installed React hook or
 * Vue composable, and the cases read what the admin sent, what the page fetched and what the tree
 * painted; two more probe the preview server's session check. A POST to the global would be a
 * saved write in Payload 2, so no case may send one, and none uses a Payload 3 override header, a
 * synthetic schema or a made-up entity slug. The titles come from lanes.json through the run file.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { test, expect } = require('./test-tool.cjs');
const { redactor } = require('../template/diagnostics.cjs');
const settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));
const redact = redactor(settings);
const titles = settings.specTitles['native-population.spec.cjs'];
const selector = `iframe.live-preview-iframe[src^="${settings.site}/${settings.surface}"]`;
const UNSAVED_SUBTITLE = 'Payload 2 native unsaved subtitle';

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

async function state(frame) {
  return frame.evaluate(() => structuredClone(window.__r6));
}

// What the admin posted to the preview, kept by the page itself from its first script on.
async function wire(frame) {
  return frame.evaluate(() => structuredClone(window.__populationWire));
}

// The hook has to be listening before the first edit. A live status and the schema packet in the
// consumer's own ledger show that it is, so a case that types at once does not race it.
async function open(page) {
  await page.goto('/admin/globals/homepage');
  await expect(page.locator('#field-title')).toBeVisible();
  await page.locator('a[href$="/admin/globals/homepage/preview"]').click();
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

async function saved(page) {
  const response = await page
    .context()
    .request.get(settings.admin + '/api/globals/homepage?depth=0');
  expect(response.status()).toBe(200);
  return response.json();
}

async function choose(page, name) {
  await page.locator('#field-author').getByRole('combobox').click();
  // react-select 5.7.4 gives its option divs no role, so Payload's rs prefix is the handle.
  await page
    .locator('#field-author .rs__option')
    .filter({ hasText: new RegExp('^' + name + '$', 'u') })
    .click();
}

async function probe(page, mode) {
  const response = await page
    .context()
    .request.get(settings.site + '/__probe/session?mode=' + mode);
  expect(response.status()).toBe(200);
  return response.json();
}

// The preview frame's own reads of the relationship collection: credentialed, from the site's
// origin and answered, which is what separates them from the admin picker's same-origin reads.
function populationReads(page) {
  return page.__requests.filter(
    (row) =>
      row.path === '/api/authors' &&
      row.method === 'GET' &&
      row.origin === settings.site &&
      row.hasSessionCookie &&
      row.status === 200 &&
      new URL(row.url).searchParams.has('where[id][in]'),
  );
}

test.beforeEach(async ({ page }) => {
  page.__requests = [];
  const rows = new Map();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== settings.admin || !url.pathname.startsWith('/api/')) return;
    const row = {
      url: url.href,
      path: url.pathname,
      method: request.method(),
      origin: null,
      hasSessionCookie: false,
      status: null,
    };
    rows.set(request, row);
    page.__requests.push(row);
    void request
      .allHeaders()
      .then((headers) => {
        row.origin = headers.origin ?? null;
        row.hasSessionCookie =
          typeof headers.cookie === 'string' && headers.cookie.includes('payload-token=');
      })
      .catch(() => undefined);
  });
  page.on('response', (response) => {
    const row = rows.get(response.request());
    if (row) row.status = response.status();
  });
  await page.addInitScript((admin) => {
    window.__populationWire = [];
    if (window.parent === window) return;
    window.addEventListener('message', (event) => {
      if (
        event.origin !== admin ||
        event.source !== window.parent ||
        event.data?.type !== 'payload-live-preview' ||
        !event.data.data
      )
        return;
      if (window.__populationWire.length >= 200 || JSON.stringify(event.data).length > 65_536)
        return;
      window.__populationWire.push({
        origin: event.origin,
        parentSource: true,
        packet: structuredClone(event.data),
      });
    });
  }, settings.admin);
  await signIn(page);
});

test.afterEach(async ({ page }, info) => {
  const frame = page
    .frames()
    .find((candidate) => candidate.url().startsWith(settings.site + '/' + settings.surface));
  let observation;
  if (frame) {
    try {
      observation = await frame.evaluate(() => ({
        wire: window.__populationWire,
        ledger: structuredClone(window.__r6),
        status: document.querySelector('[data-testid=status]')?.textContent,
        title: document.querySelector('[data-testid=title]')?.textContent,
      }));
    } catch {
      observation = { unavailable: true };
    }
  }
  const key = createHash('sha256').update(info.testId).digest('hex').slice(0, 16);
  writeFileSync(
    join(settings.run, 'population-observation-' + info.project.name + '-' + key + '.json'),
    redact(
      JSON.stringify(
        {
          test: info.title,
          status: info.status,
          surface: settings.surface,
          variant: settings.variant,
          archiveSHA256: settings.candidate.sha256,
          requests: page.__requests,
          observation,
        },
        null,
        2,
      ),
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  expect(
    page.__requests.filter((row) => row.method === 'POST' && row.path.startsWith('/api/globals/')),
  ).toEqual([]);
});

test(titles.hydration, async ({ page, browser }, info) => {
  const frame = await open(page);
  await expect(frame.getByTestId('title')).toHaveText('Payload 2 seeded title');
  const traffic = await wire(frame);
  expect(traffic.length).toBeGreaterThan(0);
  expect(traffic.every((row) => row.origin === settings.admin && row.parentSource)).toBe(true);
  expect(traffic.some((row) => Array.isArray(row.packet.fieldSchemaJSON))).toBe(true);
  expect(
    traffic.every(
      (row) =>
        !Object.hasOwn(row.packet, 'globalSlug') && !Object.hasOwn(row.packet, 'collectionSlug'),
    ),
  ).toBe(true);
  const proof = await state(frame);
  expect(proof.hydrationErrors).toEqual([]);
  expect(proof.validationErrors).toEqual([]);
  writeFileSync(
    join(settings.run, 'browser-' + info.project.name + '.json'),
    JSON.stringify(
      {
        name: info.project.name,
        version: browser.version(),
        surface: settings.surface,
        variant: settings.variant,
        archiveSHA256: settings.candidate.sha256,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  await expect(frame.getByTestId('status')).toHaveText('live');
  await expect(frame.getByTestId('error')).toHaveCount(0);
});

test(titles.unsavedTitle, async ({ page }) => {
  const frame = await open(page);
  const before = await saved(page);
  await page.locator('#field-title').fill('Payload 2 native unsaved title');
  await expect(frame.getByTestId('title')).toHaveText('Payload 2 native unsaved title');
  expect(await saved(page)).toEqual(before);
});

test(titles.sessionSchema, async ({ page }) => {
  const frame = await open(page);
  await page.locator('#field-subtitle').fill(UNSAVED_SUBTITLE);
  // The admin sends the schema once; this packet carries the new value without it.
  await expect
    .poll(async () =>
      (await wire(frame)).some(
        (row) =>
          row.packet.data.subtitle === UNSAVED_SUBTITLE && row.packet.fieldSchemaJSON === undefined,
      ),
    )
    .toBe(true);
  await expect(frame.getByTestId('subtitle')).toHaveText(UNSAVED_SUBTITLE);
  await expect(frame.getByTestId('status')).toHaveText('live');
});

test(titles.markupAsText, async ({ page }) => {
  const frame = await open(page);
  const markup = '<img src=x onerror=alert(1)>Payload 2 native';
  await page.locator('#field-title').fill(markup);
  await expect(frame.getByTestId('title')).toHaveText(markup);
  await expect(frame.getByTestId('title').locator('img')).toHaveCount(0);
});

test(titles.populatedRelationship, async ({ page }) => {
  const frame = await open(page);
  const before = await saved(page);
  await choose(page, 'Ada Fixture');
  await expect
    .poll(async () => (await wire(frame)).some((row) => typeof row.packet.data.author === 'string'))
    .toBe(true);
  await expect.poll(() => populationReads(page).length).toBeGreaterThan(0);
  await expect(frame.getByTestId('author')).toHaveText('Ada Fixture');
  await expect(frame.getByTestId('status')).toHaveText('live');
  expect(await saved(page)).toEqual(before);
});

test(titles.nextRelationship, async ({ page }) => {
  const frame = await open(page);
  await choose(page, 'Ada Fixture');
  await expect(frame.getByTestId('author')).toHaveText('Ada Fixture');
  const reads = populationReads(page).length;
  await choose(page, 'Grace Fixture');
  await expect(frame.getByTestId('author')).toHaveText('Grace Fixture');
  await expect.poll(() => populationReads(page).length).toBeGreaterThan(reads);
  expect((await saved(page)).author).toBeNull();
});

test(titles.editorSession, async ({ page, request }) => {
  const path = '/' + settings.surface + '?preview=true';
  const anonymous = await request.get(settings.site + path);
  expect(anonymous.status()).toBe(200);
  const publicPage = await anonymous.text();
  expect(publicPage).not.toContain('r6-props');
  expect(publicPage).not.toContain('Payload 2 seeded title');
  const editor = await page.context().request.get(settings.site + path);
  expect(editor.status()).toBe(200);
  const editorPage = await editor.text();
  expect(editorPage).toContain('r6-props');
  expect(editorPage).toContain('Payload 2 seeded title');
});

test(titles.csrfVariant, async ({ page }) => {
  const original = await probe(page, 'default');
  expect(original.authorized).toBe(true);
  expect(original.calls).toEqual([{ path: '/api/users/me', hasCookie: true, origin: null }]);
  expect(original.payloadHeaderNames).toEqual(['cookie']);
  const site = await probe(page, 'site');
  expect(site.authorized).toBe(true);
  expect(site.calls).toEqual([{ path: '/api/users/me', hasCookie: true, origin: settings.site }]);
  const admin = await probe(page, 'admin');
  expect(admin.authorized).toBe(settings.variant === 'server-url');
  expect(admin.calls).toHaveLength(1);
  const unlisted = await probe(page, 'unlisted');
  expect(unlisted.authorized).toBe(false);
  expect(unlisted.calls).toHaveLength(1);
});
