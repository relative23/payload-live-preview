/**
 * Native framework routes, real Payload login/ACL and browser cookies.
 * The editor here sends explicit synthetic messages, not Payload Admin UI;
 * The shared contract runs independently for each selected production build;
 * framework-specific ownership stays in its application template.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page, type Frame, type Request } from '@playwright/test';
import { startNativeContinuation } from '../helpers/native-continuation';
import { startNextContinuation } from '../helpers/next-continuation';

let fixture: Awaited<ReturnType<typeof startNativeContinuation>>;
let artifact: string;
let closeFixture: (() => Promise<void>) | undefined;

async function login(page: Page, editor: 'a' | 'b'): Promise<void> {
  await page.goto('/');
  const status = await page.evaluate(
    async ({ editor, password }) =>
      (
        await fetch('/continuation/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: `${editor}@fixture.invalid`, password }),
        })
      ).status,
    { editor, password: fixture.backend.password },
  );
  expect(status).toBe(204);
}
async function enter(
  page: Page,
  editor: 'a' | 'b',
  locale: 'de' | 'en',
  ttlMs?: number,
): Promise<string> {
  const token = await fixture.token(editor, locale, ttlMs);
  const result = await page.evaluate(
    async ({ editor, locale, token }) => {
      const response = await fetch(
        `/continuation/${editor}/${locale}/entry?preview=true&locale=${locale}`,
        { headers: { 'x-preview-token': token } },
      );
      return {
        status: response.status,
        path: new URL(response.url).pathname,
        clean: !response.url.includes(token),
      };
    },
    { editor, locale, token },
  );
  expect(result).toEqual({ status: 200, path: `/continuation/${editor}/${locale}`, clean: true });
  return token;
}
async function openFrame(page: Page, editor: 'a' | 'b', locale: 'de' | 'en'): Promise<Frame> {
  const before = fixture.backend.requests.length;
  const ssr = ['nuxt', 'astro', 'html', 'vue'].includes(fixture.framework)
    ? page.waitForResponse(
        (response) =>
          response.request().resourceType() === 'document' &&
          new URL(response.url()).pathname === `/continuation/${editor}/${locale}`,
      )
    : undefined;
  await page.evaluate(
    ({ editor, locale }) => {
      document.querySelector<HTMLIFrameElement>('#preview')!.src =
        `/continuation/${editor}/${locale}?preview=true&locale=${locale}`;
    },
    { editor, locale },
  );
  await expect(page.frameLocator('#preview').getByTestId('title')).toHaveText(
    `${editor}-draft-${locale}`,
  );
  const frame = page
    .frames()
    .find((value) => value.url().includes(`/continuation/${editor}/${locale}`));
  if (!frame) throw new Error('Native preview frame did not mount');
  await expect(frame.getByTestId('ready')).toHaveText('ready');
  await expect(frame.getByTestId('status')).toHaveText('idle');
  if (ssr) {
    const response = await ssr;
    expect(response.headers()['content-security-policy']).toContain('frame-ancestors');
    expect(response.headers()['content-security-policy']).toContain(fixture.origin);
    const html = await response.text();
    if (fixture.framework === 'vue') {
      expect(
        html.includes('<h1 data-testid="title">' + editor + '-draft-' + locale + '</h1>'),
      ).toBe(true);
      expect(html.includes('data-testid="ready">hydrating</output>')).toBe(true);
    }
    // A failed boolean assertion must not echo a credential-bearing document.
    expect(html.includes(fixture.backend.password)).toBe(false);
    expect(/JWT\s+[A-Za-z0-9_-]{20,}|v1\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]+/u.test(html)).toBe(
      false,
    );
    const requests = fixture.backend.requests.slice(before);
    expect(requests.filter((request) => request.path === '/api/users/me')).toHaveLength(1);
    expect(requests.filter((request) => request.path.startsWith('/api/articles/'))).toHaveLength(1);
  }
  return frame;
}
async function send(
  page: Page,
  editor: 'a' | 'b',
  locale: 'de' | 'en',
  title: string,
  alternative = false,
  foreign = false,
): Promise<void> {
  await expect(page.frameLocator('#preview').getByTestId('ready')).toHaveText('ready');
  const selected = foreign ? (editor === 'a' ? 'b' : 'a') : editor;
  await page.evaluate(
    ({ data, locale }) => {
      document
        .querySelector<HTMLIFrameElement>('#preview')!
        .contentWindow!.postMessage(
          { type: 'payload-live-preview', collectionSlug: 'articles', locale, data },
          location.origin,
        );
    },
    {
      locale,
      data: {
        id: Number(fixture.backend.ids[`article-${editor}`]),
        title,
        related: [Number(fixture.backend.ids[`${selected}-${alternative ? 'leaf' : 'root'}`])],
        files: [Number(fixture.backend.ids[`media-${selected}${alternative ? '-alt' : ''}`])],
      },
    },
  );
}
async function rendered(
  frame: Frame,
  title: string,
  related: string,
  files: string,
): Promise<void> {
  await expect(frame.getByTestId('title')).toHaveText(title);
  await expect(frame.getByTestId('related')).toHaveText(related);
  await expect(frame.getByTestId('files')).toHaveText(files);
  await expect(frame.getByTestId('status')).toHaveText('live');
}

test.describe('native production host continuation', () => {
  test.beforeAll(async ({ browserName, browser }, info) => {
    test.setTimeout(240_000);
    const selected: unknown = info.config.metadata['continuationFramework'];
    const framework =
      selected === 'sveltekit' ||
      selected === 'nuxt' ||
      selected === 'astro' ||
      selected === 'html' ||
      selected === 'vue'
        ? selected
        : 'next';
    artifact = resolve(
      `test-results/hardening/h04-${framework}-host`,
      process.env['PLP_HOST_RUN'] ?? 'native-first',
      browserName,
      `worker-${info.workerIndex}`,
    );
    fixture =
      framework === 'next'
        ? await startNextContinuation(artifact)
        : await startNativeContinuation(artifact, framework);
    closeFixture = fixture.close;
    await writeFile(
      resolve(artifact, 'browser.json'),
      JSON.stringify({ name: browserName, version: browser.version() }, null, 2),
    );
  });
  test.afterAll(async () => {
    if (closeFixture === undefined) return;
    try {
      expect(fixture.backend.writes()).toBe(0);
      await mkdir(artifact, { recursive: true });
      await writeFile(
        resolve(artifact, 'requests.json'),
        JSON.stringify(
          {
            contentWrites: fixture.backend.writes(),
            policyChanges: fixture.backend.policyChanges(),
            requests: fixture.backend.requests,
          },
          null,
          2,
        ),
      );
    } finally {
      await closeFixture();
      closeFixture = undefined;
    }
  });

  test('renders unsaved related drafts, keeps local state and survives native navigation and reload', async ({
    page,
  }) => {
    await login(page, 'a');
    await enter(page, 'a', 'de');
    const frame = await openFrame(page, 'a', 'de');
    const cookies = await page.context().cookies();
    expect(cookies.filter((cookie) => cookie.name.startsWith('__Host-plp-')).length).toBe(2);
    expect(
      cookies.every(
        (cookie) =>
          cookie.secure &&
          cookie.httpOnly &&
          cookie.sameSite === 'Strict' &&
          cookie.path === '/' &&
          cookie.domain === 'localhost',
      ),
    ).toBe(true);
    expect(await frame.evaluate(() => document.cookie.includes('__Host-plp'))).toBe(false);
    await frame.getByTestId('counter').click();
    await frame.getByTestId('visitor').fill('Kept visitor text');
    await send(page, 'a', 'de', 'Unsaved first');
    await rendered(frame, 'Unsaved first', 'a-root-draft-de', 'a-file-draft-de');
    await send(page, 'a', 'de', 'Unsaved second', true);
    await rendered(frame, 'Unsaved second', 'a-leaf-draft-de', 'a-alt-file-draft-de');
    await expect(frame.getByTestId('counter')).toHaveText('1');
    await expect(frame.getByTestId('visitor')).toHaveValue('Kept visitor text');
    const marker = await frame.evaluate(() => {
      const value = crypto.randomUUID();
      (window as Window & { __nativeHostMarker?: string }).__nativeHostMarker = value;
      return value;
    });
    const documentNavigation = fixture.framework === 'html' || fixture.framework === 'vue';
    if (fixture.framework !== 'next') {
      const before = fixture.backend.requests.length;
      if (documentNavigation) {
        // Read the actual pagehide cleanup marker before the browser replaces
        // this document. Only the test records this boolean, never draft data.
        await frame.evaluate(
          (selector) =>
            window.addEventListener(
              'pagehide',
              () => {
                sessionStorage.setItem(
                  'plp-html-departed',
                  document.querySelector(selector)?.getAttribute('data-stopped') ?? 'missing',
                );
              },
              { once: true },
            ),
          fixture.framework === 'vue' ? '#vue-app' : 'plp-html-preview',
        );
      }
      const priorOwner =
        fixture.framework === 'astro'
          ? await frame.locator('plp-astro-preview').elementHandle()
          : null;
      const validLoad = page.waitForResponse(
        (response) =>
          response.request().frame() === frame &&
          new URL(response.url()).pathname.endsWith(
            fixture.framework === 'nuxt'
              ? '/page'
              : fixture.framework === 'astro' || documentNavigation
                ? '/continuation/a/de'
                : '/__data.json',
          ),
      );
      await frame.getByTestId('valid-navigation').click();
      expect((await validLoad).status()).toBe(200);
      await expect(frame.getByTestId('title')).toHaveText('a-draft-de');
      await expect(frame.getByTestId('ready')).toHaveText('ready');
      if (documentNavigation) {
        expect(await frame.evaluate(() => sessionStorage.getItem('plp-html-departed'))).toBe(
          'true',
        );
      }
      const reads = fixture.backend.requests.slice(before);
      expect(reads.filter((request) => request.path === '/api/users/me')).toHaveLength(1);
      expect(reads.filter((request) => request.path.startsWith('/api/articles/'))).toHaveLength(1);
      if (priorOwner) {
        expect(await priorOwner.evaluate((element) => element.getAttribute('data-stopped'))).toBe(
          'true',
        );
        await priorOwner.dispose();
      }
      const updates: string[] = [];
      const countUpdate = (request: Request): void => {
        if (
          request.frame() === frame &&
          request.method() === 'POST' &&
          new URL(request.url()).pathname.endsWith('/data')
        ) {
          updates.push('update');
        }
      };
      page.on('request', countUpdate);
      await send(page, 'a', 'de', 'After server load', true);
      await rendered(frame, 'After server load', 'a-leaf-draft-de', 'a-alt-file-draft-de');
      page.off('request', countUpdate);
      expect(updates).toHaveLength(1);
    }
    const nativeLoad = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().frame() === frame &&
        url.searchParams.has('invalid') &&
        (fixture.framework === 'next'
          ? url.searchParams.has('_rsc')
          : url.pathname.endsWith(
              fixture.framework === 'nuxt'
                ? '/page'
                : fixture.framework === 'astro' || documentNavigation
                  ? '/continuation/a/de'
                  : '/__data.json',
            ))
      );
    });
    await frame.getByTestId('denied-navigation').click();
    await expect(frame.getByRole('heading')).toHaveText('Preview unavailable');
    expect((await nativeLoad).headers()['cache-control']).toContain('no-store');
    expect(
      await frame.evaluate(
        () => (window as Window & { __nativeHostMarker?: string }).__nativeHostMarker,
      ),
    ).toBe(documentNavigation ? undefined : marker);
    // A new mount starts from saved data; no unclaimed server snapshot store.
    const reopened = await openFrame(page, 'a', 'de');
    await send(page, 'a', 'de', 'After native navigation', true);
    await rendered(reopened, 'After native navigation', 'a-leaf-draft-de', 'a-alt-file-draft-de');
    await reopened.evaluate(() => location.reload());
    await expect(reopened.getByTestId('title')).toHaveText('a-draft-de');
    await send(page, 'a', 'de', 'After reload');
    await rendered(reopened, 'After reload', 'a-root-draft-de', 'a-file-draft-de');
  });

  test('isolates two real logins and locale tabs, including denied relationships and recovery', async ({
    page,
    browser,
  }) => {
    const contextB = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: fixture.origin });
    try {
      const other = await contextB.newPage();
      await login(page, 'a');
      await login(other, 'b');
      await enter(page, 'a', 'de');
      await enter(other, 'b', 'en');
      const a = await openFrame(page, 'a', 'de');
      const b = await openFrame(other, 'b', 'en');
      await send(page, 'a', 'de', 'A revision');
      await send(other, 'b', 'en', 'B revision');
      await rendered(a, 'A revision', 'a-root-draft-de', 'a-file-draft-de');
      await rendered(b, 'B revision', 'b-root-draft-en', 'b-file-draft-en');
      // A valid second login does not make the first user's bearer useful.
      const aGrants = (await page.context().cookies()).filter((cookie) =>
        cookie.name.startsWith('__Host-plp-preview-'),
      );
      await contextB.addCookies(aGrants);
      const privateReads = fixture.backend.requests.filter((request) =>
        request.path.startsWith('/api/articles/'),
      ).length;
      expect(
        (await other.request.get('/continuation/a/de/data?preview=true&locale=de')).status(),
      ).toBe(403);
      expect(
        fixture.backend.requests.filter((request) => request.path.startsWith('/api/articles/')),
      ).toHaveLength(privateReads);
      const tab = await page.context().newPage();
      await tab.goto('/');
      await enter(tab, 'a', 'en');
      const english = await openFrame(tab, 'a', 'en');
      await send(tab, 'a', 'en', 'A English', true);
      await rendered(english, 'A English', 'a-leaf-draft-en', 'a-alt-file-draft-en');
      await send(page, 'a', 'de', 'Foreign selection', false, true);
      await rendered(
        a,
        'Foreign selection',
        `ID:${fixture.backend.ids['b-root']}`,
        `ID:${fixture.backend.ids['media-b']}`,
      );
      fixture.backend.setRelatedReadAccess('records', Number(fixture.backend.ids['a-root']), false);
      await send(page, 'a', 'de', 'Revoked selection');
      await rendered(
        a,
        'Revoked selection',
        `ID:${fixture.backend.ids['a-root']}`,
        'a-file-draft-de',
      );
      fixture.backend.setRelatedReadAccess('records', Number(fixture.backend.ids['a-root']), true);
      await send(page, 'a', 'de', 'Recovered selection');
      await rendered(a, 'Recovered selection', 'a-root-draft-de', 'a-file-draft-de');
      await expect(b.getByTestId('title')).toHaveText('B revision');
      await expect(english.getByTestId('title')).toHaveText('A English');
      await tab.close();
    } finally {
      await contextB.close();
    }
  });

  test('keeps concurrent SSR and data reads bound to their current user and locale', async ({
    page,
    browser,
  }) => {
    const contextB = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: fixture.origin });
    try {
      const other = await contextB.newPage();
      await login(page, 'a');
      await login(other, 'b');
      await enter(page, 'a', 'de');
      await enter(other, 'b', 'en');
      const paths = [
        '/continuation/a/de?preview=true&locale=de',
        '/continuation/b/en?preview=true&locale=en',
      ];
      const responses = await Promise.all([
        page.request.get(paths[0]!),
        other.request.get(paths[1]!),
        page.request.get('/continuation/a/de/data?preview=true&locale=de'),
        other.request.get('/continuation/b/en/data?preview=true&locale=en'),
      ]);
      for (let index = 0; index < responses.length; index++) {
        const response = responses[index]!;
        expect(response.status()).toBe(200);
        expect(response.headers()['cache-control']).toContain('no-store');
        const body = await response.text();
        const own = index % 2 === 0 ? 'a-draft-de' : 'b-draft-en';
        const foreign = index % 2 === 0 ? 'b-draft-en' : 'a-draft-de';
        // Report only booleans if a future host accidentally serializes a credential.
        expect(body.includes(own)).toBe(true);
        expect(body.includes(foreign)).toBe(false);
        expect(body.includes(fixture.backend.password)).toBe(false);
        expect(/JWT\s+[A-Za-z0-9_-]{20,}|v1\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]+/u.test(body)).toBe(
          false,
        );
      }
    } finally {
      await contextB.close();
    }
  });

  test('refuses anonymous, foreign-target, replayed and logged-out requests before private reads', async ({
    page,
  }) => {
    await page.goto('/');
    const before = () =>
      fixture.backend.requests.filter((request) => !request.path.startsWith('/api/users/')).length;
    const anonymous = before();
    expect(
      (await page.request.get('/continuation/a/de/data?preview=true&locale=de')).status(),
    ).toBe(403);
    expect(before()).toBe(anonymous);
    await login(page, 'a');
    const token = await enter(page, 'a', 'de');
    const start = before();
    const replay = await page.evaluate(
      async (token) =>
        (
          await fetch('/continuation/a/de/entry?preview=true&locale=de', {
            headers: { 'x-preview-token': token },
          })
        ).status,
      token,
    );
    expect(replay).toBe(403);
    expect(
      (await page.request.get('/continuation/b/de/data?preview=true&locale=de')).status(),
    ).toBe(403);
    expect(
      (await page.request.get('/continuation/a/de/data?preview=true&locale=en')).status(),
    ).toBe(403);
    expect(
      (await page.request.get('/continuation/a/de/data?preview=true&locale=de&depth=5')).status(),
    ).toBe(400);
    expect(before()).toBe(start);
    const oldCookies = await page.context().cookies();
    expect(
      await page.evaluate(
        async () => (await fetch('/continuation/logout', { method: 'POST' })).status,
      ),
    ).toBe(204);
    await page.context().addCookies(oldCookies);
    expect(
      (await page.request.get('/continuation/a/de/data?preview=true&locale=de')).status(),
    ).toBe(403);
    expect(before()).toBe(start);
    await login(page, 'a');
    await enter(page, 'a', 'de');
    expect(
      (await page.request.get('/continuation/a/de/data?preview=true&locale=de')).status(),
    ).toBe(200);
  });

  test('preserves last-good DOM across network failure, rejects late old data, and refuses expired grants', async ({
    page,
  }) => {
    await login(page, 'a');
    await enter(page, 'a', 'de');
    const frame = await openFrame(page, 'a', 'de');
    await send(page, 'a', 'de', 'Last good');
    await rendered(frame, 'Last good', 'a-root-draft-de', 'a-file-draft-de');
    await page.route('**/continuation/a/de/data?*', (route) => route.abort());
    await send(page, 'a', 'de', 'Unavailable');
    await expect(frame.getByTestId('status')).toHaveText('unavailable');
    await expect(frame.getByTestId('title')).toHaveText('Last good');
    await page.unrouteAll();
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((yes) => {
      entered = yes;
    });
    const held = new Promise<void>((yes) => {
      release = yes;
    });
    await page.route('**/continuation/a/de/data?*', async (route) => {
      const result = await route.fetch();
      const body = route.request().postDataJSON() as { data: { title: string } };
      if (body.data.title === 'Old delayed') {
        entered();
        await held;
      }
      await route.fulfill({ response: result }).catch(() => undefined);
    });
    await send(page, 'a', 'de', 'Old delayed');
    await pending;
    await send(page, 'a', 'de', 'Newest', true);
    await rendered(frame, 'Newest', 'a-leaf-draft-de', 'a-alt-file-draft-de');
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(frame.getByTestId('title')).toHaveText('Newest');
    await enter(page, 'a', 'de', 1_000);
    await expect
      .poll(
        async () =>
          (await page.request.get('/continuation/a/de/data?preview=true&locale=de')).status(),
        { timeout: 5_000 },
      )
      .toBe(403);
    const before = fixture.backend.requests.filter((request) =>
      request.path.startsWith('/api/articles/'),
    ).length;
    await send(page, 'a', 'de', 'Expired');
    await expect(frame.getByTestId('status')).toHaveText('unavailable');
    await expect(frame.getByTestId('title')).toHaveText('Newest');
    expect(
      fixture.backend.requests.filter((request) => request.path.startsWith('/api/articles/')),
    ).toHaveLength(before);
  });

  test('serves private cache headers and keeps public HTML free of draft data and preview scripts', async ({
    page,
  }) => {
    const publicResponse = await page.request.get('/');
    const publicHTML = await publicResponse.text();
    expect(publicHTML).not.toContain('draft-de');
    expect(publicHTML).not.toContain('payload-live-preview');
    for (const path of [
      '/continuation/a/de?preview=true&locale=de',
      '/continuation/a/de/data?preview=true&locale=de',
    ]) {
      const response = await page.request.get(path);
      expect(response.headers()['cache-control']).toContain('no-store');
      expect(response.headers()['vary']?.toLowerCase()).toContain('cookie');
      expect(response.headers()['referrer-policy']).toBe('no-referrer');
      expect(await response.text()).not.toContain('a-draft-de');
    }
  });
  test('does not replace missing browser cookies with a query or header continuation', async ({
    page,
  }) => {
    await login(page, 'a');
    const token = await enter(page, 'a', 'de');
    const frame = await openFrame(page, 'a', 'de');
    await send(page, 'a', 'de', 'Before cookie removal');
    await rendered(frame, 'Before cookie removal', 'a-root-draft-de', 'a-file-draft-de');
    await page.context().clearCookies();
    const count = fixture.backend.requests.length;
    await send(page, 'a', 'de', 'Cookies blocked');
    await expect(frame.getByTestId('status')).toHaveText('unavailable');
    await expect(frame.getByTestId('title')).toHaveText('Before cookie removal');
    const response = await page.evaluate(
      async (token) =>
        (
          await fetch('/continuation/a/de/data?preview=true&locale=de', {
            headers: { 'x-preview-token': token },
          })
        ).status,
      token,
    );
    expect(response).toBe(403);
    expect(fixture.backend.requests).toHaveLength(count);
    await frame.evaluate(() => location.reload());
    await expect(frame.getByRole('heading')).toHaveText('Preview unavailable');
    expect(fixture.backend.requests).toHaveLength(count);
  });
});
