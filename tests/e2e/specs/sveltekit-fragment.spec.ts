import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * The fragment strategy through the SvelteKit adapter
 * (`examples/sveltekit-payload`, `createFragmentEndpoint` in a `+server.ts`,
 * Svelte's own server renderer). The Astro fixture covers the protocol in
 * depth; what is asserted here is that Svelte renders the boundary on the
 * server, and that the authorization gate covers the boundary markup too.
 */

const APP = 'http://localhost:4175';
const OWNER = { globalSlug: 'home' };

interface FragmentStats {
  handler: boolean;
  rendered: number;
  failed: number;
  superseded: number;
}
interface Api {
  inspect: () => { started: boolean; fragments: FragmentStats };
}

async function open(page: Page, query = ''): Promise<Frame> {
  await page.goto(`${APP}/hybrid/host${query}`);
  const frame = await waitForPreviewFrame(page, 'preview=true');
  await waitForStarted(frame);
  return frame;
}

async function fragments(frame: Frame): Promise<FragmentStats> {
  return frame.evaluate(
    () => (window as Window & { __livePreview?: Api }).__livePreview!.inspect().fragments,
  );
}

/**
 * The dev server compiles this route on its first request, and a cold compile
 * can outlast the timeout the runtime waits for — the boundary then falls back
 * to patching and the test measures the build, not the endpoint. One warm-up
 * request settles it.
 */
test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext();
  const token = (await (await api.get(`${APP}/preview-token?path=/hybrid`)).text()).trim();
  await api.post(`${APP}/payload/fragment`, {
    headers: { 'content-type': 'application/json', origin: APP, 'sec-fetch-site': 'same-origin' },
    data: {
      fragment: 'hero',
      route: '/hybrid',
      search: `?previewToken=${token}`,
      revision: 0,
      fields: { title: 'warm-up', body: 'a b' },
    },
  });
  await api.dispose();
});

test.describe('fragment preview (SvelteKit)', () => {
  test('the server creates the conditional section and the derived count Svelte renders', async ({
    page,
  }) => {
    const frame = await open(page);
    expect((await fragments(frame)).handler).toBe(true);
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);

    await post(page, { title: 'With subtitle', subtitle: 'From the form', body: 'one two' }, OWNER);
    await expect(frame.getByTestId('hero-subtitle')).toHaveText('From the form');
    await expect(frame.getByTestId('hero-words')).toHaveText('2 words');

    await post(page, { title: 'Without subtitle', subtitle: '', body: 'one two three' }, OWNER);
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);
    await expect(frame.getByTestId('hero-words')).toHaveText('3 words');
    expect((await fragments(frame)).rendered).toBe(2);
  });

  test('the boundary is patched from the same revision when the render throws', async ({
    page,
  }) => {
    const frame = await open(page);

    // The fixture throws for this title; the browser sees a 500 and falls back
    // to the bindings inside the boundary, so the edit is never lost.
    await post(page, { title: 'boom, patched anyway', subtitle: 'Must not appear' }, OWNER);

    await expect(frame.getByTestId('hero-title')).toHaveText('boom, patched anyway');
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);
    const stats = await fragments(frame);
    expect(stats.failed).toBe(1);
    expect(stats.rendered).toBe(0);
  });

  test('a public visitor gets neither the bindings nor the boundary they describe', async ({
    page,
  }) => {
    // `preview.boundary()` is gated on the same verdict as `preview.bind()`:
    // the registry id and its dependencies are the content model as well.
    const response = await page.request.get(`${APP}/hybrid`);
    const html = await response.text();

    expect(html).not.toContain('data-payload-fragment');
    expect(html).not.toContain('data-payload-field');
    // This fixture runs the 2.0 defaults, so an unauthorized request is a
    // public response whole: no runtime to ask for a fragment in the first place.
    expect(html).not.toContain('__LIVE_PREVIEW_CONFIG__');
    expect(html).toContain('Hybrid preview on SvelteKit');
  });

  test('focus and a typed value survive a server render, and markup outside the boundary is patched', async ({
    page,
  }) => {
    const frame = await open(page);
    const input = frame.getByTestId('hero-input');
    await input.click();
    await input.fill('half typed');

    await post(page, { body: 'a b c d', footer: 'Patched footer' }, OWNER);

    await expect(frame.getByTestId('hero-words')).toHaveText('4 words');
    await expect(frame.getByTestId('footer')).toHaveText('Patched footer');
    const state = await frame.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null;
      return { focused: el?.dataset['testid'], value: el?.value };
    });
    expect(state).toEqual({ focused: 'hero-input', value: 'half typed' });
  });
});
