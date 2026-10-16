/**
 * Native Astro client directives must prove interaction independently of SSR.
 * Bounded observations survive failed assertions without exposing credentials.
 * The unmet interactive fragment contract remains an actual failing test.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { startNativeContinuation } from '../helpers/native-continuation';
import { openResourcePreview, sendResourceRevision } from '../helpers/astro-resource-browser';

let fixture: Awaited<ReturnType<typeof startNativeContinuation>>;
let artifact: string;
let closeFixture: (() => Promise<void>) | undefined;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    const lifetime: unknown[] = [];
    Object.assign(window, { resourceCspViolations: violations, islandLifetime: lifetime });
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(event.violatedDirective),
    );
    window.addEventListener('plp:test:react-lifecycle', (event) => {
      if (lifetime.length < 100) lifetime.push((event as CustomEvent).detail);
    });
    Reflect.set(window, 'islandBootstrapLoads', 0);
    window.addEventListener('astro:load', () => {
      Reflect.set(
        window,
        'islandBootstrapLoads',
        Number(Reflect.get(window, 'islandBootstrapLoads')) + 1,
      );
    });
  });
});

test('commits interactive native React islands for consecutive unsaved revisions', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message.includes('module') ? 'module-resolution' : 'other');
  });
  const frame = await openResourcePreview(fixture, page, 'a', 'de');
  await frame.evaluate(() => {
    const original = window.fetch.bind(window);
    const records: unknown[] = [];
    Object.assign(window, { islandResponses: records });
    window.fetch = (input, init) => {
      const pending = original(input, init);
      if (
        input !== '/payload/resource-fragment' ||
        init?.method !== 'POST' ||
        records.length >= 5
      ) {
        return pending;
      }
      const record: Record<string, unknown> = { complete: false };
      records.push(record);
      void pending
        .then(async (response) => {
          const text = await response.clone().text();
          let html = '';
          try {
            html = (JSON.parse(text) as { html?: string }).html ?? '';
          } catch {
            /* A real non-JSON refusal is recorded by status. */
          }
          const document = new DOMParser().parseFromString(html, 'text/html');
          const scriptHashes = await Promise.all(
            Array.from(document.querySelectorAll('script'), async (script) => {
              const digest = await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(script.textContent),
              );
              return Array.from(new Uint8Array(digest), (byte) =>
                byte.toString(16).padStart(2, '0'),
              ).join('');
            }),
          );
          Object.assign(record, {
            complete: true,
            status: response.status,
            bytes: new TextEncoder().encode(text).length,
            scripts: document.querySelectorAll('script').length,
            scriptHashes,
            styles: document.querySelectorAll('style,link[rel="stylesheet"]').length,
            title: document.querySelector('[data-testid="react-title"]')?.textContent ?? null,
            islands: Array.from(document.querySelectorAll('astro-island'), (island) => ({
              component: island.getAttribute('component-url'),
              renderer: island.getAttribute('renderer-url'),
              directive: island.getAttribute('client'),
              awaiting: island.hasAttribute('ssr'),
            })),
          });
        })
        .catch(() => {
          Object.assign(record, { complete: true, aborted: true });
        });
      return pending;
    };
  });
  const revisions: unknown[] = [];
  try {
    const control = frame.getByTestId('react-control');
    await expect(control.getByTestId('react-panel')).toHaveAttribute('data-react-hydrated', 'true');
    await control.getByTestId('react-counter').click();
    for (const [index, title] of [
      'First unsaved native React',
      'Second unsaved native React',
    ].entries()) {
      await sendResourceRevision(fixture, page, 'a', 'de', title);
      await expect(frame.getByTestId('renders')).toHaveText(String((index + 1) * 2));
      const cards = frame.getByTestId('resource-card');
      await expect(cards).toHaveCount(2);
      await expect.soft(cards.getByTestId('react-title')).toHaveText([title, title]);
      await expect
        .soft(cards.getByTestId('react-derived'))
        .toHaveText(Array(2).fill(String(Array.from(title).length)));
      await expect.soft
        .poll(() =>
          cards
            .getByTestId('react-panel')
            .evaluateAll((elements) =>
              elements.map((element) => element.getAttribute('data-react-hydrated')),
            ),
        )
        .toEqual(['true', 'true']);
      for (const counter of await cards.getByTestId('react-counter').all()) await counter.click();
      await expect
        .soft(cards.getByTestId('react-counter'))
        .toHaveText([String(index + 1), String(index + 1)]);
      revisions.push(
        await cards.evaluateAll((elements) =>
          elements.map((element) => ({
            title: element.querySelector('[data-testid="react-title"]')?.textContent,
            outerTitle: element.querySelector('[data-testid="resource-title"]')?.textContent,
            derived: element.querySelector('[data-testid="react-derived"]')?.textContent,
            hydrated: element
              .querySelector('[data-testid="react-panel"]')
              ?.getAttribute('data-react-hydrated'),
            counter: element.querySelector('[data-testid="react-counter"]')?.textContent,
            awaiting: element.querySelectorAll('astro-island[ssr]').length,
          })),
        ),
      );
      await expect(control.getByTestId('react-counter')).toHaveText('1');
    }
  } finally {
    await writeFile(
      resolve(artifact, 'native-fragments.json'),
      JSON.stringify(
        {
          revisions,
          errors,
          contentWrites: fixture.backend.writes(),
          responses: await frame.evaluate(
            () => Reflect.get(window, 'islandResponses') as unknown[],
          ),
          lifetime: await frame.evaluate(() => Reflect.get(window, 'islandLifetime') as unknown[]),
          violations: await frame.evaluate(
            () => Reflect.get(window, 'resourceCspViolations') as string[],
          ),
          bootstrapLoads: await frame.evaluate(
            () => Reflect.get(window, 'islandBootstrapLoads') as number,
          ),
        },
        null,
        2,
      ),
    );
  }
});
test.beforeAll(async ({ browser, browserName }, info) => {
  test.setTimeout(240_000);
  expect(process.env['PLP_ASTRO_RESOURCE_RENDERER']).toBe('react-islands');
  artifact = resolve(
    'test-results/hardening/h05-astro-islands/native',
    process.env['PLP_HOST_RUN'] ?? 'native-first',
    browserName,
    'worker-' + String(info.workerIndex),
  );
  fixture = await startNativeContinuation(artifact, 'astro', false, 'astro-resources');
  closeFixture = fixture.close;
  const inspection = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const response = await inspection.request.get(fixture.origin + '/island-csp-probe');
    expect(response.status()).toBe(200);
    // This fixed prerendered page has no request, CMS or authorization data.
    await writeFile(resolve(artifact, 'fixed-build-probe.html'), await response.text());
  } finally {
    await inspection.close();
  }
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

test('hydrates the native client:load page control under the declared CSP', async ({ page }) => {
  const frame = await openResourcePreview(fixture, page, 'a', 'de');
  const control = frame.getByTestId('react-control');
  try {
    await expect(control.getByTestId('react-panel')).toHaveAttribute('data-react-hydrated', 'true');
    await control.getByTestId('react-counter').click();
    await expect(control.getByTestId('react-counter')).toHaveText('1');
    expect(
      await frame.evaluate(() => Reflect.get(window, 'resourceCspViolations') as string[]),
    ).toEqual([]);
  } finally {
    await writeFile(
      resolve(artifact, 'native-control.json'),
      JSON.stringify(
        {
          hydrated: await control.getByTestId('react-panel').getAttribute('data-react-hydrated'),
          counter: await control.getByTestId('react-counter').textContent(),
          islands: await control.locator('astro-island').count(),
          awaiting: await control.locator('astro-island[ssr]').count(),
          violations: await frame.evaluate(
            () => Reflect.get(window, 'resourceCspViolations') as string[],
          ),
          contentWrites: fixture.backend.writes(),
        },
        null,
        2,
      ),
    );
  }
});

test('blocks unlisted inline script and style while the native control remains live', async ({
  page,
}) => {
  const frame = await openResourcePreview(fixture, page, 'a', 'de');
  const panel = frame.getByTestId('react-control').getByTestId('react-panel');
  await expect(panel).toHaveAttribute('data-react-hydrated', 'true');
  expect(
    await frame.evaluate(() => Reflect.get(window, 'resourceCspViolations') as string[]),
  ).toEqual([]);
  const before = await panel.evaluate((element) => getComputedStyle(element).paddingLeft);
  await frame.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.unlistedInlineExecuted = true';
    const style = document.createElement('style');
    style.textContent = '[data-testid="react-panel"]{padding-left:123px!important}';
    document.head.append(script, style);
  });
  await expect
    .poll(() =>
      frame.evaluate(() => [...(Reflect.get(window, 'resourceCspViolations') as string[])].sort()),
    )
    .toEqual(['script-src-elem', 'style-src-elem']);
  expect(
    await frame.evaluate(
      () => Reflect.get(window, 'unlistedInlineExecuted') as boolean | undefined,
    ),
  ).toBeUndefined();
  expect(await panel.evaluate((element) => getComputedStyle(element).paddingLeft)).toBe(before);
  await panel.getByTestId('react-counter').click();
  await expect(panel.getByTestId('react-counter')).toHaveText('1');
  await writeFile(
    resolve(artifact, 'csp-countercheck.json'),
    JSON.stringify(
      {
        unlistedScriptExecuted: false,
        paddingBefore: before,
        paddingAfter: await panel.evaluate((element) => getComputedStyle(element).paddingLeft),
        nativeCounter: 1,
        violations: await frame.evaluate(
          () => Reflect.get(window, 'resourceCspViolations') as string[],
        ),
        contentWrites: fixture.backend.writes(),
      },
      null,
      2,
    ),
  );
});

