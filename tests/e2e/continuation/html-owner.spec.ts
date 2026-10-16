/**
 * Plain HTML has no framework lifecycle to own a removed document component.
 * Exercise an actual pending HTTP revision, disconnection, remount and native
 * client cancellation in a second clean service consumer for each browser.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { startNativeContinuation } from '../helpers/native-continuation';

let fixture: Awaited<ReturnType<typeof startNativeContinuation>>;
let artifact: string;
let closeFixture: (() => Promise<void>) | undefined;

test.describe('framework-free element lifetime', () => {
  test.beforeAll(async ({ browser, browserName }, info) => {
    test.setTimeout(240_000);
    artifact = resolve(
      'test-results/hardening/h04-html-host',
      process.env['PLP_HOST_RUN'] ?? 'native-first',
      'owner',
      browserName,
      'worker-' + String(info.workerIndex),
    );
    fixture = await startNativeContinuation(artifact, 'html');
    closeFixture = fixture.close;
    await writeFile(
      resolve(artifact, 'browser.json'),
      JSON.stringify(
        {
          name: browserName,
          version: browser.version(),
        },
        null,
        2,
      ),
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

  test('aborts a removed owner, mounts once again, and keeps late data and HTML out of its DOM', async ({
    page,
  }) => {
    await page.goto('/');
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
    const owner = await frame.locator('plp-html-preview').elementHandle();
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
      if (body.data.title === 'Removed pending revision') {
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
      await send('Removed pending revision');
      await pending;
      await owner.evaluate((element) => element.remove());
      expect(await owner.evaluate((element) => element.getAttribute('data-stopped'))).toBe('true');
      await owner.evaluate((element) => document.body.appendChild(element));
      await expect(frame.getByTestId('ready')).toHaveText('ready');
      const literal = '<img src=x onerror="window.__htmlOwnerExecuted=true">';
      await send(literal);
      await expect(frame.getByTestId('title')).toHaveText(literal);
      await expect(frame.getByTestId('related')).toHaveText('a-root-draft-de');
      await expect(frame.getByTestId('files')).toHaveText('a-file-draft-de');
      release();
      await page.unrouteAll({ behavior: 'wait' });
      expect((await aborted).failure()).not.toBeNull();
      await expect(frame.getByTestId('title')).toHaveText(literal);
      await expect(frame.locator('plp-html-preview img')).toHaveCount(0);
      expect(
        await frame.evaluate(
          () => (window as Window & { __htmlOwnerExecuted?: boolean }).__htmlOwnerExecuted,
        ),
      ).toBeUndefined();
      expect(revisions).toEqual(['Removed pending revision', literal]);
      await frame.getByTestId('counter').click();
      await expect(frame.getByTestId('counter')).toHaveText('1');
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
      await owner.dispose();
    }
  });
});
