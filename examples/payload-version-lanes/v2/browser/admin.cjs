/**
 * What the native Payload 2 specs do alike in the real admin: sign in through the form, open the
 * preview of a global, pick an author in the relationship field, read the stored global and the id
 * of an author with the editor's cookie, hold the genuine read of an author, keep what the admin
 * posted to the preview, and export the receiver's record. The run file supplies the origins and the
 * ephemeral credentials; a failed login names no credential.
 */
const { readFileSync } = require('node:fs');
const { expect } = require('./test-tool.cjs');
const settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));
// Playwright repeats a read whose pooled connection the server reset (a "socket hang up") up to this
// many times; no other error is repeated and a case never is.
const READ_RETRIES = 3;
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
    .request.get(settings.admin + '/api/globals/' + slug + '?depth=0', {
      maxRetries: READ_RETRIES,
    });
  expect(response.status()).toBe(200);
  return response.json();
}

/** The text of every element the consumer marks with a test id, read at once and without waiting. */
function dom(frame) {
  return frame.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-testid]')].map((element) => [
        element.getAttribute('data-testid'),
        element.textContent,
      ]),
    ),
  );
}

/** A checkpoint named by the spec, with the sequence number the receiver's record gives it. */
function mark(frame, phase) {
  return frame.evaluate((value) => window.__r6Witness.checkpoint(value), phase);
}

/** The preview frame of the admin document, however many other frames a case has added. */
async function previewFrame(page) {
  const element = await page.locator(selector).elementHandle();
  return element ? element.contentFrame() : null;
}

/** A bounded window in the page itself, for a case that has to see that nothing happens. */
function settle(frame, milliseconds = 300) {
  return frame.evaluate((ms) => new Promise((done) => setTimeout(done, ms)), milliseconds);
}

/**
 * Wait until the receiver's record stops growing. The admin may post a second message for one edit
 * (the form validates a little later and posts again), and a case that counts what one message
 * caused has to start after that.
 */
async function quiet(frame, { stableFor = 600, limit = 10_000 } = {}) {
  const started = Date.now();
  let last = '';
  let since = started;
  while (Date.now() - started < limit) {
    const proof = await state(frame);
    const size = [
      proof.traffic.length,
      proof.refusedTraffic.length,
      proof.snapshots.length,
      proof.calls.length,
      proof.commits.length,
    ].join();
    if (size !== last) {
      last = size;
      since = Date.now();
    } else if (Date.now() - since >= stableFor) return;
    await settle(frame, 100);
  }
  throw new Error('The record of the receiver did not settle');
}

async function authorId(page, name) {
  const response = await page
    .context()
    .request.get(settings.admin + '/api/authors?where[name][equals]=' + encodeURIComponent(name), {
      maxRetries: READ_RETRIES,
    });
  expect(response.status()).toBe(200);
  const author = (await response.json()).docs.find((row) => row.name === name);
  expect(author).toBeDefined();
  return author.id;
}

/**
 * Hold the genuine population read of one author. The backend answers; the page receives that answer
 * only when the case lets go, so nothing is invented. A read the page aborts meanwhile finds its
 * request closed and the delivery is dropped. `observed` resolves once the answer is in hand,
 * `ended` when the route callback is over.
 */
function holdRead(page, id, { onHeld } = {}) {
  let release;
  let seen;
  let finish;
  const gate = new Promise((done) => {
    release = done;
  });
  const observed = new Promise((done) => {
    seen = done;
  });
  const ended = new Promise((done) => {
    finish = done;
  });
  const endpoint = settings.admin + '/api/authors**';
  const interceptor = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() !== 'GET' ||
      !(url.searchParams.get('where[id][in]') ?? '').split(',').includes(String(id))
    ) {
      await route.continue();
      return;
    }
    try {
      const actual = await route.fetch({ maxRetries: READ_RETRIES });
      expect(actual.status()).toBe(200);
      await onHeld?.();
      seen();
      await gate;
      await route.fulfill({ response: actual }).catch(() => undefined);
    } finally {
      finish();
    }
  };
  return {
    observed,
    ended,
    release,
    hold: () => page.route(endpoint, interceptor),
    // After a timeout the page is closed already; this must not replace the stalled step's own error.
    drop: async () => {
      release();
      await page.unroute(endpoint, interceptor).catch(() => undefined);
    },
  };
}

/**
 * Keep what the admin posts to the preview, from the preview's first script on, so that a case can
 * replay a real message or compare what was sent with what the page did. Only the admin's own
 * messages are kept: the origin and the window are the admin's.
 */
async function recordWire(page) {
  await page.addInitScript((admin) => {
    window.__adminWire = [];
    if (window.parent === window) return;
    window.addEventListener('message', (event) => {
      if (
        event.origin !== admin ||
        event.source !== window.parent ||
        event.data?.type !== 'payload-live-preview' ||
        !event.data.data
      )
        return;
      if (window.__adminWire.length >= 200 || JSON.stringify(event.data).length > 65_536) return;
      window.__adminWire.push({
        origin: event.origin,
        parentSource: true,
        packet: structuredClone(event.data),
      });
    });
  }, settings.admin);
}

function wire(frame) {
  return frame.evaluate(() => structuredClone(window.__adminWire));
}

module.exports = {
  authorId,
  choose,
  dom,
  holdRead,
  mark,
  open,
  previewFrame,
  quiet,
  recordWire,
  saved,
  settle,
  signIn,
  state,
  wire,
};
