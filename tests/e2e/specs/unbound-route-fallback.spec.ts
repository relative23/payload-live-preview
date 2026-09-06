import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * `onUnboundChange: 'route'` in a browser (`examples/astro-hybrid`, route
 * `/unbound`, which runs the route strategy without a fragment endpoint).
 *
 * The case it exists for: an editor changes a field the template does not
 * annotate. Patching has nowhere to put it, and the preview would quietly show
 * the old page — the one thing a framework hook does better. With the fallback
 * on, the route is rendered again and the edit appears.
 */

const APP = 'http://localhost:4177';
const OWNER = { globalSlug: 'home' };

interface RouteStats {
  handler: boolean;
  refreshes: number;
  failed: number;
  loopStopped: number;
}
interface Api {
  inspect: () => { route: RouteStats };
}

async function open(page: Page): Promise<Frame> {
  await page.goto(`${APP}/bench?target=/unbound`);
  const frame = await waitForPreviewFrame(page, 'preview=true');
  await waitForStarted(frame);
  return frame;
}

async function route(frame: Frame): Promise<RouteStats> {
  return frame.evaluate(
    () => (window as Window & { __livePreview?: Api }).__livePreview!.inspect().route,
  );
}

/**
 * The connection's first message is the baseline — there every field looks
 * changed and the page was just rendered from them — so it is sent here before
 * anything is measured, exactly as the admin sends it on connect.
 */
async function connect(page: Page, frame: Frame): Promise<void> {
  await post(page, { title: 'Hybrid preview', tagline: 'Nothing binds this line' }, OWNER);
  await expect.poll(async () => (await route(frame)).handler).toBe(true);
}

test.describe('a change nothing binds', () => {
  test('refreshes the route, and the page comes back rendered again', async ({ page }) => {
    const frame = await open(page);
    await connect(page, frame);
    const before = await frame.getByTestId('route-stamp').textContent();

    await post(page, { title: 'Hybrid preview', tagline: 'Edited, and bound to nothing' }, OWNER);

    await expect.poll(async () => (await route(frame)).refreshes).toBe(1);
    await expect(frame.getByTestId('route-stamp')).not.toHaveText(before ?? '');
    expect((await route(frame)).failed).toBe(0);
  });

  test('leaves a revision that only touches bound fields to the patch', async ({ page }) => {
    const frame = await open(page);
    await connect(page, frame);
    const before = await frame.getByTestId('route-stamp').textContent();

    await post(page, { title: 'Patched in place', tagline: 'Nothing binds this line' }, OWNER);

    await expect(frame.getByTestId('title')).toHaveText('Patched in place');
    // The stamp is proof the server was not asked again: a refresh would change it.
    await expect(frame.getByTestId('route-stamp')).toHaveText(before ?? '');
    expect((await route(frame)).refreshes).toBe(0);
  });

  test('sits out the connection baseline, where every field looks changed', async ({ page }) => {
    const frame = await open(page);

    await post(page, { title: 'Hybrid preview', tagline: 'Nothing binds this line' }, OWNER);

    await expect.poll(async () => (await route(frame)).handler).toBe(true);
    expect((await route(frame)).refreshes).toBe(0);
  });
});
