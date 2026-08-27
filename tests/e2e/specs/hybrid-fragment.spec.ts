import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * The fragment strategy against the SSR fixture (`examples/astro-hybrid`,
 * Astro + Node adapter, ADR 0011). The 1.6.0 alpha gates, in three engines:
 * unsaved state creates and removes a conditional section; the output
 * matches a full server render; focus survives; slow fragment A never
 * overwrites fast fragment B; an unauthorized request renders nothing on
 * the server (an expired token) and the boundary is patched instead; patch-only markup on the
 * same page keeps patching.
 */

const APP = 'http://localhost:4177';

function previewFrame(page: Page): Frame | undefined {
  return page.frames().find((candidate) => candidate !== page.mainFrame());
}

interface FragmentStats {
  handler: boolean;
  rendered: number;
  failed: number;
  superseded: number;
}
interface RouteStats {
  handler: boolean;
  refreshes: number;
  failed: number;
  loopStopped: number;
}
interface Api {
  inspect: () => { started: boolean; fragments: FragmentStats; route: RouteStats };
}

async function open(page: Page, query = ''): Promise<Frame> {
  await page.goto(`${APP}/bench${query}`);
  await expect
    .poll(() => previewFrame(page)?.url().includes('preview=true') ?? false, { timeout: 15_000 })
    .toBe(true);
  const frame = previewFrame(page);
  if (!frame) throw new Error('preview frame missing');
  await expect
    .poll(
      () =>
        frame.evaluate(
          () => (window as Window & { __livePreview?: Api }).__livePreview?.inspect().started,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  return frame;
}

async function post(page: Page, fields: Record<string, unknown>): Promise<void> {
  await page.evaluate((data) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    frame?.contentWindow?.postMessage(
      { type: 'payload-live-preview', data, globalSlug: 'home' },
      window.location.origin,
    );
  }, fields);
}

async function route(frame: Frame): Promise<RouteStats> {
  return frame.evaluate(
    () => (window as Window & { __livePreview?: Api }).__livePreview!.inspect().route,
  );
}

async function fragments(frame: Frame): Promise<FragmentStats> {
  return frame.evaluate(
    () => (window as Window & { __livePreview?: Api }).__livePreview!.inspect().fragments,
  );
}

test.describe('hybrid fragment preview', () => {
  test('the fragment client is present, and the server creates and removes a conditional section', async ({
    page,
  }) => {
    const frame = await open(page);
    expect((await fragments(frame)).handler).toBe(true);
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);

    await post(page, {
      title: 'With subtitle',
      subtitle: 'Rendered on the server',
      body: 'one two',
    });
    await expect(frame.getByTestId('hero-subtitle')).toHaveText('Rendered on the server');
    await expect(frame.getByTestId('hero-title')).toHaveText('With subtitle');
    await expect(frame.getByTestId('hero-words')).toHaveText('2 words');

    await post(page, { title: 'Without subtitle', subtitle: '', body: 'one two three' });
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);
    await expect(frame.getByTestId('hero-words')).toHaveText('3 words');
    expect((await fragments(frame)).rendered).toBe(2);
  });

  test('a fragment render equals the full server render of the same document', async ({ page }) => {
    const frame = await open(page);
    const ssr = await frame.getByTestId('hero').innerHTML();
    const url = new URL(frame.url());
    const response = await page.request.post(`${APP}/payload/fragment`, {
      headers: { 'content-type': 'application/json', origin: APP },
      data: {
        fragment: 'hero',
        route: url.pathname,
        search: url.search,
        revision: 1,
        globalSlug: 'home',
        fields: {
          title: 'Hybrid preview',
          body: 'Three words here',
          author: { name: 'Ada Lovelace' },
          image: { url: '/media/hero.png', alt: 'Hero image' },
          blocks: [{ id: 'b1', kind: 'note', text: 'A note block' }],
        },
      },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    const { html } = (await response.json()) as { html: string };
    const normalize = (markup: string) => markup.replace(/\s+/gu, ' ').trim();
    expect(normalize(html)).toBe(normalize(ssr));
    // The authorized page and the authorized fragment both show the editor tools.
    expect(html).toContain('data-testid="hero-tools"');
  });

  test('relationships, uploads, locale and access control render the same on the server for the fragment', async ({
    page,
  }) => {
    const frame = await open(page);
    await post(page, {
      title: 'Populated',
      body: 'a',
      author: { name: 'Grace Hopper' },
      image: { url: '/media/new.png', alt: 'New image' },
    });
    await expect(frame.getByTestId('hero-author')).toHaveText('by Grace Hopper');
    await expect(frame.getByTestId('hero-image')).toHaveAttribute('src', '/media/new.png');
    await expect(frame.getByTestId('hero-tools')).toBeVisible();
    const url = new URL(frame.url());
    const response = await page.request.post(`${APP}/payload/fragment`, {
      headers: { 'content-type': 'application/json', origin: APP },
      data: {
        fragment: 'hero',
        route: url.pathname,
        search: url.search,
        revision: 9,
        locale: 'de',
        fields: { title: 'Lokalisiert', body: 'ein zwei' },
      },
    });
    const { html } = (await response.json()) as { html: string };
    expect(html).toContain('lang="de"');
    expect(html).toContain('Lokalisiert');
  });

  test('the endpoint answers twenty concurrent requests within its limits', async ({ page }) => {
    const frame = await open(page);
    const url = new URL(frame.url());
    const started = Date.now();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        page.request.post(`${APP}/payload/fragment`, {
          headers: { 'content-type': 'application/json', origin: APP },
          data: {
            fragment: 'hero',
            route: url.pathname,
            search: url.search,
            revision: index,
            fields: { title: `Load ${String(index)}`, body: 'x' },
          },
        }),
      ),
    );
    expect(responses.map((response) => response.status())).toEqual(Array(20).fill(200));
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test('a custom Lexical node in the body is rendered by the server inside the fragment', async ({
    page,
  }) => {
    const frame = await open(page);
    await post(page, {
      title: 'Lexical',
      body: {
        root: {
          type: 'root',
          children: [
            { type: 'paragraph', children: [{ type: 'text', text: 'Intro words' }] },
            { type: 'callout', text: 'Rendered by the site’s own node renderer' },
          ],
        },
      },
    });
    await expect(frame.getByTestId('callout')).toHaveText(
      'Rendered by the site’s own node renderer',
    );
    await expect(frame.getByTestId('hero-body').locator('p')).toHaveText('Intro words');
    // The count is of the whole Lexical text, callout included: 2 + 7 words.
    await expect(frame.getByTestId('hero-words')).toHaveText('9 words');
  });

  test('focus and a typed value survive a server render of the boundary', async ({ page }) => {
    const frame = await open(page);
    const input = frame.getByTestId('hero-input');
    await input.click();
    await input.fill('half typed');
    // Body-only: a pure fragment render, so this isolates fragment focus survival.
    await post(page, { body: 'a b c d' });
    await expect(frame.getByTestId('hero-words')).toHaveText('4 words');
    const state = await frame.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null;
      return { focused: el?.dataset['testid'], value: el?.value };
    });
    expect(state).toEqual({ focused: 'hero-input', value: 'half typed' });
  });

  test('slow fragment A never overwrites fast fragment B, and the footer outside is patched', async ({
    page,
  }) => {
    const frame = await open(page);
    await post(page, { body: 'slow:1500 a', footer: 'Footer A' });
    await post(page, { body: 'b b', footer: 'Footer B' });
    await expect(frame.getByTestId('footer')).toHaveText('Footer B');
    await page.waitForTimeout(2_000);
    await expect(frame.getByTestId('hero-words')).toHaveText('2 words');
    const stats = await fragments(frame);
    expect(stats.superseded).toBeGreaterThanOrEqual(1);
    expect(stats.failed).toBe(0);
  });

  test('once the token expires, the server refuses and the boundary is patched instead', async ({
    page,
  }) => {
    // The page was authorized when it loaded; the fragment endpoint authorizes
    // every request anew, so an expired token means fallback, not stale HTML.
    const frame = await open(page, '?ttl=1500');
    await page.waitForTimeout(2_000);
    await post(page, { title: 'Patched only', subtitle: 'Must not appear', body: 'x y z' });
    await expect(frame.getByTestId('hero-title')).toHaveText('Patched only');
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);
    await expect(frame.getByTestId('hero-words')).toHaveText('3 words');
    const stats = await fragments(frame);
    expect(stats.failed).toBe(1);
    expect(stats.rendered).toBe(0);
  });

  test('a head binding refreshes the whole route once, keeps scroll and focus, and the unsaved title lands on the fresh markup', async ({
    page,
  }) => {
    const frame = await open(page);
    const stampBefore = await frame.getByTestId('route-stamp').textContent();
    await frame.evaluate(() => {
      window.scrollTo(0, 600);
    });
    await post(page, { title: 'Route refreshed title' });
    await expect.poll(async () => (await route(frame)).refreshes).toBe(1);
    await expect(frame.getByTestId('route-stamp')).not.toHaveText(stampBefore ?? '');
    await expect.poll(() => frame.title()).toBe('Route refreshed title');
    await expect(frame.getByTestId('hero-title')).toHaveText('Route refreshed title');
    // Scroll is restored across the whole-route refresh (focus survival through a
    // route refresh is covered by the route unit test in jsdom).
    expect(await frame.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    expect((await route(frame)).loopStopped).toBe(0);
  });

  test('two revisions inside the minimum interval: one route refresh, the second is refused and patched', async ({
    page,
  }) => {
    const frame = await open(page);
    await post(page, { title: 'One', body: 'x' });
    await expect.poll(async () => (await route(frame)).refreshes).toBe(1);
    await post(page, { title: 'Two', body: 'x' });
    await expect.poll(() => frame.title()).toBe('Two');
    await expect(frame.getByTestId('hero-title')).toHaveText('Two');
    const stats = await route(frame);
    expect(stats.refreshes).toBe(1);
    expect(stats.failed).toBe(1);
  });

  test('an island on the same page re-renders itself from the bridge event; neither patch nor fragment touches it', async ({
    page,
  }) => {
    const frame = await open(page);
    await post(page, { title: 'Shared update', body: 'a' });
    await expect(frame.getByTestId('island-inside')).toHaveText('island: Shared update');
    await expect(frame.getByTestId('island-renders')).toHaveText('1');
    await expect(frame.getByTestId('hero-title')).toHaveText('Shared update');
  });
});
