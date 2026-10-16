/**
 * Real Payload 2 login and form edits drive the installed native consumers.
 * A held genuine collection GET proves browser disposal and stale-result
 * refusal; no v3 POST, synthetic schema or private session implementation is used.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { test, expect } = require('./test-tool.cjs');
const { redactor } = require('../template/diagnostics.cjs');
const settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));
const redact = redactor(settings);
const selector = `iframe.live-preview-iframe[src^="${settings.site}/${settings.surface}"]`;

async function state(frame) {
  return frame.evaluate(() => structuredClone(window.__r6));
}

async function open(page, slug = 'homepage') {
  await page.goto('/admin/globals/' + slug);
  await expect(page.locator('#field-title')).toBeVisible();
  await page.locator('a[href$="/admin/globals/' + slug + '/preview"]').click();
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
  await page.locator('#field-author').getByRole('combobox').click();
  await page
    .locator('#field-author .rs__option')
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

test.beforeEach(async ({ page }) => {
  page.__nativeWrites = [];
  page.__nativeReads = [];
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.origin === settings.admin &&
      url.pathname.startsWith('/api/globals/') &&
      request.method() === 'POST'
    )
      page.__nativeWrites.push({ path: url.pathname, method: request.method() });
    if (
      url.origin === settings.admin &&
      url.pathname === '/api/authors' &&
      request.method() === 'GET' &&
      url.searchParams.has('where[id][in]')
    ) {
      const row = {
        path: url.pathname,
        method: 'GET',
        query: url.search,
        origin: null,
        hasCookie: false,
      };
      page.__nativeReads.push(row);
      void request
        .allHeaders()
        .then((headers) => {
          row.origin = headers.origin ?? null;
          row.hasCookie =
            typeof headers.cookie === 'string' && headers.cookie.includes('payload-token=');
        })
        .catch(() => undefined);
    }
  });
  try {
    await page.goto('/admin/login');
    await page.locator('#field-email').fill(settings.email);
    await page.locator('#field-password').fill(settings.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/admin(?!\/login)/u);
  } catch {
    throw new Error('Real Payload 2 login failed; credential details withheld');
  }
});

test.afterEach(async ({ page }, info) => {
  expect(page.__nativeWrites).toEqual([]);
  await expect
    .poll(() => page.__nativeReads.some((row) => row.origin === settings.site && row.hasCookie))
    .toBe(true);
  const frame = page
    .frames()
    .find((value) => value.url().startsWith(settings.site + '/' + settings.surface));
  let proof = null;
  if (frame) {
    proof = await state(frame);
    expect(proof.hydrationErrors).toEqual([]);
    expect(proof.validationErrors).toEqual([]);
  }
  const key = createHash('sha256').update(info.testId).digest('hex').slice(0, 16);
  writeFileSync(
    join(settings.run, 'native-observation-' + info.project.name + '-' + key + '.json'),
    redact(
      JSON.stringify({
        test: info.title,
        status: info.status,
        surface: settings.surface,
        variant: settings.variant,
        archiveSHA256: settings.candidate.sha256,
        relationshipReadMetadata: page.__nativeReads,
        proof,
      }),
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
});

test('native disposal aborts a held real v2 read and a replacement accepts the next edit', async ({
  page,
}) => {
  const frame = await open(page);
  const beforeSaved = await saved(page);
  await choose(page, 'Ada Fixture');
  await expect(frame.getByTestId('author')).toHaveText('Ada Fixture');
  await frame.getByTestId('counter').click();
  const answer = await page
    .context()
    .request.get(settings.admin + '/api/authors?where[name][equals]=Grace%20Fixture');
  expect(answer.status()).toBe(200);
  const grace = (await answer.json()).docs.find((row) => row.name === 'Grace Fixture');
  expect(grace).toBeDefined();
  let release;
  const held = new Promise((done) => {
    release = done;
  });
  let observed = false;
  const endpoint = settings.admin + '/api/authors**';
  const interceptor = async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (
      request.method() !== 'GET' ||
      !(url.searchParams.get('where[id][in]') ?? '').split(',').includes(String(grace.id))
    ) {
      await route.continue();
      return;
    }
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    observed = true;
    await held;
    await route.fulfill({ response: actual }).catch(() => undefined);
  };
  await page.route(endpoint, interceptor);
  try {
    await choose(page, 'Grace Fixture');
    await expect.poll(() => observed).toBe(true);
    await frame.getByTestId('stop-preview').click();
    await expect(frame.getByTestId('scope')).toHaveText('stopped');
    await expect
      .poll(async () =>
        (await state(frame)).calls.some(
          (row) => row.query.includes(String(grace.id)) && row.aborted,
        ),
      )
      .toBe(true);
    const stopped = await state(frame);
    const commits = stopped.commits.length;
    release();
    await expect
      .poll(async () =>
        (await state(frame)).calls
          .filter((row) => row.query.includes(String(grace.id)))
          .every((row) => row.settled),
      )
      .toBe(true);
    expect((await state(frame)).commits).toHaveLength(commits);
    if (settings.surface === 'vue')
      await expect(frame.getByTestId('author')).toHaveText('Ada Fixture');
    else await expect(frame.getByTestId('title')).toHaveCount(0);
    await page.unroute(endpoint, interceptor);
    await frame.getByTestId('restart-preview').click();
    await expect(frame.getByTestId('scope')).toHaveText('active');
    await expect(frame.getByTestId('generation')).toHaveText('2');
    await expect(frame.getByTestId('author')).toHaveText('Grace Fixture');
    await choose(page, 'Ada Fixture');
    await expect(frame.getByTestId('author')).toHaveText('Ada Fixture');
    await expect(frame.getByTestId('counter')).toHaveText(settings.surface === 'vue' ? '1' : '0');
    const replacement = await state(frame);
    if (settings.surface === 'react') {
      expect(replacement.strictSetups - stopped.strictSetups).toBeGreaterThanOrEqual(2);
      expect(replacement.strictCleanups - stopped.strictCleanups).toBeGreaterThanOrEqual(1);
    } else {
      expect(replacement.scopeStarts).toBe(2);
      expect(replacement.scopeStops).toBe(1);
    }
    expect(await saved(page)).toEqual(beforeSaved);
  } finally {
    release();
    await page.unroute(endpoint, interceptor);
  }
});

test('the real v2 admin document change creates a fresh native consumer', async ({ page }) => {
  const old = await open(page);
  const homepage = await saved(page);
  await page.locator('#field-title').fill('Unsaved old v2 document');
  await expect(old.getByTestId('title')).toHaveText('Unsaved old v2 document');
  await old.getByTestId('counter').click();
  const frame = await open(page, 'otherpage');
  const other = await saved(page, 'otherpage');
  expect(frame.url()).toContain('document=otherpage');
  await expect(frame.getByTestId('title')).toHaveText('Payload 2 other title');
  await expect(frame.getByTestId('counter')).toHaveText('0');
  await page.locator('#field-title').fill('Unsaved other v2 document');
  await expect(frame.getByTestId('title')).toHaveText('Unsaved other v2 document');
  await choose(page, 'Grace Fixture');
  await expect(frame.getByTestId('author')).toHaveText('Grace Fixture');
  const proof = await state(frame);
  expect(proof.document).toBe('otherpage');
  expect(proof.commits.some((row) => row.marker === 'Unsaved old v2 document')).toBe(false);
  expect(await saved(page)).toEqual(homepage);
  expect(await saved(page, 'otherpage')).toEqual(other);
});

test('iframe reload starts from an authorized saved read and accepts a fresh real v2 schema', async ({
  page,
}) => {
  const frame = await open(page);
  const before = await saved(page);
  await choose(page, 'Ada Fixture');
  await expect(frame.getByTestId('author')).toHaveText('Ada Fixture');
  const response = await frame.goto(frame.url());
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('r6-props');
  expect(html).toContain('Payload 2 seeded title');
  await expect.poll(() => frame.evaluate(() => window.__r6?.ready)).toBe(true);
  await expect
    .poll(async () => (await state(frame)).traffic.some((row) => row.schemaShape === 'array'))
    .toBe(true);
  await expect(frame.getByTestId('counter')).toHaveText('0');
  await choose(page, 'Grace Fixture');
  await expect(frame.getByTestId('author')).toHaveText('Grace Fixture');
  expect(
    (await state(frame)).calls.some(
      (row) => row.path === '/api/authors' && row.method === 'GET' && row.status === 200,
    ),
  ).toBe(true);
  expect(await saved(page)).toEqual(before);
});
