import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * ADR 0023 in a browser. `examples/pure-html/revision-display.html` has a
 * bound title, a route marker for `banner` (the route strategy renders the
 * saved draft, so that revision is partial) and an island that renders the
 * title at once but confirms it only when the test calls `__confirmIsland()`,
 * the way a framework commit can come later than the event.
 */

const APP = 'http://localhost:4180';
const TARGET = '/revision-display.html';

interface Display {
  readonly revision: number;
  readonly state: string;
  readonly shortfalls: readonly { readonly kind: string }[];
  readonly awaitingIslands: number;
}

interface Api {
  inspect(): { revisions: { display: Display | undefined } };
}

async function open(page: Page): Promise<Frame> {
  await page.goto(`${APP}/admin.html?target=${encodeURIComponent(TARGET)}`);
  const frame = await waitForPreviewFrame(page, TARGET);
  await waitForStarted(frame);
  return frame;
}

function display(frame: Frame): Promise<Display | undefined> {
  return frame.evaluate(
    () => (window as Window & { __livePreview?: Api }).__livePreview?.inspect().revisions.display,
  );
}

async function settled(frame: Frame): Promise<Display> {
  let last: Display | undefined;
  await expect
    .poll(async () => {
      last = await display(frame);
      return last?.state;
    })
    .not.toBe('pending');
  if (last === undefined) throw new Error('no revision display');
  return last;
}

test.describe('how completely the page shows a revision', () => {
  test('a revision the island renders is unconfirmed until it confirms, then current', async ({
    page,
  }) => {
    const frame = await open(page);
    await post(page, { title: 'Hello', banner: 'Saved banner' });
    await settled(frame);

    await post(page, { title: 'Edited', banner: 'Saved banner' });
    await expect(frame.getByTestId('island-title')).toHaveText('Edited');
    await expect(frame.getByTestId('title')).toHaveText('Edited');
    const before = await settled(frame);
    expect(before).toMatchObject({ state: 'unconfirmed', awaitingIslands: 1, shortfalls: [] });

    await frame.evaluate(() => {
      (window as Window & { __confirmIsland?: () => void }).__confirmIsland?.();
    });
    await expect.poll(async () => (await display(frame))?.state).toBe('current');
    expect((await display(frame))?.revision).toBe(before.revision);
  });

  test('a change only the route shows is partial, and the next edit recovers', async ({ page }) => {
    const frame = await open(page);
    await post(page, { title: 'Hello', banner: 'Saved banner' });
    await settled(frame);

    await post(page, { title: 'Hello', banner: 'Unsaved banner' });
    const partial = await settled(frame);
    expect(partial.state).toBe('partial');
    expect(partial.shortfalls).toEqual([{ kind: 'route-saved' }]);

    await post(page, { title: 'Recovered', banner: 'Unsaved banner' });
    await expect(frame.getByTestId('title')).toHaveText('Recovered');
    await expect.poll(async () => (await display(frame))?.state).toBe('unconfirmed');
    await frame.evaluate(() => {
      (window as Window & { __confirmIsland?: () => void }).__confirmIsland?.();
    });
    await expect.poll(async () => (await display(frame))?.state).toBe('current');
  });
});
