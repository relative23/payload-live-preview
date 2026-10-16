/**
 * Native page-owned React must commit unsaved revisions, not just receive events.
 * The archive, compiler and framework own the production path under test.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { startNativeContinuation } from '../helpers/native-continuation';
import { openResourcePreview, sendResourceRevision } from '../helpers/astro-resource-browser';
import {
  observeReactOwners,
  readReactOwners,
  sendOwnerRevision,
} from '../helpers/astro-owner-browser';

let fixture: Awaited<ReturnType<typeof startNativeContinuation>>;
let artifact: string;
let closeFixture: (() => Promise<void>) | undefined;
let pageErrors: number;

test.beforeEach(async ({ page }) => {
  pageErrors = 0;
  page.on('pageerror', () => {
    pageErrors++;
  });
  await observeReactOwners(page);
});
test.afterEach(async ({ page }, info) => {
  const frame = page.frames().find((value) => value.parentFrame() === page.mainFrame());
  if (frame) {
    await writeFile(
      resolve(artifact, info.title.replace(/[^a-z0-9]+/gi, '-') + '.json'),
      JSON.stringify(
        {
          status: info.status,
          pageErrors,
          contentWrites: fixture.backend.writes(),
          ...(await readReactOwners(frame)),
        },
        null,
        2,
      ),
    );
    expect((await readReactOwners(frame)).violations).toEqual([]);
  }
  expect(pageErrors).toBe(0);
});

test.beforeAll(async ({ browser, browserName }, info) => {
  test.setTimeout(240_000);
  expect(process.env['PLP_ASTRO_RESOURCE_RENDERER']).toBe('react-owned');
  artifact = resolve(
    'test-results/hardening/h05-astro-owner/native',
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

test('commits consecutive unsaved React branches with retained keyed state', async ({ page }) => {
  const frame = await openResourcePreview(fixture, page, 'a', 'de');
  const owners = frame.locator('[data-owner-id]');
  await expect(owners).toHaveCount(2);
  for (const owner of await owners.all()) await expect(owner).toHaveAttribute('data-ready', 'true');
  await expect(frame.getByTestId('owner-card')).toHaveCount(0);
  try {
    for (const [index, title] of ['Unsaved <b>React α</b>', 'New unsaved React 🦊'].entries()) {
      await sendResourceRevision(fixture, page, 'a', 'de', title);
      await expect(frame.getByTestId('renders')).toHaveText(String((index + 1) * 2));
      await expect(frame.getByTestId('owner-title')).toHaveText([title, title]);
      await expect(frame.getByTestId('owner-derived')).toHaveText(
        Array(2).fill(String(Array.from(title).length)),
      );
      for (const owner of await owners.all()) {
        await expect(owner).toHaveAttribute('data-revision', String(index + 1));
        await owner.getByTestId('owner-counter').click();
        await expect(owner.getByTestId('owner-counter')).toHaveText(String(index + 1));
        await expect(owner.locator('b, img, script, style, link')).toHaveCount(0);
        await expect(owner.getByTestId('owner-card')).toHaveCSS('padding-left', '11px');
      }
    }
  } finally {
    await writeFile(
      resolve(artifact, 'commits.json'),
      JSON.stringify(
        {
          owners: await owners.evaluateAll((elements) =>
            elements.map((element) => ({
              ready: element.getAttribute('data-ready'),
              revision: element.getAttribute('data-revision'),
              title: element.querySelector('[data-testid="owner-title"]')?.textContent ?? null,
              counter: element.querySelector('[data-testid="owner-counter"]')?.textContent ?? null,
            })),
          ),
          contentWrites: fixture.backend.writes(),
        },
        null,
        2,
      ),
    );
  }
});

test('isolates the island-only control without fragment work', async ({ page }) => {
  const frame = await openResourcePreview(fixture, page, 'a', 'de');
  for (const owner of await frame.locator('[data-owner-id]').all()) {
    await expect(owner).toHaveAttribute('data-ready', 'true');
  }
  // A causal countercheck, not a proposed workaround for the mixed page.
  await frame
    .locator('[data-payload-fragment]')
    .evaluateAll((elements) => elements.forEach((element) => element.remove()));
  await expect(frame.getByTestId('owner-card')).toHaveCount(0);
  for (const [index, title] of ['First island-only revision', 'Next island-only 🦊'].entries()) {
    await sendResourceRevision(fixture, page, 'a', 'de', title);
    await expect(frame.getByTestId('owner-title')).toHaveText([title, title]);
    await expect(frame.getByTestId('owner-derived')).toHaveText(
      Array(2).fill(String(Array.from(title).length)),
    );
    for (const owner of await frame.locator('[data-owner-id]').all()) {
      await expect(owner).toHaveAttribute('data-revision', String(index + 1));
      await owner.getByTestId('owner-counter').click();
      await expect(owner.getByTestId('owner-counter')).toHaveText(String(index + 1));
      await expect(owner.getByTestId('owner-card')).toHaveCSS('padding-left', '11px');
    }
  }
  expect((await readReactOwners(frame)).updates.map((value) => value.revision)).toEqual([
    1, 1, 2, 2,
  ]);
});

async function verifyPreHydration(
  page: Page,
  fragments: boolean,
  titles = ['Before native hydration 🦊'],
): Promise<void> {
  const build = JSON.parse(await readFile(resolve(artifact, 'build.json'), 'utf8')) as {
    artifacts: { path: string }[];
  };
  const chunks = build.artifacts.filter((value) =>
    /^dist\/client\/_astro\/ReactCatalog\.[^/]+\.js$/u.test(value.path),
  );
  expect(chunks).toHaveLength(1);
  let release!: () => void;
  const held = new Promise<void>((yes) => {
    release = yes;
  });
  let requested = 0;
  await page.route(fixture.origin + chunks[0]!.path.replace('dist/client', ''), async (route) => {
    requested++;
    await held;
    await route.continue();
  });
  try {
    const frame = await openResourcePreview(fixture, page, 'a', 'de');
    await expect.poll(() => requested).toBe(1);
    await expect(frame.locator('plp-astro-preview astro-island[ssr]')).toHaveCount(2);
    if (!fragments) {
      await frame
        .locator('[data-payload-fragment]')
        .evaluateAll((elements) => elements.forEach((element) => element.remove()));
    }
    for (const [index, title] of titles.entries()) {
      await sendResourceRevision(fixture, page, 'a', 'de', title);
      if (fragments) await expect(frame.getByTestId('renders')).toHaveText(String((index + 1) * 2));
      // Read-only packed-client counts prove processing ended before the real
      // component download resumes. An ingress event is not that proof.
      await expect
        .poll(async () => (await readReactOwners(frame)).revisions?.completed)
        .toBe(index + 1);
    }
    expect((await readReactOwners(frame)).updates).toEqual([]);
    release();
    await page.unrouteAll({ behavior: 'wait' });
    for (const owner of await frame.locator('[data-owner-id]').all()) {
      await expect(owner).toHaveAttribute('data-ready', 'true');
    }
    await expect(frame.locator('plp-astro-preview astro-island[ssr]')).toHaveCount(0);
    // No second editor message and no fabricated Astro lifecycle event.
    await expect(frame.getByTestId('owner-title')).toHaveText([titles.at(-1)!, titles.at(-1)!]);
    const observed = await readReactOwners(frame);
    expect(observed.updates.map((value) => value.revision)).toEqual([titles.length, titles.length]);
    expect(
      observed.lifecycle.filter((value) => value.phase === 'commit').map((value) => value.revision),
    ).toEqual([titles.length, titles.length]);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
}

test('replays the pre-hydration snapshot without fragment work', async ({ page }) => {
  await verifyPreHydration(page, false);
});
test('replays the pre-hydration snapshot with fragment work', async ({ page }) => {
  await verifyPreHydration(page, true);
});

test('commits only the latest of multiple revisions before native hydration', async ({ page }) => {
  await verifyPreHydration(page, true, [
    'Superseded while downloading',
    'Latest before hydration 🦊',
  ]);
});

test('cancels asynchronous React work when a newer revision arrives', async ({ page }) => {
  const frame = await openResourcePreview(fixture, page, 'a', 'de');
  for (const owner of await frame.locator('[data-owner-id]').all()) {
    await expect(owner).toHaveAttribute('data-ready', 'true');
  }
  await sendOwnerRevision(fixture, page, 'a', 'de', {
    title: 'Obsolete slow work',
    ownerDelayMs: 1000,
  });
  for (const owner of await frame.locator('[data-owner-id]').all()) {
    await expect(owner).toHaveAttribute('data-pending', '1');
  }
  await sendOwnerRevision(fixture, page, 'a', 'de', { title: 'Current React revision 🦊' });
  await expect(frame.getByTestId('owner-title')).toHaveText([
    'Current React revision 🦊',
    'Current React revision 🦊',
  ]);
  // A negative check beyond the fixture's fixed formatter deadline, never a
  // readiness signal or the positive rendering assertion.
  await frame.waitForTimeout(1100);
  const observed = await readReactOwners(frame);
  expect(
    observed.lifecycle.filter((value) => value.phase === 'abort').map((value) => value.revision),
  ).toEqual([1, 1]);
  expect(
    observed.lifecycle.filter((value) => value.phase === 'commit').map((value) => value.revision),
  ).toEqual([2, 2]);
  expect(observed.updates.map((value) => value.revision)).toEqual([1, 1, 2, 2]);
  expect(observed.owners.map((value) => value.pending)).toEqual(['0', '0']);
});

test('keeps native React state on moves, aborts detach and disposes on router navigation', async ({
  page,
}) => {
  const frame = await openResourcePreview(fixture, page, 'a', 'de');
  await sendOwnerRevision(fixture, page, 'a', 'de', { title: 'Last committed' });
  await expect(frame.getByTestId('owner-title')).toHaveText(['Last committed', 'Last committed']);
  for (const button of await frame.getByTestId('owner-counter').all()) await button.click();
  const owner = await frame.locator('plp-astro-preview').elementHandle();
  const links = await frame
    .locator('link[rel="stylesheet"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  const build = JSON.parse(await readFile(resolve(artifact, 'build.json'), 'utf8')) as {
    catalogStylesheets: string[];
  };
  const reactLinks = await frame.evaluate(() =>
    Array.from(document.styleSheets)
      .filter((sheet) =>
        Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('.react-panel')),
      )
      .map((sheet) => new URL(sheet.href!).pathname),
  );
  expect(reactLinks).toHaveLength(1);
  expect(build.catalogStylesheets).toHaveLength(1);
  const ownedLinks = [
    ...reactLinks,
    ...build.catalogStylesheets.map((path) => path.replace('dist/client', '')),
  ];
  for (const href of ownedLinks) expect(links.filter((link) => link === href)).toHaveLength(1);
  await owner.evaluate((element) => {
    element.remove();
    document.body.append(element);
  });
  expect(
    (await readReactOwners(frame)).lifecycle.filter((value) => value.phase === 'detach'),
  ).toEqual([]);
  await expect(frame.getByTestId('owner-counter')).toHaveText(['1', '1']);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waiting = 0;
  let aborted = 0;
  let settled = 0;
  page.on('requestfailed', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/payload/resource-fragment')) {
      const body = request.postDataJSON() as { fields: { title: string } };
      if (body.fields.title === 'Detached slow revision') aborted++;
    }
  });
  await page.route('**/payload/resource-fragment', async (route) => {
    const response = await route.fetch();
    const body = route.request().postDataJSON() as { fields: { title: string } };
    if (body.fields.title === 'Detached slow revision') {
      waiting++;
      await held;
    }
    await route.fulfill({ response }).catch((error: unknown) => {
      if (!route.request().failure()) throw error;
    });
    if (body.fields.title === 'Detached slow revision') settled++;
  });
  try {
    await sendOwnerRevision(fixture, page, 'a', 'de', {
      title: 'Detached slow revision',
      ownerDelayMs: 1000,
    });
    for (const element of await frame.locator('[data-owner-id]').all()) {
      await expect(element).toHaveAttribute('data-pending', '2');
    }
    await expect.poll(() => waiting).toBe(2);
    await owner.evaluate((element) => element.remove());
    expect(await owner.evaluate((element) => element.getAttribute('data-stopped'))).toBe('true');
    expect(
      (await readReactOwners(frame)).lifecycle
        .filter((value) => value.phase === 'abort')
        .map((value) => value.revision),
    ).toEqual([2, 2]);
    expect(
      await frame
        .locator('link[rel="stylesheet"]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('href'))),
    ).toEqual(links);
    await frame.evaluate(() => {
      Reflect.set(
        window,
        'stoppedMessage',
        new Promise<void>((resolve) =>
          window.addEventListener('message', () => queueMicrotask(resolve), { once: true }),
        ),
      );
    });
    await sendOwnerRevision(fixture, page, 'a', 'de', { title: 'Ignored while stopped' });
    await frame.evaluate(async () => {
      await Reflect.get(window, 'stoppedMessage');
    });
    await owner.evaluate((element) => document.body.append(element));
    await expect(frame.getByTestId('owner-counter')).toHaveText(['1', '1']);
    expect(
      (await readReactOwners(frame)).lifecycle
        .filter((value) => value.phase === 'receive')
        .map((value) => value.revision),
    ).toEqual([1, 1, 2, 2]);
    await sendOwnerRevision(fixture, page, 'a', 'de', { title: 'New owner epoch' });
    await expect(frame.getByTestId('owner-title')).toHaveText([
      'New owner epoch',
      'New owner epoch',
    ]);
    await expect(frame.getByTestId('renders')).toHaveText('2');
    release();
    // Playwright's wait-mode unroute can capture a cancelled handler before
    // fulfill reports its failure. Observe actual settlement before teardown.
    await expect.poll(() => settled).toBe(2);
    await page.unrouteAll({ behavior: 'wait' });
    await expect.poll(() => aborted).toBe(2);
    await frame.waitForTimeout(1100);
    expect(
      (await readReactOwners(frame)).lifecycle
        .filter((value) => value.phase === 'commit')
        .map((value) => value.revision),
    ).toEqual([1, 1, 1, 1]);
    await sendOwnerRevision(fixture, page, 'a', 'de', {
      title: 'Navigation pending',
      ownerDelayMs: 1000,
    });
    for (const element of await frame.locator('[data-owner-id]').all()) {
      await expect(element).toHaveAttribute('data-pending', '2');
    }
    await frame.evaluate(() => {
      Reflect.set(window, 'sameOwnerDocument', true);
    });
    await frame.getByTestId('navigation').click();
    await frame.waitForURL(fixture.origin + '/');
    expect(
      await frame.evaluate(() => Reflect.get(window, 'sameOwnerDocument') as boolean | undefined),
    ).toBe(true);
    await expect
      .poll(
        async () =>
          (await readReactOwners(frame)).lifecycle.filter((value) => value.phase === 'unmount')
            .length,
      )
      .toBe(2);
    expect(await owner.evaluate((element) => element.getAttribute('data-stopped'))).toBe('true');
    await expect(frame.locator('plp-astro-preview')).toHaveCount(0);
    const afterLinks = await frame
      .locator('link[rel="stylesheet"]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
    // Shared ClientRouter CSS remains owned by the destination page.
    for (const href of ownedLinks) expect(afterLinks).not.toContain(href);
    await frame.waitForTimeout(1100);
    const observed = await readReactOwners(frame);
    expect(
      observed.lifecycle.filter((value) => value.phase === 'abort').map((value) => value.revision),
    ).toEqual([2, 2, 2, 2]);
    expect(
      observed.lifecycle.filter((value) => value.phase === 'commit').map((value) => value.revision),
    ).toEqual([1, 1, 1, 1]);
    await writeFile(
      resolve(artifact, 'owner-lifetime.json'),
      JSON.stringify(
        { waiting, aborted, settled, links, ownedLinks, afterLinks, ...observed },
        null,
        2,
      ),
    );
  } finally {
    release();
    // A failing assertion must still release the test-owned transport barrier.
    if (waiting > 0) await expect.poll(() => settled).toBe(waiting);
    await page.unrouteAll({ behavior: 'wait' });
    await owner.dispose();
  }
});

