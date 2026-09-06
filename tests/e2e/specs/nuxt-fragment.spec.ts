import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * The fragment strategy through the Nuxt adapter (`examples/nuxt-payload`, the
 * endpoint as a Nitro route, Vue's own server renderer). This fixture stages
 * the 1.x profile, so the page itself is authorized by intent — the endpoint
 * never is, and that split is what the last test here holds.
 */

const APP = 'http://localhost:4176';
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
  await page.goto(`${APP}/hybrid-host${query}`);
  const frame = await waitForPreviewFrame(page, 'preview=true');
  await waitForStarted(frame);
  // Vue resets what it owns when it hydrates, so an update that lands before
  // that moment is lost — the caveat in docs/nuxt.md, and the page sets this
  // marker in `onMounted` for exactly this wait.
  await frame.waitForFunction(() => document.documentElement.dataset['hydrated'] === 'true');
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

test.describe('fragment preview (Nuxt)', () => {
  test('the server creates the conditional section and the derived count Vue renders', async ({
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

    await post(page, { title: 'boom, patched anyway', subtitle: 'Must not appear' }, OWNER);

    await expect(frame.getByTestId('hero-title')).toHaveText('boom, patched anyway');
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);
    const stats = await fragments(frame);
    expect(stats.failed).toBe(1);
    expect(stats.rendered).toBe(0);
  });

  test('intent alone gets the runtime but never a server render', async ({ page }) => {
    // The page is a preview because it says so; the endpoint verifies a signed
    // token instead, so a framed page without one is patched and never rendered.
    const frame = await open(page, '?unauthorized=1');

    await post(page, { title: 'Patched only', subtitle: 'Must not appear', body: 'x y' }, OWNER);

    await expect(frame.getByTestId('hero-title')).toHaveText('Patched only');
    await expect(frame.getByTestId('hero-body')).toHaveText('x y');
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);
    // Derived on the server; with no render it keeps the page's own three.
    await expect(frame.getByTestId('hero-words')).toHaveText('3 words');
    expect((await fragments(frame)).failed).toBe(1);
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
