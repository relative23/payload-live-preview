/**
 * Scale scenarios: 300, 1,000 and 5,000 bound fields on one page.
 *
 * The unit suite proves the scheduler's logic; nothing before this proved it
 * at a size where the visibility gate is the normal operating mode rather
 * than an edge case. 5,000 bindings is a hundred times the gate threshold, so
 * almost every binding is off-screen and is served from the replay buffer on
 * scroll — F-39's mechanism, exercised in a real browser at real scale.
 *
 * Each scenario posts one message that changes a binding at the top of the
 * page and one near the bottom, then checks: the visible one updated, the
 * count of bound fields is exactly N, and — where the gate is active — the
 * off-screen one was deferred and lands the moment it scrolls into view.
 */

import { expect, test, type Frame, type Page } from '@playwright/test';

interface Snapshot {
  started: boolean;
  bindings: { fields: number; elements: number; ownerScoped: boolean };
  scheduler: {
    pending: number;
    deferred: number;
    visibilityGateThreshold: number;
    visibilityGateActive: boolean;
    lastFlush?: { applied: number; deferred: number; appliedFields?: string[] };
  };
  revisions: { accepted: number };
}

function previewFrame(page: Page): Frame | undefined {
  return page.frames().find((candidate) => candidate !== page.mainFrame());
}

/** The handle is absent until the runtime has booted, so this may be undefined. */
async function inspect(frame: Frame): Promise<Snapshot | undefined> {
  return (await frame.evaluate(() =>
    (window as Window & { __livePreview?: { inspect: () => unknown } }).__livePreview?.inspect(),
  )) as Snapshot | undefined;
}

/** After openScenario the handle exists; a missing one there is a failure, not a wait. */
async function snapshot(frame: Frame): Promise<Snapshot> {
  const value = await inspect(frame);
  if (value === undefined) throw new Error('runtime handle disappeared');
  return value;
}

async function openScenario(page: Page, count: number): Promise<Frame> {
  const path = `/scenario/${String(count)}/`;
  await page.goto(`/bench?target=${path}`);
  // The host picks the target on the client and assigns the frame's src, so
  // the frame is attached a moment after navigation. Wait for the one that
  // points at this scenario rather than grabbing the first non-main frame —
  // "a frame exists" and "the right page is framed" are different facts, and
  // the earlier version of this helper conflated them.
  await expect
    .poll(() => previewFrame(page)?.url().endsWith(path) ?? false, { timeout: 15_000 })
    .toBe(true);
  const frame = previewFrame(page);
  if (!frame) throw new Error('preview frame missing');
  await expect
    .poll(async () => (await inspect(frame))?.started ?? false, { timeout: 15_000 })
    .toBe(true);
  return frame;
}

/** Post one update into the frame, the way the Admin would. */
async function sendUpdate(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.evaluate((payload) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    if (frame?.contentWindow == null) throw new Error('preview frame is unavailable');
    frame.contentWindow.postMessage(
      { type: 'payload-live-preview', data: payload },
      window.location.origin,
    );
  }, data);
}

/**
 * One scenario per call. Registered from a plain function rather than a loop:
 * the test policy forbids registering tests under a loop or a condition, so
 * that a skipped or duplicated case cannot hide behind control flow.
 */
function registerScenario(count: number): void {
  test.describe(`${String(count)} bindings`, () => {
    test('binds every field, updates a visible one, and honours the gate for an off-screen one', async ({
      page,
    }) => {
      const frame = await openScenario(page, count);
      const first = frame.locator('[data-payload-field="f0"]');
      const lastName = `f${String(count - 1)}`;
      const last = frame.locator(`[data-payload-field="${lastName}"]`);

      const before = await snapshot(frame);
      expect(before.bindings.fields, 'every field is bound').toBe(count);
      expect(before.bindings.elements).toBe(count);
      expect(before.scheduler.visibilityGateActive, 'gate state follows the threshold').toBe(
        count > before.scheduler.visibilityGateThreshold,
      );

      await sendUpdate(page, { f0: 'top changed', [lastName]: 'bottom changed' });
      await expect(first).toHaveText('top changed');

      const after = await snapshot(frame);
      expect(after.revisions.accepted).toBe(1);

      if (after.scheduler.visibilityGateActive) {
        // The bottom binding is far below the fold: it must NOT have been
        // written yet, and the scheduler must say why.
        await expect(last).toHaveText(lastName);
        expect(
          after.scheduler.deferred,
          'the off-screen write sits in the replay buffer',
        ).toBeGreaterThan(0);

        await last.scrollIntoViewIfNeeded();
        await expect(last).toHaveText('bottom changed');
        await expect.poll(async () => (await snapshot(frame)).scheduler.deferred).toBe(0);
      } else {
        // Below the threshold there is no gate; both land in the same flush.
        await expect(last).toHaveText('bottom changed');
        expect(after.scheduler.deferred).toBe(0);
      }
    });
  });
}

registerScenario(300);
registerScenario(1_000);
registerScenario(5_000);

test('5,000 bindings: a burst of updates leaves the newest value on screen and nothing pending', async ({
  page,
}) => {
  // The soak proves latest-write on one field over time; this proves it across
  // a page whose cache is large enough that a flush is real work.
  const frame = await openScenario(page, 5_000);
  const first = frame.locator('[data-payload-field="f0"]');

  await page.evaluate(() => {
    const target = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    if (target?.contentWindow == null) throw new Error('preview frame is unavailable');
    for (let index = 0; index < 50; index += 1) {
      target.contentWindow.postMessage(
        { type: 'payload-live-preview', data: { f0: `burst-${String(index)}` } },
        window.location.origin,
      );
    }
  });

  await expect(first).toHaveText('burst-49');
  await expect.poll(async () => (await snapshot(frame)).scheduler.pending).toBe(0);
});
