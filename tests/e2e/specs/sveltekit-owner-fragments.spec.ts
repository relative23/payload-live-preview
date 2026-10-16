import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * PHD-01 in a browser: owner scoping across server-rendered boundaries and
 * islands. The SvelteKit fixture runs with `scopeBindingsByOwner`; its
 * `/owners-hybrid` route renders `global:a` and `global:b`, each with an
 * `owned` fragment boundary (keyed `a` and `b`) and a `data-payload-island`.
 * An update that names `a` may ask the server to render a's boundary and
 * notify a's island only: b's renderer and b's island never receive a's
 * unsaved fields.
 */

const APP = process.env['PLP_SVELTE_ORIGIN'] ?? 'http://localhost:4175';
const TARGET = '/owners-hybrid';
const ISLAND_EVENT = 'payload-live-preview:update';

type CountingWindow = Window & { __plpIslandEvents?: Record<string, number> };

/** The dev server compiles the endpoint on its first request; one warm-up keeps that out of the measurement. */
test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext();
  const token = (await (await api.get(`${APP}/preview-token?path=${TARGET}`)).text()).trim();
  await api.post(`${APP}/payload/fragment`, {
    headers: { 'content-type': 'application/json', origin: APP, 'sec-fetch-site': 'same-origin' },
    data: {
      fragment: 'owned',
      key: 'a',
      route: TARGET,
      search: `?previewToken=${token}`,
      revision: 0,
      fields: { title: 'warm-up' },
    },
  });
  await api.dispose();
});

/** Every fragment request the runtime makes, by boundary key, from the start. */
async function open(page: Page): Promise<{ frame: Frame; keys: string[] }> {
  const keys: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().endsWith('/payload/fragment')) return;
    const body = request.postDataJSON() as { key?: unknown };
    keys.push(String(body.key));
  });
  await page.goto(`${APP}/admin.html?target=${TARGET}`);
  const frame = await waitForPreviewFrame(page, 'preview=true');
  await waitForStarted(frame);
  await frame.evaluate((event) => {
    const counts: Record<string, number> = { a: 0, b: 0 };
    (window as CountingWindow).__plpIslandEvents = counts;
    for (const name of ['a', 'b']) {
      document.querySelector(`[data-testid="island-${name}"]`)?.addEventListener(event, () => {
        counts[name] = (counts[name] ?? 0) + 1;
      });
    }
  }, ISLAND_EVENT);
  return { frame, keys };
}

function islandEvents(frame: Frame): Promise<Record<string, number>> {
  return frame.evaluate(() => (window as CountingWindow).__plpIslandEvents ?? {});
}

test.describe('owner scoping across fragments and islands (SvelteKit)', () => {
  test("an update naming a renders a's boundary and notifies a's island, never b's", async ({
    page,
  }) => {
    const { frame, keys } = await open(page);
    const a = frame.getByTestId('doc-a');
    const b = frame.getByTestId('doc-b');

    await post(page, { title: 'A, edited' }, { globalSlug: 'a', targetOrigin: APP });

    // The count only a server render can change: a's boundary was rendered.
    await expect(a.getByTestId('panel-letters')).toHaveText('9 letters');
    await expect(a.getByTestId('panel-title')).toHaveText('A, edited');
    await expect.poll(async () => (await islandEvents(frame))['a']).toBeGreaterThan(0);
    await expect(b.getByTestId('panel-title')).toHaveText('Title of B');
    await expect(b.getByTestId('panel-letters')).toHaveText('10 letters');
    expect(keys.filter((key) => key === 'b')).toEqual([]);
    expect(keys).toContain('a');
    expect((await islandEvents(frame))['b']).toBe(0);
  });

  test("an update naming b renders b's boundary and notifies b's island, never a's", async ({
    page,
  }) => {
    const { frame, keys } = await open(page);
    const a = frame.getByTestId('doc-a');
    const b = frame.getByTestId('doc-b');

    await post(page, { title: 'B, edited' }, { globalSlug: 'b', targetOrigin: APP });

    await expect(b.getByTestId('panel-letters')).toHaveText('9 letters');
    await expect.poll(async () => (await islandEvents(frame))['b']).toBeGreaterThan(0);
    await expect(a.getByTestId('panel-title')).toHaveText('Title of A');
    expect(keys.filter((key) => key === 'a')).toEqual([]);
    expect((await islandEvents(frame))['a']).toBe(0);
  });
});
