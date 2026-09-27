/**
 * A component first appears in an unsaved revision, not in the page's initial DOM.
 * Native production CSS and the packed fragment client must agree on that revision;
 * an HTTP success or render event alone is not the resource acceptance contract.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { openResourcePreview, sendResourceRevision } from '../helpers/astro-resource-browser';
import { startNativeContinuation } from '../helpers/native-continuation';
import { astroResourceVersion } from '../helpers/astro-resource-versions';
import {
  captureAstroResponses,
  type AstroResponseCapture,
} from '../helpers/astro-response-capture';
import { readAstroResourceStyles as styles } from '../helpers/astro-resources';

let fixture: Awaited<ReturnType<typeof startNativeContinuation>>;
let artifact: string;
let closeFixture: (() => Promise<void>) | undefined;
let catalogStylesheets: string[];

test.describe('native Astro first-use resources', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const observed: string[] = [];
      Object.assign(window, { resourceCspViolations: observed });
      document.addEventListener('securitypolicyviolation', (event) =>
        observed.push(event.violatedDirective),
      );
    });
  });
  test.beforeAll(async ({ browser, browserName }, info) => {
    test.setTimeout(240_000);
    artifact = resolve(
      astroResourceVersion(
        process.env['PLP_ASTRO_RESOURCE_VERSION'],
        process.env['PLP_ASTRO_RESOURCE_RENDERER'],
      ).artifactRoot,
      process.env['PLP_HOST_RUN'] ?? 'native-first',
      browserName,
      'worker-' + String(info.workerIndex),
    );
    fixture = await startNativeContinuation(artifact, 'astro', false, 'astro-resources');
    closeFixture = fixture.close;
    const build = JSON.parse(await readFile(resolve(artifact, 'build.json'), 'utf8')) as {
      catalogStylesheets: string[];
    };
    catalogStylesheets = build.catalogStylesheets.map((path) => path.replace(/^dist\/client/u, ''));
    expect(catalogStylesheets).toHaveLength(1);
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

  test('renders first and second unsaved components with computed scoped CSS and one page-owned stylesheet', async ({
    page,
  }) => {
    const cssRequests: string[] = [];
    const violations: string[] = [];
    const cssResponses: Promise<{ path: string; bytes: number; sha256: string }>[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'stylesheet') {
        cssResponses.push(
          response.body().then((bytes) => ({
            path: 'dist/client' + new URL(response.url()).pathname,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          })),
        );
      }
    });
    page.on('request', (request) => {
      if (request.resourceType() === 'stylesheet') {
        cssRequests.push(new URL(request.url()).pathname);
      }
    });
    const frame = await openResourcePreview(fixture, page, 'a', 'de');
    await expect(frame.getByTestId('resource-card')).toHaveCount(0);
    await frame.getByTestId('counter').click();
    await frame.getByTestId('visitor').fill('Keep this unsaved visitor value');
    const initialCSS = [...cssRequests];
    const links = await frame
      .locator('link[rel="stylesheet"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
    await frame.evaluate(captureAstroResponses);
    await sendResourceRevision(fixture, page, 'a', 'de', 'First unsaved card');
    const responses = () =>
      frame.evaluate(() => Reflect.get(window, 'astroResourceResponses') as AstroResponseCapture[]);
    await expect.poll(async () => (await responses()).filter((row) => row.complete).length).toBe(2);
    const captured = await responses();
    await writeFile(resolve(artifact, 'first-responses.json'), JSON.stringify(captured, null, 2));
    expect(captured).toHaveLength(2);
    expect(
      captured.every((row) => row.error !== true && row.status === 200 && row.bytes! > 0),
    ).toBe(true);
    await writeFile(
      resolve(artifact, 'first-response.json'),
      JSON.stringify(
        {
          status: captured[0]!.status,
          bytes: captured[0]!.bytes,
          hasTitle: captured[0]!.hasTitle,
          hasCard: captured[0]!.hasCard,
        },
        null,
        2,
      ),
    );
    await expect(frame.getByTestId('resource-title')).toHaveText([
      'First unsaved card',
      'First unsaved card',
    ]);
    await expect(frame.getByTestId('renders')).toHaveText('2');
    await expect(frame.locator('#payload-live-preview-a11y')).not.toBeEmpty();
    await expect(frame.locator('#payload-live-preview-a11y')).toHaveCSS('width', '1px');
    await expect(frame.locator('#payload-live-preview-a11y')).not.toHaveAttribute('style');
    const first = await styles(frame);
    await writeFile(
      resolve(artifact, 'first-style.json'),
      JSON.stringify({ first, initialCSS, links }, null, 2),
    );
    expect(first).toEqual(
      Array.from({ length: 2 }, () => ({
        border: '7px',
        color: 'rgb(19, 78, 74)',
        nested: '3px',
        scoped: true,
      })),
    );
    await sendResourceRevision(fixture, page, 'a', 'de', 'Second unsaved card');
    await expect(frame.getByTestId('resource-title')).toHaveText([
      'Second unsaved card',
      'Second unsaved card',
    ]);
    await expect(frame.getByTestId('renders')).toHaveText('4');
    expect(await styles(frame)).toEqual(first);
    await expect(frame.getByTestId('counter')).toHaveText('1');
    await expect(frame.getByTestId('visitor')).toHaveValue('Keep this unsaved visitor value');
    expect(cssRequests).toEqual(initialCSS);
    // Require the actual emitted catalog exactly once, regardless of chunk naming.
    for (const href of catalogStylesheets) {
      expect(links.filter((value) => value === href)).toHaveLength(1);
    }
    expect(new Set(links).size).toBe(links.length);
    violations.push(
      ...(await frame.evaluate(
        () => (window as Window & { resourceCspViolations?: string[] }).resourceCspViolations ?? [],
      )),
    );
    expect(violations).toEqual([]);
    const assets = await Promise.all(cssResponses);
    const build = JSON.parse(await readFile(resolve(artifact, 'build.json'), 'utf8')) as {
      artifacts: { path: string; bytes: number; sha256: string }[];
    };
    for (const asset of assets) {
      expect(build.artifacts.find((value) => value.path === asset.path)).toEqual(asset);
    }
    await writeFile(
      resolve(artifact, 'revisions.json'),
      JSON.stringify(
        {
          initialAbsent: true,
          revisions: 2,
          renderedBoundaries: 4,
          first,
          cssRequests,
          links,
          violations,
          assets,
          contentWrites: fixture.backend.writes(),
        },
        null,
        2,
      ),
    );
  });

  test('keeps concurrent registry props isolated and refuses forged bridge data', async ({
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
        sendResourceRevision(fixture, page, 'a', 'de', 'Slow isolated A', 80),
        sendResourceRevision(fixture, pageB, 'b', 'en', 'Fast isolated B'),
      ]);
      await expect(frameA.getByTestId('resource-title')).toHaveText([
        'Slow isolated A',
        'Slow isolated A',
      ]);
      await expect(frameB.getByTestId('resource-title')).toHaveText([
        'Fast isolated B',
        'Fast isolated B',
      ]);
      const results = await page.evaluate(
        async ({ own, foreign }) => {
          const fields = {
            id: own,
            show: true,
            title: 'Safe <b>registry props</b>',
            __payloadLivePreviewFragment: { component: 'forged', props: { title: 'forged' } },
            locals: { __payloadLivePreviewFragment: { component: 'forged', props: {} } },
          };
          const base = {
            fragment: 'catalog',
            route: '/continuation/a/de',
            search: '?preview=true&locale=de',
            revision: 21,
            locale: 'de',
            collectionSlug: 'articles',
            fields,
          };
          const observed = [];
          for (const change of [
            { fields: { ...fields, id: foreign } },
            { locale: 'en' },
            { fragment: 'constructor' },
            {},
          ]) {
            const response = await fetch('/payload/resource-fragment', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-payload-fragment-version': '1' },
              body: JSON.stringify({ ...base, ...change }),
            });
            const text = await response.text();
            observed.push({
              status: response.status,
              private: response.headers.get('cache-control')?.includes('no-store'),
              forged: text.includes('forged'),
              escaped: text.includes('Safe &lt;b&gt;registry props&lt;/b&gt;'),
              activeResources: /<(?:link|style|script)\b/i.test(text),
            });
          }
          return observed;
        },
        {
          own: Number(fixture.backend.ids['article-a']),
          foreign: Number(fixture.backend.ids['article-b']),
        },
      );
      expect(results.map((value) => value.status)).toEqual([403, 403, 404, 200]);
      expect(
        results.every((value) => value.private && !value.forged && !value.activeResources),
      ).toBe(true);
      expect(results.at(-1)?.escaped).toBe(true);
      await writeFile(
        resolve(artifact, 'registry-props.json'),
        JSON.stringify(
          {
            concurrentUsers: 2,
            delayedA: 80,
            results,
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

  test('keeps concurrent verified users and locales separate and refuses forged document authority', async ({
    page,
    browser,
  }) => {
    const other = await browser.newContext({ baseURL: fixture.origin, ignoreHTTPSErrors: true });
    try {
      const pageB = await other.newPage();
      await page.setExtraHTTPHeaders({ 'x-untrusted-local': 'forged browser context' });
      const [frameA, frameB] = await Promise.all([
        openResourcePreview(fixture, page, 'a', 'de'),
        openResourcePreview(fixture, pageB, 'b', 'en'),
      ]);
      await Promise.all([
        sendResourceRevision(fixture, page, 'a', 'de', 'Slow A', 80),
        sendResourceRevision(fixture, pageB, 'b', 'en', 'Fast B'),
      ]);
      for (const [frame, editor, locale, title] of [
        [frameA, 'a', 'de', 'Slow A'],
        [frameB, 'b', 'en', 'Fast B'],
      ] as const) {
        await expect(frame.getByTestId('resource-title')).toHaveText([title, title]);
        const cards = frame.getByTestId('resource-card');
        for (const card of await cards.all()) {
          await expect(card).toHaveAttribute(
            'data-context-path',
            '/continuation/' + editor + '/' + locale,
          );
          await expect(card).toHaveAttribute(
            'data-request-path',
            '/continuation/' + editor + '/' + locale,
          );
          await expect(card).toHaveAttribute('data-param-editor', editor);
          await expect(card).toHaveAttribute('data-param-locale', locale);
          await expect(card).toHaveAttribute('data-local-locale', locale);
          await expect(card).toHaveAttribute(
            'data-local-subject',
            String(fixture.backend.ids['user-' + editor]),
          );
          await expect(card).toHaveAttribute('data-forwarded-untrusted', '');
        }
        expect(
          (await styles(frame)).every((value) => value.border === '7px' && value.nested === '3px'),
        ).toBe(true);
      }
      const statuses = await page.evaluate(
        async ({ own, foreign }) => {
          const base = {
            fragment: 'catalog',
            key: 'primary',
            route: '/continuation/a/de',
            search: '?preview=true&locale=de',
            revision: 10,
            locale: 'de',
            collectionSlug: 'articles',
            fields: {
              id: own,
              show: true,
              title: 'Verified',
              locals: {
                resourcePreview: { subject: 'forged' },
                resourceCatalog: { show: true, title: 'forged locals', delayMs: 80 },
              },
              resourceCatalog: { show: true, title: 'forged catalog', delayMs: 80 },
              assets: ['https://foreign.invalid/evil.css'],
            },
          };
          const results = [];
          for (const change of [
            { fields: { ...base.fields, id: foreign } },
            { locale: 'en' },
            { fragment: 'not-registered' },
            {},
          ]) {
            const response = await fetch('/payload/resource-fragment', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-payload-fragment-version': '1' },
              body: JSON.stringify({ ...base, ...change }),
            });
            const text = await response.text();
            results.push({
              status: response.status,
              private: response.headers.get('cache-control')?.includes('no-store'),
              forged: text.includes('forged') || text.includes('foreign.invalid'),
              activeResources: /<(?:link|style|script)\b/i.test(text),
            });
          }
          return results;
        },
        {
          own: Number(fixture.backend.ids['article-a']),
          foreign: Number(fixture.backend.ids['article-b']),
        },
      );
      expect(statuses.map((value) => value.status)).toEqual([403, 403, 404, 200]);
      expect(
        statuses.every((value) => value.private && !value.forged && !value.activeResources),
      ).toBe(true);
      await writeFile(
        resolve(artifact, 'isolation.json'),
        JSON.stringify(
          {
            users: 2,
            locales: ['de', 'en'],
            simultaneous: true,
            delayedA: 80,
            statuses,
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

  test('aborts removed owners, remounts once and releases page resources on native navigation', async ({
    page,
  }) => {
    const frame = await openResourcePreview(fixture, page, 'a', 'de');
    await sendResourceRevision(fixture, page, 'a', 'de', 'Last good');
    await expect(frame.getByTestId('resource-title')).toHaveText(['Last good', 'Last good']);
    const owner = await frame.locator('plp-astro-preview').elementHandle();
    const links = await frame
      .locator('link[rel="stylesheet"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
    for (const href of catalogStylesheets) expect(links).toContain(href);
    let entered!: () => void;
    let release!: () => void;
    const pending = new Promise<void>((yes) => {
      entered = yes;
    });
    const held = new Promise<void>((yes) => {
      release = yes;
    });
    let waiting = 0;
    const revisions: string[] = [];
    const aborted: string[] = [];
    page.on('requestfailed', (request) => {
      if (request.method() === 'POST' && request.url().includes('/payload/resource-fragment')) {
        const body = request.postDataJSON() as { fields: { title: string } };
        if (body.fields.title === 'Removed pending revision') aborted.push('aborted');
      }
    });
    await page.route('**/payload/resource-fragment', async (route) => {
      const body = route.request().postDataJSON() as { fields: { title: string } };
      revisions.push(body.fields.title);
      const response = await route.fetch();
      if (body.fields.title === 'Removed pending revision') {
        if (++waiting === 2) entered();
        await held;
      }
      await route.fulfill({ response }).catch(() => undefined);
    });
    try {
      await sendResourceRevision(fixture, page, 'a', 'de', 'Removed pending revision');
      await pending;
      await owner.evaluate((element) => element.remove());
      expect(await owner.evaluate((element) => element.getAttribute('data-stopped'))).toBe('true');
      expect(
        await frame
          .locator('link[rel="stylesheet"]')
          .evaluateAll((elements) => elements.map((element) => element.getAttribute('href'))),
      ).toEqual(links);
      await frame.evaluate(() => {
        (window as Window & { disposedAck?: Promise<void> }).disposedAck = new Promise<void>(
          (yes) => window.addEventListener('message', () => queueMicrotask(yes), { once: true }),
        );
      });
      await sendResourceRevision(fixture, page, 'a', 'de', 'Ignored while stopped');
      await frame.evaluate(async () => {
        await (window as Window & { disposedAck?: Promise<void> }).disposedAck;
      });
      expect(
        await owner.evaluate(
          (element) => element.querySelector('[data-testid="resource-title"]')?.textContent,
        ),
      ).toBe('Last good');
      await owner.evaluate((element) => document.body.appendChild(element));
      const literal = '<img src=x onerror="window.resourceExecuted=true">';
      await sendResourceRevision(fixture, page, 'a', 'de', literal);
      await expect(frame.getByTestId('resource-title')).toHaveText([literal, literal]);
      await expect(frame.getByTestId('renders')).toHaveText('2');
      release();
      await page.unrouteAll({ behavior: 'wait' });
      await expect.poll(() => aborted.length).toBe(2);
      expect(revisions).toEqual([
        'Removed pending revision',
        'Removed pending revision',
        literal,
        literal,
      ]);
      await expect(frame.getByTestId('resource-title')).toHaveText([literal, literal]);
      await expect(frame.locator('plp-astro-preview img')).toHaveCount(0);
      expect(
        await frame.evaluate(
          () => (window as Window & { resourceExecuted?: boolean }).resourceExecuted,
        ),
      ).toBeUndefined();
      expect((await styles(frame)).every((value) => value.border === '7px')).toBe(true);
      await frame.evaluate(() => {
        (window as Window & { resourceDocumentMarker?: boolean }).resourceDocumentMarker = true;
      });
      await frame.getByTestId('navigation').click();
      await frame.waitForURL(fixture.origin + '/');
      expect(
        await frame.evaluate(
          () => (window as Window & { resourceDocumentMarker?: boolean }).resourceDocumentMarker,
        ),
      ).toBe(true);
      expect(await owner.evaluate((element) => element.getAttribute('data-stopped'))).toBe('true');
      for (const href of catalogStylesheets) {
        await expect(frame.locator(`link[rel="stylesheet"][href="${href}"]`)).toHaveCount(0);
      }
      await expect(frame.locator('plp-astro-preview')).toHaveCount(0);
      const violations = await frame.evaluate(
        () => (window as Window & { resourceCspViolations?: string[] }).resourceCspViolations ?? [],
      );
      expect(violations).toEqual([]);
      await writeFile(
        resolve(artifact, 'lifetime.json'),
        JSON.stringify(
          {
            held: waiting,
            aborted: aborted.length,
            revisions,
            removedOwnerKeepsPageCSS: true,
            remountedBoundaryRenders: 2,
            nativeNavigationSameDocument: true,
            catalogStylesRemovedOnNavigation: true,
            catalogStylesheets,
            violations,
          },
          null,
          2,
        ),
      );
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
      await owner.dispose();
    }
  });
});