test('aborts both fragment owners, remounts and unmounts the native React control on soft navigation', async ({
  page,
}) => {
  const frame = await openResourcePreview(fixture, page, 'a', 'de');
  const control = frame.getByTestId('react-control');
  await expect(control.getByTestId('react-panel')).toHaveAttribute('data-react-hydrated', 'true');
  await control.getByTestId('react-counter').click();
  const owner = await frame.locator('plp-astro-preview').elementHandle();
  const reactIsland = await control.locator('astro-island').elementHandle();
  const styles = await frame
    .locator('link[rel="stylesheet"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  let entered!: () => void;
  let release!: () => void;
  const pending = new Promise<void>((yes) => {
    entered = yes;
  });
  const held = new Promise<void>((yes) => {
    release = yes;
  });
  let waiting = 0;
  let aborted = 0;
  const titles: string[] = [];
  page.on('requestfailed', (request) => {
    if (
      request.url().endsWith('/payload/resource-fragment') &&
      request.method() === 'POST' &&
      (request.postDataJSON() as { fields: { title: string } }).fields.title ===
        'Held native revision'
    ) {
      aborted++;
    }
  });
  await page.route('**/payload/resource-fragment', async (route) => {
    const title = (route.request().postDataJSON() as { fields: { title: string } }).fields.title;
    titles.push(title);
    const response = await route.fetch();
    if (title === 'Held native revision') {
      if (++waiting === 2) entered();
      await held;
    }
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await sendResourceRevision(fixture, page, 'a', 'de', 'Held native revision');
    await pending;
    await owner.evaluate((element) => element.remove());
    expect(await owner.getAttribute('data-stopped')).toBe('true');
    await expect(control.getByTestId('react-counter')).toHaveText('1');
    await owner.evaluate((element) => document.body.appendChild(element));
    // A real later empty revision must commit; the held island never acquires
    // ownership. This does not stand in for fragment React hydration.
    await page.evaluate(
      (id) =>
        document.querySelector<HTMLIFrameElement>('#preview')!.contentWindow!.postMessage(
          {
            type: 'payload-live-preview',
            collectionSlug: 'articles',
            locale: 'de',
            data: { id, show: false, title: 'Empty after remount', delayMs: 0 },
          },
          location.origin,
        ),
      Number(fixture.backend.ids['article-a']),
    );
    await expect(frame.getByTestId('renders')).toHaveText('2');
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect.poll(() => aborted).toBe(2);
    await expect(frame.getByTestId('resource-card')).toHaveCount(0);
    expect(titles).toEqual([
      'Held native revision',
      'Held native revision',
      'Empty after remount',
      'Empty after remount',
    ]);
    expect(
      await frame
        .locator('link[rel="stylesheet"]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('href'))),
    ).toEqual(styles);
    await expect(control.getByTestId('react-counter')).toHaveText('1');
    await frame.evaluate(() => {
      Reflect.set(window, 'nativeIslandDocumentMarker', true);
    });
    await frame.getByTestId('navigation').click();
    await frame.waitForURL(fixture.origin + '/');
    expect(
      await frame.evaluate(
        () => Reflect.get(window, 'nativeIslandDocumentMarker') as boolean | undefined,
      ),
    ).toBe(true);
    expect(await owner.getAttribute('data-stopped')).toBe('true');
    await expect
      .poll(() => frame.evaluate(() => Reflect.get(window, 'islandLifetime') as unknown[]))
      .toEqual([
        { phase: 'mount', title: 'Native Astro React control' },
        { phase: 'unmount', title: 'Native Astro React control' },
      ]);
    expect(
      await reactIsland.evaluate(
        (element) => element.querySelector('[data-testid="react-panel"]') === null,
      ),
    ).toBe(true);
    expect(
      await frame.evaluate(() => Reflect.get(window, 'resourceCspViolations') as string[]),
    ).toEqual([]);
    await writeFile(
      resolve(artifact, 'native-lifetime.json'),
      JSON.stringify(
        {
          held: waiting,
          aborted,
          remountedBoundaryRenders: 2,
          contentWrites: fixture.backend.writes(),
          retainedControlCount: 1,
          nativeNavigationSameDocument: true,
          reactEffectUnmounted: true,
          removedRootEmpty: true,
          pageResourcesRetainedDuringRemount: true,
          titles,
          lifetime: await frame.evaluate(() => Reflect.get(window, 'islandLifetime') as unknown[]),
          violations: await frame.evaluate(
            () => Reflect.get(window, 'resourceCspViolations') as string[],
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await owner.dispose();
    await reactIsland.dispose();
  }
});
