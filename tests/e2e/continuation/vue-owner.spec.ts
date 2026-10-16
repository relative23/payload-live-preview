/**
 * A standalone Vue effect scope must release the packed composable subscription.
 * Keep the component mounted while stopping an actual in-flight revision, then
 * create one replacement scope and refuse the held old response.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { startNativeContinuation } from '../helpers/native-continuation';

let fixture: Awaited<ReturnType<typeof startNativeContinuation>>;
let artifact: string;
let closeFixture: (() => Promise<void>) | undefined;

test.describe('standalone Vue scope lifetime', () => {
  test.beforeAll(async ({ browser, browserName }, info) => {
    test.setTimeout(240_000);
    artifact = resolve(
      'test-results/hardening/h04-vue-host',
      process.env['PLP_HOST_RUN'] ?? 'native-first',
      'owner',
      browserName,
      'worker-' + String(info.workerIndex),
    );
    fixture = await startNativeContinuation(artifact, 'vue');
    closeFixture = fixture.close;
    await writeFile(
      resolve(artifact, 'browser.json'),
      JSON.stringify({ name: browserName, version: browser.version() }, null, 2),
    );
  });
  test.afterAll(async () => {
    if (!closeFixture) return;
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

  test('cancels on scope disposal, ignores stopped messages and mounts exactly one replacement', async ({
    page,
  }) => {
    const clientErrors: string[] = [];
    page.on('pageerror', () => clientErrors.push('pageerror'));
    page.on('console', (message) => {
      if (/hydration|mismatch/iu.test(message.text())) clientErrors.push('hydration');
    });
    await page.goto('/');
    for (const path of [
      '/private-config.json',
      '/server.mjs',
      '/ssr/entry-server.js',
      '/assets.json',
    ]) {
      const response = await page.request.get(path);
      expect(response.status()).toBe(404);
      expect((await response.text()).includes(fixture.backend.password)).toBe(false);
    }
    const token = await fixture.token('a', 'de');
    const statuses = await page.evaluate(
      async ({ password, token }) => {
        const login = await fetch('/continuation/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'a@fixture.invalid', password }),
        });
        const entry = await fetch('/continuation/a/de/entry?preview=true&locale=de', {
          headers: { 'x-preview-token': token },
        });
        document.querySelector<HTMLIFrameElement>('#preview')!.src =
          '/continuation/a/de?preview=true&locale=de';
        return [login.status, entry.status];
      },
      { password: fixture.backend.password, token },
    );
    expect(statuses).toEqual([204, 200]);
    await expect(page.frameLocator('#preview').getByTestId('ready')).toHaveText('ready');
    const frame = page.frames().find((value) => value.url().includes('/continuation/a/de'))!;
    const send = async (title: string): Promise<void> => {
      await page.evaluate(
        (data) => {
          document.querySelector<HTMLIFrameElement>('#preview')!.contentWindow!.postMessage(
            {
              type: 'payload-live-preview',
              collectionSlug: 'articles',
              locale: 'de',
              data,
            },
            location.origin,
          );
        },
        {
          id: Number(fixture.backend.ids['article-a']),
          title,
          related: [Number(fixture.backend.ids['a-root'])],
          files: [Number(fixture.backend.ids['media-a'])],
        },
      );
    };
    let entered!: () => void;
    let release!: () => void;
    const pending = new Promise<void>((yes) => {
      entered = yes;
    });
    const held = new Promise<void>((yes) => {
      release = yes;
    });
    const revisions: string[] = [];
    await page.route('**/continuation/a/de/data?*', async (route) => {
      const body = route.request().postDataJSON() as { data: { title: string } };
      revisions.push(body.data.title);
      const response = await route.fetch();
      if (body.data.title === 'Disposed pending revision') {
        entered();
        await held;
      }
      await route.fulfill({ response }).catch(() => undefined);
    });
    const aborted = page.waitForEvent('requestfailed', {
      predicate: (request) =>
        request.method() === 'POST' && request.url().includes('/continuation/a/de/data?'),
    });
    void aborted.catch(() => undefined);
    try {
      // This is an actual browser message from the allowed origin but the
      // wrong Window (the preview itself), not a forged Event.source object.
      await frame.evaluate(
        async (data) => {
          const delivered = new Promise<void>((yes) =>
            window.addEventListener('message', () => queueMicrotask(yes), { once: true }),
          );
          window.postMessage(
            {
              type: 'payload-live-preview',
              collectionSlug: 'articles',
              locale: 'de',
              data,
            },
            location.origin,
          );
          await delivered;
        },
        {
          id: Number(fixture.backend.ids['article-a']),
          title: 'Wrong window revision',
          related: [Number(fixture.backend.ids['a-root'])],
          files: [Number(fixture.backend.ids['media-a'])],
        },
      );
      await expect(frame.getByTestId('title')).toHaveText('a-draft-de');
      await send('Last good before disposal');
      await expect(frame.getByTestId('title')).toHaveText('Last good before disposal');
      await frame.getByTestId('counter').click();
      await frame.getByTestId('visitor').fill('State outside the preview scope');
      await send('Disposed pending revision');
      await pending;
      await frame.getByTestId('stop-scope').click();
      await expect(frame.getByTestId('scope')).toHaveText('stopped');
      await expect(frame.getByTestId('title')).toHaveText('Last good before disposal');
      // A message-event acknowledgement, not a sleep, separates delivery to
      // the disposed scope from the deliberate creation of its replacement.
      await frame.evaluate(() => {
        (window as Window & { __disposedAck?: Promise<void> }).__disposedAck = new Promise<void>(
          (yes) => window.addEventListener('message', () => queueMicrotask(yes), { once: true }),
        );
      });
      await send('Ignored after scope disposal');
      await frame.evaluate(async () => {
        await (window as Window & { __disposedAck?: Promise<void> }).__disposedAck;
      });
      await expect(frame.getByTestId('title')).toHaveText('Last good before disposal');
      await frame.getByTestId('restart-scope').click();
      await expect(frame.getByTestId('generation')).toHaveText('2');
      await expect(frame.getByTestId('scope')).toHaveText('active');
      const literal = '<img src=x onerror="window.__vueOwnerExecuted=true">';
      await send(literal);
      await expect(frame.getByTestId('title')).toHaveText(literal);
      await expect(frame.getByTestId('related')).toHaveText('a-root-draft-de');
      await expect(frame.getByTestId('files')).toHaveText('a-file-draft-de');
      release();
      await page.unrouteAll({ behavior: 'wait' });
      expect((await aborted).failure()).not.toBeNull();
      await expect(frame.getByTestId('title')).toHaveText(literal);
      await expect(frame.locator('#vue-app img')).toHaveCount(0);
      expect(
        await frame.evaluate(
          () => (window as Window & { __vueOwnerExecuted?: boolean }).__vueOwnerExecuted,
        ),
      ).toBeUndefined();
      expect(revisions).toEqual([
        'Last good before disposal',
        'Disposed pending revision',
        literal,
      ]);
      await expect(frame.getByTestId('counter')).toHaveText('1');
      await expect(frame.getByTestId('visitor')).toHaveValue('State outside the preview scope');
      expect(clientErrors).toEqual([]);
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
});
