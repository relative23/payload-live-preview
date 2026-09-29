import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

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
const OWNER = { globalSlug: 'home' };

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
  refused: number;
  loopStopped: number;
}
interface Api {
  inspect: () => { started: boolean; fragments: FragmentStats; route: RouteStats };
}

async function open(page: Page, query = ''): Promise<Frame> {
  await page.goto(`${APP}/bench${query}`);
  const frame = await waitForPreviewFrame(page, 'preview=true');
  await waitForStarted(frame);
  return frame;
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

    await post(
      page,
      {
        title: 'With subtitle',
        subtitle: 'Rendered on the server',
        body: 'one two',
      },
      OWNER,
    );
    await expect(frame.getByTestId('hero-subtitle')).toHaveText('Rendered on the server');
    await expect(frame.getByTestId('hero-title')).toHaveText('With subtitle');
    await expect(frame.getByTestId('hero-words')).toHaveText('2 words');

    await post(page, { title: 'Without subtitle', subtitle: '', body: 'one two three' }, OWNER);
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);
    await expect(frame.getByTestId('hero-words')).toHaveText('3 words');
    expect((await fragments(frame)).rendered).toBe(2);
  });

  test('a document with a list in a column block is rendered by the server, not refused as too deep (ADR 0027)', async ({
    page,
  }) => {
    const frame = await open(page);
    const text = { type: 'text', text: 'Punkt', format: 0 };
    // layout[0].columns[0].richText.root.children[0].children[0].children[0].format: 13 levels.
    const layout = [
      {
        blockType: 'content',
        columns: [
          {
            richText: {
              root: {
                type: 'root',
                children: [{ type: 'list', children: [{ type: 'listitem', children: [text] }] }],
              },
            },
          },
        ],
      },
    ];
    await post(
      page,
      { title: 'Deep page', subtitle: 'Server rendered', body: 'a b', layout },
      OWNER,
    );
    await expect(frame.getByTestId('hero-subtitle')).toHaveText('Server rendered');
    const stats = await fragments(frame);
    expect(stats.rendered).toBe(1);
    expect(stats.failed).toBe(0);
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
    await post(
      page,
      {
        title: 'Populated',
        body: 'a',
        author: { name: 'Grace Hopper' },
        image: { url: '/media/new.png', alt: 'New image' },
      },
      OWNER,
    );
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
    await post(
      page,
      {
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
      },
      OWNER,
    );
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
    await post(page, { body: 'a b c d' }, OWNER);
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
    await post(page, { body: 'slow:1500 a', footer: 'Footer A' }, OWNER);
    await post(page, { body: 'b b', footer: 'Footer B' }, OWNER);
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
    await post(page, { title: 'Patched only', subtitle: 'Must not appear', body: 'x y z' }, OWNER);
    await expect(frame.getByTestId('hero-title')).toHaveText('Patched only');
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);
    await expect(frame.getByTestId('hero-words')).toHaveText('3 words');
    const stats = await fragments(frame);
    expect(stats.failed).toBe(1);
    expect(stats.rendered).toBe(0);
  });

  test('a response for another boundary key never morphs its server HTML', async ({ page }) => {
    const frame = await open(page);
    let mismatchedResponses = 0;
    await page.route(`${APP}/payload/fragment`, async (intercepted) => {
      const response = await intercepted.fetch();
      const body = (await response.json()) as {
        boundary: { id: string; key?: string };
      } & Record<string, unknown>;
      mismatchedResponses += 1;
      await intercepted.fulfill({
        response,
        json: { ...body, boundary: { ...body.boundary, key: 'another-instance' } },
      });
    });

    await post(
      page,
      { title: 'Patched after mismatch', subtitle: 'Must not be morphed', body: 'two words' },
      OWNER,
    );
    await expect.poll(() => mismatchedResponses).toBe(1);
    await expect(frame.getByTestId('hero-title')).toHaveText('Patched after mismatch');
    await expect(frame.getByTestId('hero-subtitle')).toHaveCount(0);
    // Derived server output stays at the last accepted render; only direct
    // bindings receive the deterministic fallback patch.
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
    await post(page, { title: 'Route refreshed title' }, OWNER);
    await expect.poll(async () => (await route(frame)).refreshes).toBe(1);
    await expect(frame.getByTestId('route-stamp')).not.toHaveText(stampBefore ?? '');
    await expect.poll(() => frame.title()).toBe('Route refreshed title');
    await expect(frame.getByTestId('hero-title')).toHaveText('Route refreshed title');
    // Scroll is restored across the whole-route refresh (focus survival through a
    // route refresh is covered by the route unit test in jsdom).
    expect(await frame.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    expect((await route(frame)).loopStopped).toBe(0);
  });

  test('the browser route fallback reconciles repeated managed head tags and leaves foreign ownership alone', async ({
    page,
  }) => {
    const frame = await open(page);
    await frame.evaluate(() => {
      document.head.insertAdjacentHTML(
        'beforeend',
        '<meta name="og:image" content="/old-name.png" data-stale="yes">' +
          '<style id="foreign-style">:root{--foreign:1}</style>' +
          '<meta property="og:image" content="/owned.png" data-payload-owned>' +
          '<meta property="og:image" content="/old-property.png">' +
          '<link rel="alternate" href="/old-alt">' +
          '<link rel="canonical" href="/old" data-stale="yes">' +
          '<link rel="canonical" href="/owned" data-payload-owned>',
      );
    });

    let refreshRequests = 0;
    await page.route(frame.url(), async (intercepted) => {
      if (intercepted.request().headers()['x-payload-live-preview'] !== 'route') {
        await intercepted.continue();
        return;
      }
      refreshRequests += 1;
      const response = await intercepted.fetch();
      const body = (await response.text()).replace(
        /<head>[\s\S]*?<\/head>/u,
        '<head><meta charset="utf-8"><title data-payload-field="title">Server title</title>' +
          '<meta property="og:image" content="/one.png" data-order="1">' +
          '<meta property="og:image" content="/two.png" data-order="2">' +
          '<meta name="og:image" content="/named.png" data-order="3">' +
          '<link rel="canonical" href="/fresh" hreflang="en">' +
          '<style id="fresh-style">:root{--fresh:1}</style>' +
          '<link rel="alternate" href="/fresh-alt"></head>',
      );
      await intercepted.fulfill({ response, body });
    });

    await post(page, { title: 'Unsaved head title' }, OWNER);
    await expect.poll(() => refreshRequests).toBe(1);
    await expect.poll(() => frame.title()).toBe('Unsaved head title');
    expect(
      await frame.evaluate(() => {
        const managed = Array.from(document.head.children)
          .filter(
            (element) =>
              !element.hasAttribute('data-payload-owned') &&
              ((element.tagName === 'META' &&
                (element.hasAttribute('name') || element.hasAttribute('property'))) ||
                (element.tagName === 'LINK' && element.getAttribute('rel') === 'canonical')),
          )
          .map((element) => ({
            tag: element.tagName,
            attributes: Object.fromEntries(
              Array.from(element.attributes).map(({ name, value }) => [name, value]),
            ),
          }));
        return {
          managed,
          ownedMeta: document.querySelector('meta[data-payload-owned]')?.getAttribute('content'),
          ownedCanonical: document
            .querySelector('link[rel="canonical"][data-payload-owned]')
            ?.getAttribute('href'),
          foreignStyle: document.getElementById('foreign-style')?.textContent,
          alternate: document.querySelector('link[rel="alternate"]')?.getAttribute('href'),
          insertedFreshStyle: document.getElementById('fresh-style') !== null,
          staleAttributes: document.head.querySelectorAll('[data-stale]').length,
        };
      }),
    ).toEqual({
      managed: [
        {
          tag: 'META',
          attributes: { property: 'og:image', content: '/one.png', 'data-order': '1' },
        },
        {
          tag: 'META',
          attributes: { property: 'og:image', content: '/two.png', 'data-order': '2' },
        },
        {
          tag: 'META',
          attributes: { name: 'og:image', content: '/named.png', 'data-order': '3' },
        },
        {
          tag: 'LINK',
          attributes: { rel: 'canonical', href: '/fresh', hreflang: 'en' },
        },
      ],
      ownedMeta: '/owned.png',
      ownedCanonical: '/owned',
      foreignStyle: ':root{--foreign:1}',
      alternate: '/old-alt',
      insertedFreshStyle: false,
      staleAttributes: 0,
    });
  });

  test('two revisions inside the minimum interval: one route refresh, the second is refused and patched', async ({
    page,
  }) => {
    const frame = await open(page);
    await post(page, { title: 'One', body: 'x' }, OWNER);
    await expect.poll(async () => (await route(frame)).refreshes).toBe(1);
    await post(page, { title: 'Two', body: 'x' }, OWNER);
    await expect.poll(() => frame.title()).toBe('Two');
    await expect(frame.getByTestId('hero-title')).toHaveText('Two');
    const stats = await route(frame);
    expect(stats.refreshes).toBe(1);
    // The brake held the second revision back; that is `refused`, and since Z6
    // it is no longer counted as `failed` — nothing here broke.
    expect(stats.refused).toBe(1);
    expect(stats.failed).toBe(0);
  });

  test('an island on the same page re-renders itself from the bridge event; neither patch nor fragment touches it', async ({
    page,
  }) => {
    const frame = await open(page);
    await post(page, { title: 'Shared update', body: 'a' }, OWNER);
    await expect(frame.getByTestId('island-inside')).toHaveText('island: Shared update');
    await expect(frame.getByTestId('island-renders')).toHaveText('1');
    await expect(frame.getByTestId('hero-title')).toHaveText('Shared update');
  });
});
