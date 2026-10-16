/**
 * Actual Payload editing supplies the positive lifecycle messages and real
 * credentialed REST population. Receiver/source counterchecks separately replay
 * a captured real message; they are not relabeled as natural admin delivery.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { redact } from './diagnostics.mjs';

const surface = process.env.PLP_R6_SURFACE;
const work = process.env.PLP_R6_WORK;
const admin = process.env.PLP_R6_ADMIN;
const frontend = process.env.PLP_R6_FRONTEND;
const archiveSHA = process.env.PLP_R6_ARCHIVE_SHA;
let browserVersion;
const selector = 'iframe[src*="' + frontend + '/' + surface + '.html"]';

async function preview(page) {
  await expect(page.locator(selector)).toBeVisible({ timeout: 60_000 });
  const element = await page.locator(selector).elementHandle();
  const frame = await element.contentFrame();
  assert.ok(frame);
  await expect.poll(() => frame.evaluate(() => window.__r6?.ready === true)).toBe(true);
  return frame;
}

async function readLedger(frame) {
  return frame.evaluate(() => {
    const { observedWindows: _ignored, ...safe } = window.__r6;
    return structuredClone(safe);
  });
}

async function receiverCheckpoint(frame, info, phase, fallback) {
  let timeout;
  try {
    const observed = await Promise.race([
      frame.evaluate(() => {
        const state = window.__r6;
        const text = (name) =>
          document.querySelector('[data-testid="' + name + '"]')?.textContent?.slice(0, 2048) ??
          null;
        return structuredClone({
          ingress: {
            count: state.traffic.length,
            recent: state.traffic.slice(-16),
            refusedCount: state.refusedTraffic.length,
            refusedRecent: state.refusedTraffic.slice(-16),
          },
          activeSession: state.activeSession,
          rest: { count: state.calls.length, recent: state.calls.slice(-64) },
          commits: { count: state.commits.length, recent: state.commits.slice(-64) },
          dom: Object.fromEntries(
            ['title', 'status', 'revision', 'counter', 'error'].map((name) => [name, text(name)]),
          ),
          lifecycle: {
            ready: state.ready,
            document: state.document,
            target: state.target,
            strictSetups: state.strictSetups,
            strictCleanups: state.strictCleanups,
            scopeStarts: state.scopeStarts,
            scopeStops: state.scopeStops,
          },
          hydrationErrors: state.hydrationErrors.slice(-16),
          validationErrors: state.validationErrors.slice(-16),
        });
      }),
      new Promise((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Bounded receiver observation unavailable')),
          1000,
        );
      }),
    ]);
    const encoded = redact(JSON.stringify(observed));
    assert.ok(Buffer.byteLength(encoded) <= 512 * 1024, 'Receiver observation exceeds its bound');
    const safe = JSON.parse(encoded);
    await writeProof(info, 'receiver-diagnostic-' + phase, {
      diagnosticOnly: true,
      phase,
      observed: safe,
      capturedNow: true,
    });
    return safe;
  } catch {
    // Diagnostics cannot replace the original assertion error. The fallback
    // explicitly names an older checkpoint instead of claiming fresh delivery.
    await writeProof(info, 'receiver-diagnostic-' + phase, {
      diagnosticOnly: true,
      phase,
      capturedNow: false,
      lastCheckpoint: fallback ?? null,
      failure: 'Bounded receiver observation unavailable',
    }).catch(() => undefined);
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

async function openGlobal(page, slug) {
  await page.goto('/admin/globals/' + slug);
  await expect(page.locator('#field-title')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const panel = page.locator('.live-preview-window');
  const open = async () => panel.evaluate((element) => element.offsetWidth > 0).catch(() => false);
  if (!(await open())) {
    await page.locator('.live-preview-toggler').click();
    await expect.poll(open).toBe(true);
  }
  const frame = await preview(page);
  await expect(frame.getByTestId('title')).toHaveText('Seeded ' + slug, { timeout: 60_000 });
  await expect(frame.getByTestId('status')).toHaveText('live');
  await expect(frame.getByTestId('author')).toHaveText('e2e@example.com');
  return frame;
}

async function edit(page, frame, marker) {
  await page.locator('#field-title').fill(marker);
  await expect(frame.getByTestId('title')).toHaveText(marker);
  await expect(frame.getByTestId('status')).toHaveText('live');
  await expect
    .poll(async () =>
      (await readLedger(frame)).calls.some(
        (row) => row.marker === marker && row.status === 200 && row.settled,
      ),
    )
    .toBe(true);
}

async function writeProof(info, name, value) {
  const folder = resolve(work, 'observations', info.project.name);
  await mkdir(folder, { recursive: true });
  await writeFile(
    resolve(folder, name + '.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        surface,
        archiveSHA256: archiveSHA,
        browser: { name: info.project.name, version: browserVersion },
        testID: info.testId,
        observedAt: new Date().toISOString(),
        ...value,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

test.afterEach(async ({ page }) => {
  const element = await page.locator(selector).elementHandle();
  const frame = await element?.contentFrame();
  if (frame) expect((await readLedger(frame)).validationErrors).toEqual([]);
});

test.beforeEach(async ({ page, request, browser }) => {
  browserVersion = browser.version();
  const remote = await request.get(frontend + '/__r6/identity');
  expect(remote.status()).toBe(200);
  const identity = await remote.json();
  expect(identity.archive.sha256).toBe(archiveSHA);
  const local = JSON.parse(await readFile(resolve(work, 'identity.json'), 'utf8'));
  expect(identity).toEqual(local);
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  try {
    await page.goto('/admin/login');
    await page.locator('#field-email').fill('e2e@example.com');
    await page.locator('#field-password').fill('test1234');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/admin(?!\/login)/u);
  } catch {
    throw new Error('Real Payload 3 form login did not complete; credential details withheld');
  }
  await openGlobal(page, 'homepage');
});

test('native SSR hydrates without recovery errors and actual editor traffic populates its relationship', async ({
  page,
  request,
}, info) => {
  const shell = await request.get(frontend + '/' + surface + '.html?document=homepage');
  expect(shell.status()).toBe(200);
  expect(await shell.text()).toContain('Initial homepage');
  const frame = await preview(page);
  await edit(page, frame, 'Actual ' + surface + ' admin edit');
  const proof = await readLedger(frame);
  expect(proof.hydrationErrors).toEqual([]);
  const traffic = proof.traffic.filter(
    (row) =>
      row.marker === 'Actual ' + surface + ' admin edit' &&
      row.target === 'primary' &&
      row.parentSource,
  );
  const calls = proof.calls.filter((row) => row.marker === 'Actual ' + surface + ' admin edit');
  expect(traffic.length).toBeGreaterThan(0);
  expect(calls).toHaveLength(traffic.length);
  expect(calls.every((row) => row.path === '/api/globals/homepage' && row.method === 'POST')).toBe(
    true,
  );
  if (surface === 'react') {
    // React 19.2.8 hydrates this native tree once. StrictMode's additional
    // setup/cleanup belongs to the measured client remount below.
    expect(proof.strictSetups).toBe(1);
    expect(proof.strictCleanups).toBe(0);
  } else expect(proof.scopeStarts).toBe(1);
  await writeProof(info, 'actual-admin-ssr-edit', {
    provenance: 'natural real-admin typing and real REST population',
    proof,
  });
});

test('native unmount or scope disposal aborts held REST work and a replacement accepts the next real edit', async ({
  page,
}, info) => {
  const frame = await preview(page);
  await frame.getByTestId('counter').click();
  await expect(frame.getByTestId('counter')).toHaveText('1');
  const marker = 'Held real ' + surface + ' merge';
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let observed;
  const seen = new Promise((resolve) => {
    observed = resolve;
  });
  const endpoint = admin + '/api/globals/homepage';
  const interceptor = async (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || request.postDataJSON()?.data?.title !== marker) {
      await route.continue();
      return;
    }
    // Fetch the genuine backend answer first. Only browser delivery is held;
    // no invented Response replaces Payload and no physical server abort is claimed.
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    observed();
    await held;
    await route.fulfill({ response: actual }).catch(() => undefined);
  };
  await page.route(endpoint + '**', interceptor);
  try {
    await page.locator('#field-title').fill(marker);
    await seen;
    await frame.getByTestId('stop-preview').click();
    await expect(frame.getByTestId('scope')).toHaveText('stopped');
    await expect
      .poll(async () =>
        (await readLedger(frame)).calls
          .filter((row) => row.marker === marker)
          .some((row) => row.aborted),
      )
      .toBe(true);
    release();
    await expect
      .poll(async () =>
        (await readLedger(frame)).calls
          .filter((row) => row.marker === marker)
          .every((row) => row.settled),
      )
      .toBe(true);
    expect((await readLedger(frame)).commits.some((row) => row.marker === marker)).toBe(false);
    const beforeRestart = await readLedger(frame);
    await frame.getByTestId('restart-preview').click();
    await expect(frame.getByTestId('scope')).toHaveText('active');
    await expect(frame.getByTestId('generation')).toHaveText('2');
    const replacement = 'Replacement real ' + surface + ' merge';
    await edit(page, frame, replacement);
    await expect(frame.getByTestId('counter')).toHaveText(surface === 'vue' ? '1' : '0');
    const proof = await readLedger(frame);
    const updates = proof.traffic.filter(
      (row) => row.target === 'primary' && row.marker === replacement,
    );
    expect(updates.length).toBeGreaterThan(0);
    expect(proof.calls.filter((row) => row.marker === replacement)).toHaveLength(updates.length);
    if (surface === 'react') {
      const strictDeltas = {
        setups: proof.strictSetups - beforeRestart.strictSetups,
        cleanups: proof.strictCleanups - beforeRestart.strictCleanups,
      };
      expect(strictDeltas.setups).toBeGreaterThanOrEqual(2);
      expect(strictDeltas.cleanups).toBeGreaterThanOrEqual(1);
    } else {
      expect(proof.scopeStarts).toBe(2);
      expect(proof.scopeStops).toBe(1);
    }
    expect(proof.hydrationErrors).toEqual([]);
    await writeProof(info, 'actual-admin-native-stop-restart', {
      provenance:
        'natural real-admin edit; held real REST response; native browser abort observed; client remount deltas measured from the disposed instance',
      beforeRestart,
      proof,
    });
  } finally {
    release();
    await page.unroute(endpoint + '**', interceptor);
  }
});

test('changing the real admin document creates a fresh native consumer for the other global', async ({
  page,
}, info) => {
  const old = await preview(page);
  await edit(page, old, 'Unsaved old global');
  await old.getByTestId('counter').click();
  const before = await readLedger(old);
  const frame = await openGlobal(page, 'otherpage');
  expect(frame.url()).toContain('document=otherpage');
  await expect(frame.getByTestId('counter')).toHaveText('0');
  await edit(page, frame, 'Actual changed document');
  const after = await readLedger(frame);
  expect(after.document).toBe('otherpage');
  expect(after.commits.some((row) => row.marker === 'Unsaved old global')).toBe(false);
  expect(
    after.calls
      .filter((row) => row.marker === 'Actual changed document')
      .every((row) => row.path === '/api/globals/otherpage'),
  ).toBe(true);
  expect(after.hydrationErrors).toEqual([]);
  await writeProof(info, 'actual-admin-document-change', {
    provenance:
      'actual admin route/global change; document identity uses a new consumer instance, not a changed initialData object',
    before,
    after,
  });
});

test('receiver changes retire the original target and refuse a same-origin foreign sender', async ({
  page,
}, info) => {
  const frame = await preview(page);
  let checkpoint;
  try {
    await edit(page, frame, 'Before native receiver change');
    await frame.getByTestId('counter').click();
    const index = await page.evaluate(async (origin) => {
      const element = document.createElement('iframe');
      element.dataset.r6Target = 'secondary';
      const loaded = new Promise((resolve) =>
        element.addEventListener('load', resolve, { once: true }),
      );
      element.src = origin + '/message-target.html';
      document.body.append(element);
      await loaded;
      return Array.from(window.frames).indexOf(element.contentWindow);
    }, frontend);
    await page
      .locator(selector)
      .evaluate(
        (element, index) =>
          element.contentWindow.postMessage(
            { type: 'r6-control', action: 'target', index },
            new URL(element.src).origin,
          ),
        index,
      );
    await expect.poll(async () => (await readLedger(frame)).target).toBe('secondary');
    await expect(frame.getByTestId('title')).toHaveText('Initial homepage');
    await expect(frame.getByTestId('revision')).toHaveText('0');
    await expect(frame.getByTestId('counter')).toHaveText('1');
    checkpoint = await receiverCheckpoint(frame, info, 'after-target-control', checkpoint);
    const retired = 'Actual edit sent to retired receiver';
    await page.locator('#field-title').fill(retired);
    await expect
      .poll(async () =>
        (await readLedger(frame)).traffic.some(
          (row) => row.target === 'primary' && row.marker === retired && row.parentSource,
        ),
      )
      .toBe(true);
    await page.waitForTimeout(1000);
    const afterRetired = await readLedger(frame);
    expect(afterRetired.calls.some((row) => row.marker === retired)).toBe(false);
    expect(afterRetired.commits.some((row) => row.marker === retired)).toBe(false);
    checkpoint = await receiverCheckpoint(frame, info, 'after-retired-delivery', checkpoint);
    const message = afterRetired.traffic.findLast(
      (row) => row.target === 'primary' && row.marker === retired,
    ).message;
    await page.evaluate(
      ({ index, message, origin }) => window.frames[index].postMessage(message, origin),
      { index, message, origin: frontend },
    );
    await expect(frame.getByTestId('title')).toHaveText(retired);
    checkpoint = await receiverCheckpoint(frame, info, 'after-replay-delivery', checkpoint);
    await expect
      .poll(
        async () =>
          (await readLedger(frame)).calls.filter(
            (row) => row.marker === retired && row.status === 200,
          ).length,
      )
      .toBe(1);
    const beforeForeign = await readLedger(frame);
    const foreignElement = await page.evaluateHandle(async () => {
      const element = document.createElement('iframe');
      const loaded = new Promise((resolve) =>
        element.addEventListener('load', resolve, { once: true }),
      );
      element.src = 'about:blank';
      document.body.append(element);
      await loaded;
      return element;
    });
    const foreign = await foreignElement.asElement().contentFrame();
    assert.ok(foreign);
    const countercheck = structuredClone(message);
    countercheck.data.title = 'Wrong allowed-origin sender';
    await foreign.evaluate(
      ({ index, message, origin }) => window.parent.frames[index].postMessage(message, origin),
      { index, message: countercheck, origin: frontend },
    );
    await expect
      .poll(async () =>
        (await readLedger(frame)).refusedTraffic.some(
          (row) =>
            row.target === 'secondary' &&
            row.marker === countercheck.data.title &&
            row.reason === 'wrong-source',
        ),
      )
      .toBe(true);
    await page.waitForTimeout(1000);
    const after = await readLedger(frame);
    expect(after.calls.some((row) => row.marker === countercheck.data.title)).toBe(false);
    expect(after.commits.some((row) => row.marker === countercheck.data.title)).toBe(false);
    await expect(frame.getByTestId('title')).toHaveText(retired);
    expect(after.hydrationErrors).toEqual([]);
    await writeProof(info, 'native-receiver-source-counterchecks', {
      provenance:
        'natural real-admin edit observed on retired receiver; captured real message replayed by actual admin to active receiver; native foreign-window sender countercheck',
      targetIndex: index,
      afterRetired,
      beforeForeign,
      after,
    });
  } finally {
    await receiverCheckpoint(frame, info, 'finally', checkpoint);
  }
});

// This observer reports bounded message shape, never fields or credential values.
test.afterEach(async ({ page }, info) => {
  let rows = [];
  for (const frame of page.frames().filter((value) => value.url().startsWith(frontend))) {
    let timer;
    try {
      rows.push(
        ...(await Promise.race([
          frame.evaluate(() => (window.__r6?.wireMetadata ?? []).slice(-128)),
          new Promise((done) => {
            timer = setTimeout(() => done([]), 1000);
          }),
        ])),
      );
    } catch {
      /* A closed frame supplies no proof. */
    } finally {
      clearTimeout(timer);
    }
  }
  rows = rows.slice(-128);
  const directory = resolve(work, 'observations', info.project.name);
  await mkdir(directory, { recursive: true });
  const name = info.title.includes('hydrates')
    ? 'ssr'
    : info.title.includes('disposal')
      ? 'restart'
      : info.title.includes('document creates')
        ? 'document'
        : 'receiver';
  await writeFile(
    resolve(directory, 'wire-shape-' + name + '.json'),
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
});
