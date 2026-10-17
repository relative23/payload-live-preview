/**
 * Guards around the installed React hook or Vue composable in the real Payload 2 admin: a late
 * answer to a replaced owner, messages from windows and origins the hook must not take, a receiver
 * switch in a running session, and a sign-out in the middle of one. A message that is sent again is
 * a recorded real message of the admin with a marker as its title; a case reads what the hook did
 * from its own record and from the tree, and gives a refusal a bounded window to show itself. The
 * titles come from lanes.json through the run file; no case saves anything.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { test, expect } = require('./test-tool.cjs');
const { redactor } = require('../template/diagnostics.cjs');
const {
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
} = require('./admin.cjs');
const {
  BY_ADDRESS,
  addFrame,
  postFrom,
  postFromAdmin,
  previewIndex,
  selectReceiver,
  setKnobs,
} = require('./senders.cjs');
const settings = JSON.parse(readFileSync(process.env.PLP_P2_RUN_FILE, 'utf8'));
const redact = redactor(settings);
const titles = settings.specTitles['native-guards.spec.cjs'];
const SEEDED = 'Payload 2 seeded title';

// What the receiver recorded and painted once the admin has stopped posting.
async function glance(frame) {
  await quiet(frame);
  return { proof: await state(frame), tree: await dom(frame) };
}

// The first message the admin posted carries the schema; with a marker title and an author whose
// read the hook has to make, it is a real message that a taker shows itself by painting.
async function recorded(page, frame) {
  const first = (await wire(frame)).find((row) => Array.isArray(row.packet.fieldSchemaJSON));
  expect(first).toBeDefined();
  const author = String(await authorId(page, 'Ada Fixture'));
  return (title) => ({ ...first.packet, data: { ...first.packet.data, title, author } });
}

// The hook took the message: its title and author are painted, one more read was answered and one
// more commit was written.
async function expectTaken(frame, before, title) {
  await expect(frame.getByTestId('title')).toHaveText(title);
  await expect(frame.getByTestId('author')).toHaveText('Ada Fixture');
  await expect(frame.getByTestId('status')).toHaveText('live');
  await settle(frame, 200);
  const after = await state(frame);
  expect(after.calls).toHaveLength(before.proof.calls.length + 1);
  expect(after.calls.at(-1)).toMatchObject({ authorPopulation: true, method: 'GET', status: 200 });
  expect(after.commits).toHaveLength(before.proof.commits.length + 1);
}

// Nothing moved in the hook or the tree: no read, no commit, the same painted values.
function expectUntouched(before, after) {
  expect(after.proof.calls).toHaveLength(before.proof.calls.length);
  expect(after.proof.commits).toHaveLength(before.proof.commits.length);
  expect(after.tree).toEqual(before.tree);
}

// The record turned this message of this sender away and, after a bounded window, the hook had not
// taken it either: no accepted row, no read, no commit, the same painted values.
async function expectRefused(frame, before, { reason, title, origin }) {
  await expect
    .poll(async () => (await state(frame)).refusedTraffic.length)
    .toBe(before.proof.refusedTraffic.length + 1);
  await settle(frame);
  const after = await glance(frame);
  expect(after.proof.refusedTraffic.at(-1)).toEqual(
    expect.objectContaining({ target: 'primary', reason, origin, marker: title }),
  );
  expect(after.proof.traffic).toHaveLength(before.proof.traffic.length);
  expect(after.proof.foreignOrigin).toBe(
    before.proof.foreignOrigin + (reason === 'foreign-origin' ? 1 : 0),
  );
  expectUntouched(before, after);
}

// How many of the admin's messages reached the window that the hook has left.
const retiredRows = (proof) => proof.traffic.filter((row) => row.target === 'primary').length;

test.beforeEach(async ({ page }) => {
  page.__writes = [];
  page.__facts = {};
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    // No case saves: any write to a global or to the authors would be an editor's save.
    if (
      url.origin === settings.admin &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
      (url.pathname.startsWith('/api/globals/') || url.pathname.startsWith('/api/authors'))
    )
      page.__writes.push({ editorWrite: true });
  });
  await recordWire(page);
  await signIn(page);
});

test.afterEach(async ({ page }, info) => {
  let proof = null;
  try {
    expect(page.__writes).toEqual([]);
    const frame = await previewFrame(page);
    if (frame && info.status === info.expectedStatus) {
      proof = await state(frame);
      expect(proof.hydrationErrorCount).toBe(0);
      expect(proof.validationErrorCount).toBe(0);
    }
  } finally {
    // Written even when a check above failed: the record of a red case is what explains it.
    const key = createHash('sha256').update(info.testId).digest('hex').slice(0, 16);
    writeFileSync(
      join(settings.run, 'guards-observation-' + info.project.name + '-' + key + '.json'),
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
          editorWriteCount: page.__writes.length,
          facts: page.__facts,
          proof,
        }),
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
});

test(titles.lateResponse, async ({ page }) => {
  await setKnobs(page, { fetch: 'stubborn' });
  const frame = await open(page);
  const index = await previewIndex(page);
  const message = await recorded(page, frame);
  const before = await saved(page);
  await choose(page, 'Ada Fixture');
  await expect(frame.getByTestId('author')).toHaveText('Ada Fixture');
  const retired = (await state(frame)).owners.find((owner) => owner.active);
  const read = holdRead(page, await authorId(page, 'Grace Fixture'));
  await read.hold();
  try {
    await choose(page, 'Grace Fixture');
    await read.observed;
    const clicked = await mark(frame, 'restart-click');
    await frame.getByTestId('restart-preview').click();
    await expect(frame.getByTestId('generation')).toHaveText('2');
    await expect(frame.getByTestId('scope')).toHaveText('active');
    await settle(frame);
    const restarted = await glance(frame);
    const fresh = restarted.proof.owners.find((owner) => owner.active);
    expect(fresh.id).not.toBe(retired.id);
    // The reads still in flight are the old owner's. The hook aborted them when the owner went, not
    // before: the consumer's fetch ignores the abort, so the browser's requests go on.
    const inflight = restarted.proof.calls.filter((call) => call.authorPopulation && !call.settled);
    expect(inflight.length).toBeGreaterThan(0);
    expect(inflight.every((call) => call.owner === retired.id && call.aborted)).toBe(true);
    const held = inflight.at(-1);
    expect(held.abortSeq).toBeGreaterThan(clicked);
    // The replacement takes a recorded message of its own: that is the state a late answer could damage.
    await postFromAdmin(page, index, message('State of the replacement'));
    await expectTaken(frame, restarted, 'State of the replacement');
    const replaced = await glance(frame);
    await mark(frame, 'release');
    read.release();
    await read.ended;
    await expect
      .poll(async () => (await state(frame)).calls.find((call) => call.id === held.id).settled)
      .toBe(true);
    await settle(frame, 500);
    const late = await glance(frame);
    const answer = late.proof.calls.find((call) => call.id === held.id);
    // The genuine answer did arrive, after the replacement had its state ...
    expect(answer).toMatchObject({ aborted: true, threw: false, status: 200 });
    expect(answer.settledSeq).toBeGreaterThan(replaced.proof.commits.at(-1).seq);
    // ... and it changed nothing: no commit, no snapshot, no read, the same tree.
    expect(late.proof.commits).toEqual(replaced.proof.commits);
    expect(late.proof.snapshots).toEqual(replaced.proof.snapshots);
    expect(late.proof.calls).toHaveLength(replaced.proof.calls.length);
    expect(late.tree).toEqual(replaced.tree);
    // The replacement goes on alone: the next edit is read and committed by it, not by the retired one.
    await page.locator('#field-title').fill('Typed after the late answer');
    await expect(frame.getByTestId('title')).toHaveText('Typed after the late answer');
    await expect(frame.getByTestId('author')).toHaveText('Grace Fixture');
    const { proof: after } = await glance(frame);
    // However many messages the admin posted for the edit, all of them are the replacement's.
    const newCalls = after.calls.slice(late.proof.calls.length);
    const newCommits = after.commits.slice(late.proof.commits.length);
    expect(newCalls.length).toBeGreaterThan(0);
    expect(newCalls.every((call) => call.owner === fresh.id && call.authorPopulation)).toBe(true);
    expect(newCommits.length).toBeGreaterThan(0);
    expect(newCommits.every((commit) => commit.owner === fresh.id)).toBe(true);
    expect(await saved(page)).toEqual(before);
  } finally {
    await read.drop();
  }
});

test(titles.foreignSenders, async ({ page }) => {
  const frame = await open(page);
  const index = await previewIndex(page);
  const message = await recorded(page, frame);
  let before = await glance(frame);
  // The admin's own window: the control that the message itself is acceptable.
  await postFromAdmin(page, index, message('From the admin window'));
  await expectTaken(frame, before, 'From the admin window');
  // A window of the admin's origin that is not the admin: the source check refuses it.
  const sibling = await addFrame(page, 'blank');
  before = await glance(frame);
  await postFrom(sibling.frame, index, message('From another window of the admin origin'));
  await expectRefused(frame, before, {
    reason: 'wrong-source',
    title: 'From another window of the admin origin',
    origin: settings.admin,
  });
  // The preview's own server reached by its address: another origin, another window.
  const elsewhere = await addFrame(page, 'address');
  before = await glance(frame);
  await postFrom(elsewhere.frame, index, message('From another origin'));
  await expectRefused(frame, before, {
    reason: 'foreign-origin',
    title: 'From another origin',
    origin: BY_ADDRESS,
  });
  // The refusals left the session working.
  before = await glance(frame);
  await postFromAdmin(page, index, message('From the admin window again'));
  await expectTaken(frame, before, 'From the admin window again');
});

test(titles.originAlone, async ({ page }) => {
  await setKnobs(page, { policy: 'any' });
  const frame = await open(page);
  const index = await previewIndex(page);
  const message = await recorded(page, frame);
  // With every window allowed, a window of the admin's origin is taken: only the origin is checked.
  const sibling = await addFrame(page, 'blank');
  let before = await glance(frame);
  await postFrom(sibling.frame, index, message('From another window of the admin origin'));
  await expectTaken(frame, before, 'From another window of the admin origin');
  // The record only accepts the admin's own window as the admin; it lists this one apart.
  expect((await state(frame)).refusedTraffic.at(-1)).toMatchObject({
    reason: 'wrong-source',
    marker: 'From another window of the admin origin',
  });
  // An origin nobody listed is still refused, and the origin check is the only one left to do it.
  const elsewhere = await addFrame(page, 'address');
  before = await glance(frame);
  await postFrom(elsewhere.frame, index, message('From an origin that is not listed'));
  await expectRefused(frame, before, {
    reason: 'foreign-origin',
    title: 'From an origin that is not listed',
    origin: BY_ADDRESS,
  });
});

test(titles.noOriginLock, async ({ page }) => {
  await setKnobs(page, { policy: 'any', origins: [BY_ADDRESS] });
  const frame = await open(page);
  const index = await previewIndex(page);
  const message = await recorded(page, frame);
  // The first message the hook takes comes from the admin's origin.
  await page.locator('#field-title').fill('From the first origin');
  await expect(frame.getByTestId('title')).toHaveText('From the first origin');
  // A second origin that is listed is taken afterwards: the hook did not lock to the first.
  const listed = await addFrame(page, 'address');
  let before = await glance(frame);
  await postFrom(listed.frame, index, message('From the second listed origin'));
  await expectTaken(frame, before, 'From the second listed origin');
  before = await glance(frame);
  await postFromAdmin(page, index, message('Back from the first origin'));
  await expectTaken(frame, before, 'Back from the first origin');
  // An origin that is not listed is still refused.
  const unlisted = await addFrame(page, 'opaque');
  before = await glance(frame);
  await postFrom(unlisted.frame, index, message('From an origin that is not listed'));
  await expectRefused(frame, before, {
    reason: 'foreign-origin',
    title: 'From an origin that is not listed',
    origin: 'null',
  });
});

test(titles.receiverSwitch, async ({ page }) => {
  const frame = await open(page);
  const index = await previewIndex(page);
  const message = await recorded(page, frame);
  const before = await saved(page);
  await page.locator('#field-title').fill('Before the receiver change');
  await expect(frame.getByTestId('title')).toHaveText('Before the receiver change');
  // An author in the form: a hook that kept listening on the old window would read it again.
  await choose(page, 'Ada Fixture');
  await expect(frame.getByTestId('author')).toHaveText('Ada Fixture');
  await frame.getByTestId('counter').click();
  const receiver = await addFrame(page, 'site');
  const switchSeq = await mark(frame, 'target-switch');
  await selectReceiver(page, receiver.index);
  await expect.poll(async () => (await state(frame)).target).toBe('secondary');
  // The new session starts from the seed again; the component's own state stays.
  await expect(frame.getByTestId('title')).toHaveText(SEEDED);
  await expect(frame.getByTestId('revision')).toHaveText('0');
  await expect(frame.getByTestId('status')).toHaveText('idle');
  await expect(frame.getByTestId('counter')).toHaveText('1');
  await settle(frame);
  const switched = await glance(frame);
  expect(switched.proof.activeSession).toMatchObject({ ownInitialData: true, revision: 0 });
  // The admin goes on posting to the window it framed: the retired receiver takes nothing.
  await page.locator('#field-title').fill('Sent to the retired receiver');
  await expect
    .poll(async () => retiredRows(await state(frame)))
    .toBeGreaterThan(retiredRows(switched.proof));
  await settle(frame);
  const retired = await glance(frame);
  expect(retired.proof.calls.filter((call) => call.startSeq > switchSeq)).toEqual([]);
  expect(retired.proof.commits).toHaveLength(switched.proof.commits.length);
  expect(retired.tree).toEqual(switched.tree);
  // The recorded message, sent by the admin to the new receiver, acts there exactly once.
  await postFromAdmin(page, receiver.index, message('Sent again to the new receiver'));
  await expectTaken(frame, retired, 'Sent again to the new receiver');
  await expect(frame.getByTestId('revision')).toHaveText('1');
  await settle(frame, 400);
  const acted = await state(frame);
  expect(acted.calls.filter((call) => call.startSeq > switchSeq)).toEqual([
    expect.objectContaining({ target: 'secondary', authorPopulation: true, status: 200 }),
  ]);
  expect(acted.traffic.filter((row) => row.target === 'secondary')).toHaveLength(1);
  expect(await saved(page)).toEqual(before);
});

test(titles.receiverSwitchHeld, async ({ page }) => {
  await setKnobs(page, { fetch: 'stubborn' });
  const frame = await open(page);
  const message = await recorded(page, frame);
  const before = await saved(page);
  const read = holdRead(page, await authorId(page, 'Grace Fixture'));
  await read.hold();
  try {
    await choose(page, 'Grace Fixture');
    await read.observed;
    // The admin names another frame as the receiver while the read is in flight.
    const receiver = await addFrame(page, 'site');
    const switchSeq = await mark(frame, 'target-switch');
    await selectReceiver(page, receiver.index);
    await expect.poll(async () => (await state(frame)).target).toBe('secondary');
    await expect(frame.getByTestId('status')).toHaveText('idle');
    await settle(frame);
    const switched = await glance(frame);
    // The reads in flight are the old session's; it aborted them when the session went.
    const inflight = switched.proof.calls.filter((call) => call.authorPopulation && !call.settled);
    expect(inflight.length).toBeGreaterThan(0);
    expect(inflight.every((call) => call.target === 'primary' && call.aborted)).toBe(true);
    const held = inflight.at(-1);
    expect(held.abortSeq).toBeGreaterThan(switchSeq);
    // The admin goes on posting to the window it framed: the retired session reads nothing for it.
    await page.locator('#field-title').fill('Sent to the retired receiver');
    await expect
      .poll(async () => retiredRows(await state(frame)))
      .toBeGreaterThan(retiredRows(switched.proof));
    const posted = await glance(frame);
    expect(posted.proof.calls.filter((call) => call.startSeq > switchSeq)).toEqual([]);
    read.release();
    await read.ended;
    await expect
      .poll(async () => (await state(frame)).calls.find((call) => call.id === held.id).settled)
      .toBe(true);
    await settle(frame, 500);
    const late = await glance(frame);
    // The genuine answer of the old session reached the page after the switch ...
    const answer = late.proof.calls.find((call) => call.id === held.id);
    expect(answer).toMatchObject({ target: 'primary', aborted: true, threw: false, status: 200 });
    expect(answer.settledSeq).toBeGreaterThan(switchSeq);
    // ... and the new session did not take it: no commit, no read of its own, the seed as it was.
    expect(late.proof.commits).toHaveLength(switched.proof.commits.length);
    expect(late.proof.calls.filter((call) => call.target === 'secondary')).toEqual([]);
    expect(late.proof.activeSession).toMatchObject({ ownInitialData: true, revision: 0 });
    expect(late.tree).toEqual(switched.tree);
    expect(late.tree).toMatchObject({ title: SEEDED, author: '', revision: '0' });
    // The new session still takes a message of its own.
    await postFromAdmin(page, receiver.index, message('Sent after the late answer'));
    await expectTaken(frame, late, 'Sent after the late answer');
    expect(await saved(page)).toEqual(before);
  } finally {
    await read.drop();
  }
});

test(titles.authExpiry, async ({ page }) => {
  const frame = await open(page);
  const before = await saved(page);
  await choose(page, 'Ada Fixture');
  await expect(frame.getByTestId('author')).toHaveText('Ada Fixture');
  await expect(frame.getByTestId('status')).toHaveText('live');
  const good = await glance(frame);
  // Payload's own route, in the editor's browser context and without an Origin header, which the
  // cookie check of both CSRF variants accepts; the admin page itself is not navigated.
  const out = await page.context().request.post(settings.admin + '/api/users/logout');
  expect(out.status()).toBe(200);
  expect((await page.context().cookies()).some((cookie) => cookie.name === 'payload-token')).toBe(
    false,
  );
  await mark(frame, 'sign-out');
  // The form keeps its state, so the next edit is a title typed into it; the author's id goes along.
  await page.locator('#field-title').fill('Typed after the sign-out');
  await expect(frame.getByTestId('status')).toHaveText('unavailable');
  const failed = await glance(frame);
  const refused = failed.proof.calls.at(-1);
  // Payload answers a signed-out read with a refusal; which one is measured and kept.
  expect([401, 403]).toContain(refused.status);
  page.__facts.httpStatus = refused.status;
  await expect(frame.getByTestId('error')).toContainText(String(refused.status));
  expect(failed.tree.title).toBe(good.tree.title);
  expect(failed.tree.revision).toBe(good.tree.revision);
  expect(failed.tree.author).toBe('Ada Fixture');
  expect(failed.proof.commits).toHaveLength(good.proof.commits.length);
  // A sign-in through the form in a second page of the same context brings the cookie back.
  const second = await page.context().newPage();
  try {
    await signIn(second);
  } finally {
    await second.close();
  }
  await mark(frame, 'sign-in');
  await page.locator('#field-title').fill('Typed after the sign-in');
  await expect(frame.getByTestId('status')).toHaveText('live');
  await expect(frame.getByTestId('title')).toHaveText('Typed after the sign-in');
  await expect(frame.getByTestId('error')).toHaveCount(0);
  const back = await glance(frame);
  expect(Number(back.tree.revision)).toBeGreaterThan(Number(good.tree.revision) + 1);
  expect(back.proof.commits.length).toBeGreaterThan(good.proof.commits.length);
  expect(await saved(page)).toEqual(before);
});