test('keeps concurrent providers immutable and refuses foreign snapshot scope', async ({
  page,
  browser,
}) => {
  const other = await browser.newContext({ baseURL: fixture.origin, ignoreHTTPSErrors: true });
  try {
    const pageB = await other.newPage();
    pageB.on('pageerror', () => {
      pageErrors++;
    });
    await observeReactOwners(pageB);
    const [frameA, frameB] = await Promise.all([
      openResourcePreview(fixture, page, 'a', 'de'),
      openResourcePreview(fixture, pageB, 'b', 'en'),
    ]);
    await Promise.all([
      sendOwnerRevision(fixture, page, 'a', 'de', {
        title: 'User A 🦊',
        ownerDelayMs: 1000,
        authority: { subject: 'forged', locale: 'en', path: '/forged' },
        module: '/untrusted.js',
        resource: '/untrusted.css',
      }),
      sendOwnerRevision(fixture, pageB, 'b', 'en', { title: 'User B α' }),
    ]);
    for (const [frame, editor, locale, title] of [
      [frameA, 'a', 'de', 'User A 🦊'],
      [frameB, 'b', 'en', 'User B α'],
    ] as const) {
      await expect(frame.getByTestId('owner-title')).toHaveText([title, title]);
      for (const card of await frame.getByTestId('owner-card').all()) {
        await expect(card).toHaveAttribute('data-provider-locale', locale);
        await expect(card).toHaveAttribute(
          'data-provider-subject',
          String(fixture.backend.ids['user-' + editor]),
        );
        await expect(card).toHaveAttribute(
          'data-provider-path',
          '/continuation/' + editor + '/' + locale,
        );
      }
    }
    const requestsBefore = fixture.backend.requests.length;
    for (const [editor, locale] of [
      ['b', 'de'],
      ['a', 'en'],
    ] as const) {
      await frameA.evaluate(() => {
        Reflect.set(
          window,
          'scopeMessage',
          new Promise<void>((resolve) =>
            window.addEventListener('message', () => queueMicrotask(resolve), { once: true }),
          ),
        );
      });
      await sendOwnerRevision(fixture, page, editor, locale, { title: 'Must not render' });
      await frameA.evaluate(async () => {
        await Reflect.get(window, 'scopeMessage');
      });
    }
    await expect(frameA.getByTestId('owner-title')).toHaveText(['User A 🦊', 'User A 🦊']);
    const [a, b] = await Promise.all([readReactOwners(frameA), readReactOwners(frameB)]);
    expect(a.updates.map((value) => value.title)).toEqual(['User A 🦊', 'User A 🦊']);
    expect(b.updates.map((value) => value.title)).toEqual(['User B α', 'User B α']);
    expect(a.violations).toEqual([]);
    expect(b.violations).toEqual([]);
    expect(fixture.backend.requests.length).toBe(requestsBefore);
    await expect(frameA.locator('[src="/untrusted.js"], [href="/untrusted.css"]')).toHaveCount(0);
    await writeFile(
      resolve(artifact, 'owner-scope.json'),
      JSON.stringify(
        { a, b, requestsBefore, requestsAfter: fixture.backend.requests.length },
        null,
        2,
      ),
    );
  } finally {
    await other.close();
  }
});
