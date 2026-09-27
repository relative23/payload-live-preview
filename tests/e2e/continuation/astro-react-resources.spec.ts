/**
 * React-rendered fragment HTML and a live React root have different owners.
 * The same component supplies a positive hydration control and the static
 * fragment countercheck; real DOM revisions and computed CSS decide acceptance.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { startNativeContinuation } from '../helpers/native-continuation';
import { openResourcePreview, sendResourceRevision } from '../helpers/astro-resource-browser';

let fixture: Awaited<ReturnType<typeof startNativeContinuation>>;
let artifact: string;
let closeFixture: (() => Promise<void>) | undefined;

test.describe('native Astro additional React renderer', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const violations: string[] = [];
      Object.assign(window, { resourceCspViolations: violations });
      document.addEventListener('securitypolicyviolation', (event) =>
        violations.push(event.violatedDirective),
      );
    });
  });
  test.beforeAll(async ({ browser, browserName }, info) => {
    test.setTimeout(240_000);
    expect(process.env['PLP_ASTRO_RESOURCE_RENDERER']).toBe('react-server');
    artifact = resolve(
      'test-results/hardening/h05-astro-react/renderer',
      process.env['PLP_HOST_RUN'] ?? 'native-first',
      browserName,
      'worker-' + String(info.workerIndex),
    );
    fixture = await startNativeContinuation(artifact, 'astro', false, 'astro-resources');
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

  test('renders two static React revisions while a separately hydrated React owner stays interactive', async ({
    page,
  }) => {
    let pageErrors = 0;
    page.on('pageerror', () => {
      pageErrors++;
    });
    const frame = await openResourcePreview(fixture, page, 'a', 'de');
    const control = frame.getByTestId('react-control');
    await expect(control.getByTestId('react-panel')).toHaveAttribute('data-react-hydrated', 'true');
    await control.getByTestId('react-counter').click();
    await expect(control.getByTestId('react-counter')).toHaveText('1');
    await expect(frame.getByTestId('resource-card')).toHaveCount(0);
    const revisions: { title: string; derived: number; styles: unknown }[] = [];
    for (const title of ['Unsaved React <b>α</b>', 'Second unsaved React β']) {
      await sendResourceRevision(fixture, page, 'a', 'de', title);
      const cards = frame.getByTestId('resource-card');
      await expect(cards.getByTestId('react-title')).toHaveText([title, title]);
      await expect(cards.getByTestId('react-derived')).toHaveText([
        String(Array.from(title).length),
        String(Array.from(title).length),
      ]);
      for (const panel of await cards.getByTestId('react-panel').all()) {
        await expect(panel).toHaveAttribute('data-react-hydrated', 'false');
        await expect(panel).toHaveAttribute('data-react-locale', 'de');
        await expect(panel).toHaveAttribute(
          'data-react-subject',
          String(fixture.backend.ids['user-a']),
        );
        await panel.getByTestId('react-counter').click();
        await expect(panel.getByTestId('react-counter')).toHaveText('0');
      }
      const styles = await cards.getByTestId('react-panel').evaluateAll((elements) =>
        elements.map((element) => ({
          padding: getComputedStyle(element).paddingLeft,
          border: getComputedStyle(element).borderLeftWidth,
        })),
      );
      expect(styles).toEqual([
        { padding: '11px', border: '5px' },
        { padding: '11px', border: '5px' },
      ]);
      await expect(cards.locator('script, style, link, astro-island, b')).toHaveCount(0);
      await expect(control.getByTestId('react-counter')).toHaveText('1');
      revisions.push({ title, derived: Array.from(title).length, styles });
    }
    await expect(frame.getByTestId('renders')).toHaveText('4');
    const owner = await control.elementHandle();
    const build = JSON.parse(await readFile(resolve(artifact, 'build.json'), 'utf8')) as {
      catalogStylesheets: string[];
    };
    await frame.evaluate(() => {
      Reflect.set(window, 'reactDocumentMarker', true);
    });
    await frame.getByTestId('navigation').click();
    await frame.waitForURL(fixture.origin + '/');
    expect(await frame.evaluate(() => Reflect.get(window, 'reactDocumentMarker') === true)).toBe(
      true,
    );
    expect(await owner.evaluate((element) => element.getAttribute('data-stopped'))).toBe('true');
    expect(
      await owner.evaluate(
        (element) => element.querySelector('[data-testid="react-panel"]') === null,
      ),
    ).toBe(true);
    await owner.dispose();
    for (const path of build.catalogStylesheets) {
      await expect(
        frame.locator(`link[rel="stylesheet"][href="${path.replace(/^dist\/client/u, '')}"]`),
      ).toHaveCount(0);
    }
    const violations = await frame.evaluate(
      () => Reflect.get(window, 'resourceCspViolations') as string[],
    );
    expect(violations).toEqual([]);
    expect(pageErrors).toBe(0);
    await writeFile(
      resolve(artifact, 'server-versus-client.json'),
      JSON.stringify(
        {
          revisions,
          fragmentHydrated: false,
          pageOwnedControlHydrated: true,
          retainedControlCount: 1,
          nativeNavigation: true,
          reactRootUnmounted: true,
          violations,
          pageErrors,
          contentWrites: fixture.backend.writes(),
        },
        null,
        2,
      ),
    );
  });

  test('keeps concurrent React providers bound to each verified request', async ({
    page,
    browser,
  }) => {
    const other = await browser.newContext({ baseURL: fixture.origin, ignoreHTTPSErrors: true });
    try {
      const pageB = await other.newPage();
      const [frameA, frameB] = await Promise.all([
        openResourcePreview(fixture, page, 'a', 'de'),
        openResourcePreview(fixture, pageB, 'b', 'en'),
      ]);
      await Promise.all([
        sendResourceRevision(fixture, page, 'a', 'de', 'Slow React A', 80),
        sendResourceRevision(fixture, pageB, 'b', 'en', 'Fast React B'),
      ]);
      for (const [frame, editor, locale, title] of [
        [frameA, 'a', 'de', 'Slow React A'],
        [frameB, 'b', 'en', 'Fast React B'],
      ] as const) {
        const cards = frame.getByTestId('resource-card');
        await expect(cards.getByTestId('react-title')).toHaveText([title, title]);
        for (const panel of await cards.getByTestId('react-panel').all()) {
          await expect(panel).toHaveAttribute('data-react-locale', locale);
          await expect(panel).toHaveAttribute(
            'data-react-subject',
            String(fixture.backend.ids['user-' + editor]),
          );
          await expect(panel).toHaveAttribute(
            'data-react-path',
            '/continuation/' + editor + '/' + locale,
          );
          await expect(panel).toHaveAttribute('data-react-hydrated', 'false');
        }
        await expect(frame.getByTestId('react-control').getByTestId('react-panel')).toHaveAttribute(
          'data-react-subject',
          '',
        );
      }
      await writeFile(
        resolve(artifact, 'react-isolation.json'),
        JSON.stringify(
          {
            users: 2,
            locales: ['de', 'en'],
            delayedA: 80,
            actualReactTitlesAndProviderAttributes: true,
            pageProviderNotInherited: true,
            contentWrites: fixture.backend.writes(),
          },
          null,
          2,
        ),
      );
    } finally {
      await other.close();
    }
  });
});
