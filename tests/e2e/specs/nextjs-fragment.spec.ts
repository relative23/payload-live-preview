import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * The fragment strategy through the Next.js adapter (`examples/nextjs-payload`,
 * App Router, `createFragmentEndpoint` as a route handler). The Astro fixture
 * covers the protocol in depth; what is asserted here is that the same endpoint
 * renders React on the server, and that the three outcomes a page depends on —
 * rendered, refused, failed — reach the browser the same way they do there.
 */

const APP = 'http://localhost:4174';
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

test.describe('fragment preview (Next.js)', () => {
  test('the server creates the conditional section and the derived count React renders', async ({
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

  test('an unauthorized page renders nothing on the server and is patched instead', async ({
    page,
  }) => {
    const frame = await open(page, '?unauthorized=1');

    await post(page, { title: 'Patched only', subtitle: 'Must not appear', body: 'x y' }, OWNER);

    await expect(frame.getByTestId('hero-title')).toHaveText('Patched only');
    await expect(frame.getByTestId('hero-body')).toHaveText('x y');
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);
    // The count is derived on the server; with no render it keeps the page's
    // own three, which is exactly what patching alone can and cannot do.
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
