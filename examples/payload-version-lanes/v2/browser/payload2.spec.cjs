/**
 * Drive the real Payload 2 form, its preview tab and its own postMessage stream.
 * Session probes execute the installed candidate against the real /me route;
 * this suite supplies no fake Payload traffic or fake authorization response.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { expect, test } = require('./test-tool.cjs');
const { signIn } = require('./admin.cjs');
const settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));
const iframe = `iframe.live-preview-iframe[src^="${settings.site}"]`;

async function openPreview(page) {
  await page.addInitScript((admin) => {
    window.__p2Wire = [];
    if (window.parent === window) return;
    window.addEventListener('message', (event) => {
      if (
        event.origin === admin &&
        event.source === window.parent &&
        event.data?.type === 'payload-live-preview' &&
        event.data.data
      ) {
        const document = event.data.data;
        window.__p2Wire.push({
          type: event.data.type,
          origin: event.origin,
          fieldSchemaJSON: event.data.fieldSchemaJSON,
          data: {
            title: document.title,
            subtitle: document.subtitle,
            author:
              typeof document.author === 'object' && document.author !== null
                ? { id: document.author.id, name: document.author.name }
                : document.author,
          },
        });
      }
    });
  }, settings.admin);
  await page.goto('/admin/globals/homepage');
  await expect(page.locator('#field-title')).toBeVisible();
  // Payload 2 owns a dedicated preview route, unlike the Payload 3 toggler.
  const tab = page.locator('a[href$="/admin/globals/homepage/preview"]');
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.locator(iframe)).toBeVisible();
  await expect(page.locator(iframe)).toHaveAttribute('src', /[?&]preview=true(?:&|$)/u);
  const preview = page.frameLocator(iframe);
  await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();
  return preview;
}

async function sessionProbe(page, mode) {
  const response = await page
    .context()
    .request.get(settings.site + '/__probe/session?mode=' + mode);
  expect(response.status()).toBe(200);
  return response.json();
}

test.beforeEach(async ({ page }) => signIn(page));

test('the packed plugin supplies the preview URL and Payload 2 schema is observed', async ({
  page,
  browser,
}, info) => {
  const preview = await openPreview(page);
  await expect
    .poll(() =>
      preview.locator('body').evaluate(() => window.__livePreview?.inspect().protocol.profile),
    )
    .toBe('payload-2');
  const inspection = await preview.locator('body').evaluate(() => window.__livePreview.inspect());
  expect(inspection.version).toBe(settings.candidate.version);
  expect(inspection.protocol.observed).toContain('schema-json');
  const wire = await preview.locator('body').evaluate(() => window.__p2Wire);
  expect(wire.some((entry) => Array.isArray(entry.fieldSchemaJSON))).toBe(true);
  expect(wire.every((entry) => entry.origin === settings.admin)).toBe(true);
  writeFileSync(
    join(settings.run, 'wire-' + info.project.name + '.json'),
    JSON.stringify(wire, null, 2) + '\n',
  );
  writeFileSync(
    join(settings.run, 'browser-' + info.project.name + '.json'),
    JSON.stringify(
      {
        name: info.project.name,
        version: browser.version(),
        runtimeVersion: inspection.version,
        protocol: inspection.protocol,
      },
      null,
      2,
    ) + '\n',
  );
});

test('unsaved title reaches the preview and leaves the database unchanged', async ({ page }) => {
  const preview = await openPreview(page);
  await page.locator('#field-title').fill('Payload 2 unsaved title');
  await expect(preview.locator('[data-payload-field="title"]')).toHaveText(
    'Payload 2 unsaved title',
  );
  const saved = await page.context().request.get(settings.admin + '/api/globals/homepage?depth=0');
  expect(saved.status()).toBe(200);
  expect((await saved.json()).title).toBe('Payload 2 seeded title');
});

test('unsaved subtitle reaches the preview', async ({ page }) => {
  const preview = await openPreview(page);
  await page.locator('#field-subtitle').fill('Payload 2 unsaved subtitle');
  await expect(preview.locator('[data-payload-field="subtitle"]')).toHaveText(
    'Payload 2 unsaved subtitle',
  );
});

test('markup typed into a scalar remains text', async ({ page }) => {
  const preview = await openPreview(page);
  await page.locator('#field-title').fill('<img src=x onerror=alert(1)>Payload 2');
  await expect(preview.locator('[data-payload-field="title"]')).toHaveText(
    '<img src=x onerror=alert(1)>Payload 2',
  );
  await expect(preview.locator('[data-payload-field="title"] img')).toHaveCount(0);
});

test('a relationship chosen in the admin reaches the populated preview field', async ({
  page,
}, info) => {
  const preview = await openPreview(page);
  const optionsRequest = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.origin === settings.admin &&
      url.pathname === '/api/authors' &&
      response.request().method() === 'GET'
    );
  });
  await page.locator('#field-author').getByRole('combobox').click();
  const optionsResponse = await optionsRequest;
  expect(optionsResponse.status()).toBe(200);
  const requestHeaders = await optionsResponse.request().allHeaders();
  expect(
    typeof requestHeaders.cookie === 'string' && requestHeaders.cookie.includes('payload-token='),
  ).toBe(true);
  writeFileSync(
    join(settings.run, 'relationship-picker-' + info.project.name + '.json'),
    JSON.stringify(
      {
        path: '/api/authors',
        method: 'GET',
        status: optionsResponse.status(),
        hasSessionCookie: true,
      },
      null,
      2,
    ) + '\n',
  );
  // react-select 5.7.4's option divs have no role=option; Payload gives them its rs prefix.
  await page
    .locator('#field-author .rs__option')
    .filter({ hasText: /^Ada Fixture$/u })
    .click();
  await expect
    .poll(() =>
      preview
        .locator('body')
        .evaluate(() => window.__p2Wire.some((entry) => entry.data.author != null)),
    )
    .toBe(true);
  const wire = await preview.locator('body').evaluate(() => window.__p2Wire);
  writeFileSync(
    join(settings.run, 'relationship-wire-' + info.project.name + '.json'),
    JSON.stringify(wire, null, 2) + '\n',
  );
  await expect(preview.locator('[data-payload-field="author.name"]')).toHaveText('Ada Fixture');
});

test('the real session gates runtime injection and the initial global read', async ({
  page,
  request,
}) => {
  const anonymous = await request.get(settings.site + '/?preview=true');
  expect(anonymous.status()).toBe(200);
  expect(await anonymous.text()).not.toContain('__livePreview');
  const editor = await page.context().request.get(settings.site + '/?preview=true');
  expect(editor.status()).toBe(200);
  expect(await editor.text()).toContain('__livePreview');
  expect(await editor.text()).toContain('Payload 2 seeded title');
});

test('Payload 2 authorizes cookie-only without triggering the new Origin retry', async ({
  page,
}) => {
  const result = await sessionProbe(page, 'default');
  expect(result.authorized).toBe(true);
  expect(result.outcome).toBe('authorized');
  expect(result.calls).toEqual([{ path: '/api/users/me', hasCookie: true, origin: null }]);
  expect(result.payloadHeaderNames).toEqual(['cookie']);
});

test('an explicitly listed origin is accepted and an unlisted origin is refused', async ({
  page,
}) => {
  const listed = await sessionProbe(page, 'site');
  expect(listed.authorized).toBe(true);
  expect(listed.calls).toEqual([{ path: '/api/users/me', hasCookie: true, origin: settings.site }]);
  expect(listed.payloadHeaderNames).toEqual(['cookie', 'origin']);
  const unlisted = await sessionProbe(page, 'unlisted');
  expect(unlisted.authorized).toBe(false);
  expect(unlisted.calls).toHaveLength(1);
  expect(unlisted.payloadHeaderNames).toEqual([]);
  const admin = await sessionProbe(page, 'admin');
  expect(admin.authorized).toBe(settings.variant === 'server-url');
  expect(admin.calls).toEqual([{ path: '/api/users/me', hasCookie: true, origin: settings.admin }]);
  expect(admin.payloadHeaderNames).toEqual(
    settings.variant === 'server-url' ? ['cookie', 'origin'] : [],
  );
});
