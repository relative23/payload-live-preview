/**
 * Three journeys drive the installed React hook or Vue composable through the real Payload 2 admin:
 * a replaced native owner, a document change by navigation and a reload of the preview frame. After
 * the replacement and after the reload the fresh owner has to refuse the updates it receives
 * without a schema, because Payload 2.32.3 sends the schema once per window; a restarted admin page,
 * a distinct provider, populates again. A held genuine collection GET marks the overlap; no v3
 * POST, synthetic schema or private session is used.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { join } = require('node:path');
const { test, expect } = require('./test-tool.cjs');
const { redactor } = require('../template/diagnostics.cjs');
const { choose, mark, open, saved, signIn, state } = require('./admin.cjs');
const settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));
const redact = redactor(settings);
const titles = settings.specTitles['native-lifecycle.spec.cjs'];
const MAX_PHASES = 12;

async function capture(page, phase, frame) {
  expect(page.__nativeProof.phases.length).toBeLessThan(MAX_PHASES);
  await mark(frame, phase);
  const proof = await state(frame);
  page.__nativeProof.phases.push({ phase, proof });
  return proof;
}

function activeOwner(proof, generation) {
  const owners = proof.owners.filter((value) => value.active && value.generation === generation);
  expect(owners).toHaveLength(1);
  return owners[0];
}

// A fresh owner starts from its own seed, idle and loading, before the admin sent it anything.
function ownInitial(owner) {
  expect(owner.firstSnapshotSeq).not.toBeNull();
  expect(owner.initialOwnData).toBe(true);
  expect(owner.initialRevision).toBe(0);
  expect(owner.initialStatus).toBe('idle');
  expect(owner.initialLoading).toBe(true);
  expect(owner.initialBeforeIngress).toBe(true);
}

// Handles to the receiver's and the admin's current documents, to tell a retired one from a kept one.
function receiverHandle(frame) {
  return frame.evaluateHandle(() => ({
    document,
    ledger: window.__r6,
    root: document.getElementById('app'),
  }));
}

function parentHandle(page) {
  return page.evaluateHandle(() => ({
    document,
    root: document.querySelector('.live-preview'),
  }));
}

async function retired(handle) {
  try {
    return !(await handle.evaluate((value) => value.document === document));
  } catch (error) {
    if (
      /Execution context was destroyed|Cannot find context|different context|disposed|Frame was detached/iu.test(
        error.message,
      )
    )
      return true;
    // Engines word a retired document differently; an unlisted wording stays visible in the refusal.
    throw new Error(
      'Receiver identity check failed outside the expected navigation boundary: ' +
        String(error?.message ?? error).split('\n')[0],
    );
  }
}

async function savedEqual(page, before, slug = 'homepage') {
  expect(isDeepStrictEqual(await saved(page, slug), before)).toBe(true);
}

// The seed the server rendered is the stored global, and the owner built on it.
async function ssrOwn(frame, expected) {
  const seed = await frame.evaluate(
    () => JSON.parse(document.getElementById('r6-props').textContent).initialData,
  );
  expect(isDeepStrictEqual(seed, expected)).toBe(true);
  ownInitial(activeOwner(await state(frame), 1));
}

async function populationLive(page, frame, name) {
  const before = (await state(frame)).calls.length;
  await choose(page, name);
  await expect(frame.getByTestId('author')).toHaveText(name);
  await expect(frame.getByTestId('status')).toHaveText('live');
  const calls = (await state(frame)).calls.slice(before);
  expect(
    calls.some((row) => row.authorPopulation && row.method === 'GET' && row.status === 200),
  ).toBe(true);
}

// Payload 2.32.3 sends the field schema with its first message to a window and again only when the
// window type changes, so an owner started later receives updates without one. It must refuse
// them: no REST read, no schema-less merge, its own seed kept.
async function schemaAbsentSafety(page, frame, name) {
  const before = await state(frame);
  const owner = before.owners.find((value) => value.active);
  expect(owner).toBeDefined();
  expect(
    before.traffic
      .filter((value) => value.seq > owner.bornSeq)
      .every((value) => value.schemaShape === 'absent'),
  ).toBe(true);
  await choose(page, name);
  await expect
    .poll(async () => (await state(frame)).traffic.length)
    .toBeGreaterThan(before.traffic.length);
  const ingress = (await state(frame)).traffic.slice(before.traffic.length);
  expect(ingress.length).toBeGreaterThan(0);
  expect(ingress.every((row) => row.schemaShape === 'absent' && !row.hasExplicitTarget)).toBe(true);
  await expect(frame.getByTestId('status')).toHaveText('unavailable');
  const after = await capture(page, 'schema-absent', frame);
  expect(after.activeSession.ownInitialData).toBe(true);
  expect(after.activeSession.revision).toBe(0);
  expect(after.activeSession.isLoading).toBe(false);
  expect(after.calls).toHaveLength(before.calls.length);
}

// A new admin page is a distinct provider: it sends a schema again, and both authors populate.
async function providerRecovery(page, oldFrame, before) {
  await capture(page, 'before-parent-restart', oldFrame);
  const oldParent = await parentHandle(page);
  const oldReceiver = await receiverHandle(oldFrame);
  const navigations = page.__nativeMainNavigations;
  const frame = await open(page);
  expect(page.__nativeMainNavigations).toBeGreaterThan(navigations);
  expect(await retired(oldParent)).toBe(true);
  expect(await retired(oldReceiver)).toBe(true);
  await ssrOwn(frame, before);
  await populationLive(page, frame, 'Ada Fixture');
  await populationLive(page, frame, 'Grace Fixture');
  await expect(frame.getByTestId('counter')).toHaveText('0');
  const proof = await capture(page, 'provider-recovery', frame);
  expect(proof.traffic.some((row) => row.schemaShape === 'array')).toBe(true);
  await savedEqual(page, before);
}

test.beforeEach(async ({ page }) => {
  page.__nativeWrites = [];
  page.__nativeReads = [];
  page.__nativeMainNavigations = 0;
  page.__nativeProof = {
    phases: [],
    overlap: 'NOT_APPLICABLE',
    routeCallbackFailed: false,
    snapshotUnavailable: false,
    hookChecksPassed: false,
  };
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) page.__nativeMainNavigations += 1;
  });
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== settings.admin) return;
    // This journey never saves: any write to a global or to the authors would be an editor's save.
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
      (url.pathname.startsWith('/api/globals/') || url.pathname.startsWith('/api/authors'))
    ) {
      if (page.__nativeWrites.length < 200) page.__nativeWrites.push({ editorWrite: true });
    }
    if (
      url.pathname === '/api/authors' &&
      request.method() === 'GET' &&
      url.searchParams.has('where[id][in]')
    ) {
      if (page.__nativeReads.length >= 200) return;
      const row = {
        authorPopulation: true,
        method: 'GET',
        originMatchesSite: false,
        hasCookie: false,
      };
      page.__nativeReads.push(row);
      void request
        .allHeaders()
        .then((headers) => {
          row.originMatchesSite = headers.origin === settings.site;
          row.hasCookie =
            typeof headers.cookie === 'string' && headers.cookie.includes('payload-token=');
        })
        .catch(() => undefined);
    }
  });
  await signIn(page);
});

test.afterEach(async ({ page }, info) => {
  try {
    expect(page.__nativeWrites).toEqual([]);
    // A case that failed before it read anything has said why; waiting here would add a second
    // timeout and a second, misleading message to its report.
    if (info.status === info.expectedStatus)
      await expect
        .poll(() => page.__nativeReads.some((row) => row.originMatchesSite && row.hasCookie))
        .toBe(true);
    const frame = page
      .frames()
      .find((value) => value.url().startsWith(settings.site + '/' + settings.surface));
    if (!frame) {
      page.__nativeProof.snapshotUnavailable = true;
      throw new Error('The final native receiver is unavailable');
    }
    try {
      await capture(page, 'final', frame);
    } catch {
      page.__nativeProof.snapshotUnavailable = true;
      throw new Error('The final native metadata snapshot is unavailable');
    }
    for (const value of page.__nativeProof.phases) {
      expect(value.proof.hydrationErrorCount).toBe(0);
      expect(value.proof.validationErrorCount).toBe(0);
    }
    page.__nativeProof.hookChecksPassed = true;
  } finally {
    // Written even when a check above failed: the record of a red case is what explains it.
    const key = createHash('sha256').update(info.testId).digest('hex').slice(0, 16);
    const bytes =
      redact(
        JSON.stringify({
          schemaVersion: 1,
          journey: Object.keys(titles).find((name) => titles[name] === info.title),
          testTitle: info.title,
          browser: info.project.name,
          statusAtAfterEach: info.status,
          expectedStatus: info.expectedStatus,
          retry: info.retry,
          surface: settings.surface,
          variant: settings.variant,
          archiveSHA256: settings.candidate.sha256,
          editorWriteCount: page.__nativeWrites.length,
          relationshipReadMetadata: page.__nativeReads,
          ...page.__nativeProof,
        }),
      ) + '\n';
    if (Buffer.byteLength(bytes) > 1024 * 1024)
      throw new Error('The journey record exceeds its bound');
    writeFileSync(
      join(settings.run, 'native-observation-' + info.project.name + '-' + key + '.json'),
      bytes,
      { flag: 'wx', mode: 0o600 },
    );
  }
});

test(titles.freshOwner, async ({ page }) => {
  const frame = await open(page);
  const beforeSaved = await saved(page);
  await ssrOwn(frame, beforeSaved);
  await populationLive(page, frame, 'Ada Fixture');
  await frame.getByTestId('counter').click();
  const original = await capture(page, 'initial', frame);
  const oldOwner = activeOwner(original, 1);
  const realm = await receiverHandle(frame);
  const answer = await page
    .context()
    .request.get(settings.admin + '/api/authors?where[name][equals]=Grace%20Fixture');
  expect(answer.status()).toBe(200);
  const grace = (await answer.json()).docs.find((row) => row.name === 'Grace Fixture');
  expect(grace).toBeDefined();
  let release;
  let observed = false;
  let callbackDone = false;
  const held = new Promise((done) => {
    release = done;
  });
  const endpoint = settings.admin + '/api/authors**';
  const interceptor = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() !== 'GET' ||
      !(url.searchParams.get('where[id][in]') ?? '').split(',').includes(String(grace.id))
    ) {
      await route.continue();
      return;
    }
    try {
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      await mark(frame, 'route-held');
      observed = true;
      await held;
      await route.fulfill({ response: actual }).catch(() => undefined);
    } catch {
      page.__nativeProof.routeCallbackFailed = true;
      throw new Error('Genuine held population route failed; response details withheld');
    } finally {
      try {
        await mark(frame, 'route-callback-ended');
      } finally {
        callbackDone = true;
      }
    }
  };
  await page.route(endpoint, interceptor);
  try {
    await choose(page, 'Grace Fixture');
    await expect.poll(() => observed).toBe(true);
    await mark(frame, 'restart-click');
    // The mounted restart control cleans the owner up and starts its replacement in one action.
    await frame.getByTestId('restart-preview').click();
    await expect(frame.getByTestId('scope')).toHaveText('active');
    await expect(frame.getByTestId('generation')).toHaveText('2');
    const freshProof = await capture(page, 'fresh-owner', frame);
    const fresh = activeOwner(freshProof, 2);
    ownInitial(fresh);
    const old = freshProof.owners.find((value) => value.id === oldOwner.id);
    expect(old.active).toBe(false);
    expect(old.cleanups.length).toBeGreaterThan(oldOwner.cleanups.length);
    expect(fresh.setups.length).toBeGreaterThanOrEqual(settings.surface === 'react' ? 2 : 1);
    // The replacement happened inside the same receiver document, ledger and root.
    expect(
      await frame.evaluate(
        (value) =>
          value.document === document &&
          value.ledger === window.__r6 &&
          value.root === document.getElementById('app'),
        realm,
      ),
    ).toBe(true);
    await expect(frame.getByTestId('counter')).toHaveText(settings.surface === 'vue' ? '1' : '0');
    const heldCall = freshProof.calls.find(
      (value) =>
        value.owner === old.id && value.authorPopulation && value.startSeq > original.sequence,
    );
    expect(heldCall).toBeDefined();
    expect(heldCall.aborted).toBe(true);
    await mark(frame, 'release');
    release();
    await expect.poll(() => callbackDone).toBe(true);
    await expect
      .poll(
        async () => (await state(frame)).calls.find((value) => value.id === heldCall.id).settled,
      )
      .toBe(true);
    const settled = await state(frame);
    const call = settled.calls.find((value) => value.id === heldCall.id);
    const freshSetup = fresh.setups[0];
    // What this measures is the late settlement of a read the old owner aborted before the fresh
    // owner started: a late 200 of a retired owner is not provoked here.
    const overlap = call.settledSeq > freshSetup;
    expect(
      settled.commits.filter((value) => value.owner === old.id && value.seq > freshSetup),
    ).toHaveLength(0);
    expect(settled.calls.filter((value) => value.owner === fresh.id)).toHaveLength(0);
    expect(
      settled.phases.find((value) => value.phase === 'route-callback-ended').seq,
    ).toBeGreaterThan(freshSetup);
    expect(settled.activeSession.ownInitialData).toBe(true);
    if (settings.surface === 'react') {
      expect(settled.strictSetups - original.strictSetups).toBeGreaterThanOrEqual(2);
      expect(settled.strictCleanups - original.strictCleanups).toBeGreaterThanOrEqual(1);
    } else {
      expect(settled.scopeStarts).toBe(2);
      expect(settled.scopeStops).toBe(1);
    }
    page.__nativeProof.overlap = overlap
      ? 'OBSERVED_NATIVE_FETCH_SETTLEMENT_AFTER_FRESH_SETUP'
      : 'NATIVE_FETCH_SETTLED_BEFORE_FRESH_SETUP';
    await page.unroute(endpoint, interceptor);
    await schemaAbsentSafety(page, frame, 'Ada Fixture');
    await savedEqual(page, beforeSaved);
    await providerRecovery(page, frame, beforeSaved);
  } finally {
    release();
    // Cleanup after a timeout meets a closed page; it must not replace the stalled action's own rejection.
    await page.unroute(endpoint, interceptor).catch(() => undefined);
  }
});

test(titles.documentNavigation, async ({ page }) => {
  const old = await open(page);
  const homepage = await saved(page);
  await ssrOwn(old, homepage);
  await page.locator('#field-title').fill('Unsaved old v2 document');
  await expect(old.getByTestId('title')).toHaveText('Unsaved old v2 document');
  await old.getByTestId('counter').click();
  await capture(page, 'initial', old);
  const oldParent = await parentHandle(page);
  const oldReceiver = await receiverHandle(old);
  const navigations = page.__nativeMainNavigations;
  const frame = await open(page, 'otherpage');
  const other = await saved(page, 'otherpage');
  expect(page.__nativeMainNavigations).toBeGreaterThan(navigations);
  expect(await retired(oldParent)).toBe(true);
  expect(await retired(oldReceiver)).toBe(true);
  expect(frame.url().includes('document=otherpage')).toBe(true);
  await ssrOwn(frame, other);
  await expect(frame.getByTestId('title')).toHaveText('Payload 2 other title');
  await expect(frame.getByTestId('counter')).toHaveText('0');
  await page.locator('#field-title').fill('Unsaved other v2 document');
  await expect(frame.getByTestId('title')).toHaveText('Unsaved other v2 document');
  await populationLive(page, frame, 'Grace Fixture');
  const proof = await capture(page, 'other-document', frame);
  expect(proof.document).toBe('otherpage');
  expect(proof.commits.some((value) => value.oldDocumentMarker)).toBe(false);
  await savedEqual(page, homepage);
  await savedEqual(page, other, 'otherpage');
});

test(titles.childReload, async ({ page }) => {
  const frame = await open(page);
  const before = await saved(page);
  await ssrOwn(frame, before);
  await populationLive(page, frame, 'Ada Fixture');
  await capture(page, 'initial', frame);
  const parent = await parentHandle(page);
  const receiver = await receiverHandle(frame);
  const navigations = page.__nativeMainNavigations;
  const response = await frame.goto(frame.url());
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html.includes('r6-props')).toBe(true);
  expect(html.includes('Payload 2 seeded title')).toBe(true);
  await expect.poll(() => frame.evaluate(() => window.__r6?.ready)).toBe(true);
  expect(await retired(receiver)).toBe(true);
  // Only the frame reloaded: the admin's own document and preview root stay.
  expect(page.__nativeMainNavigations).toBe(navigations);
  const retained = await page.evaluate(
    (value) => ({
      document: value.document === document,
      root: value.root !== null && value.root === document.querySelector('.live-preview'),
    }),
    parent,
  );
  expect(retained.document).toBe(true);
  expect(retained.root).toBe(true);
  await expect(frame.getByTestId('counter')).toHaveText('0');
  await ssrOwn(frame, before);
  await capture(page, 'child-reload-initial', frame);
  await schemaAbsentSafety(page, frame, 'Grace Fixture');
  await savedEqual(page, before);
  await providerRecovery(page, frame, before);
});
