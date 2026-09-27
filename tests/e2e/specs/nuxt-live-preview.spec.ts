/**
 * End-to-end tests for the Nuxt adapter (`livePreviewNitroPlugin`).
 *
 * The fixture is the Nuxt example under `examples/nuxt-payload`, expected to
 * be running on port 4176 (`npm --prefix examples/nuxt-payload run dev`). The
 * static `/admin.html` page emulates the Payload admin: it embeds `/` in an
 * iframe and posts updates whenever the form changes. Because the iframe load
 * carries `Sec-Fetch-Dest: iframe`, the plugin's default `'preview-only'`
 * injection kicks in — so a passing suite also proves preview gating, not just
 * DOM patching.
 *
 * URLs are absolute on purpose: the repo-level Playwright `baseURL` points at
 * the Astro example (port 4173), and this spec must not depend on it.
 */
import { expect, test, type Frame, type Page } from '@playwright/test';
import {
  acceptedRevisions,
  installNavigationProbe,
  readNavigationProbe,
  requirePreviewFrame,
  waitForPreviewFrame,
  waitForStarted,
} from '../helpers/preview';

const APP = 'http://localhost:4176';

interface HydrationApi {
  inspect: () => { hydration: { mode: string; state: string } };
}

type ProbedWindow = Window & {
  __altChanges?: string[];
  __livePreview?: HydrationApi;
  /** Nuxt's own flag, cleared when the root Suspense has resolved — the moment Vue's repairs are in. */
  useNuxtApp?: () => { isHydrating: boolean };
};

async function hydrated(page: Page): Promise<Frame> {
  const frame = requirePreviewFrame(page);
  await frame.waitForFunction(() => (window as ProbedWindow).useNuxtApp?.().isHydrating === false);
  return frame;
}

test.describe('nuxt live preview — admin → iframe updates', () => {
  test('updating the title field in the admin updates the preview iframe', async ({ page }) => {
    await page.goto(`${APP}/admin.html`);

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();

    await page.getByTestId('title-input').fill('Brand new title');
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText('Brand new title');
  });

  test('updating the subtitle updates the preview', async ({ page }) => {
    await page.goto(`${APP}/admin.html`);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('subtitle-input').fill('Watch this update live.');
    await expect(preview.locator('[data-payload-field="subtitle"]')).toHaveText(
      'Watch this update live.',
    );
  });

  test('XSS attempt in title is rendered as plain text', async ({ page }) => {
    await page.goto(`${APP}/admin.html`);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('title-input').fill('<script>window.__pwned=true</script>OK');
    await expect(preview.locator('[data-payload-field="title"]')).toContainText('<script>');
    const pwned = await preview.locator('html').evaluate(() => {
      const win = window as unknown as { __pwned?: boolean };
      return win.__pwned === true;
    });
    expect(pwned).toBe(false);
  });

  test('locally reapplies one unchanged unsaved document after each committed route', async ({
    page,
  }) => {
    await page.goto(`${APP}/admin.html?target=/navigation`);
    const frame = await waitForPreviewFrame(page, '/navigation');
    const title = frame.locator('[data-payload-field="title"]');
    await expect(title).toBeVisible();
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            typeof (window as Window & { __livePreviewRouteRefresh?: unknown })
              .__livePreviewRouteRefresh,
        ),
      )
      .toBe('function');
    await page.waitForTimeout(2_100);
    await installNavigationProbe(page);

    await page.getByTestId('title-input').fill('Unsaved across Nuxt navigation');
    await expect(title).toHaveText('Unsaved across Nuxt navigation');
    await expect.poll(async () => (await readNavigationProbe(page)).documents.length).toBe(1);
    const accepted = await acceptedRevisions(frame);

    await frame.getByTestId('navigate-query').click();
    await expect.poll(() => new URL(frame.url()).search).toBe('?view=query');
    await expect.poll(async () => (await readNavigationProbe(page)).events).toBe(1);
    await expect.poll(async () => (await readNavigationProbe(page)).ready).toBe(1);
    const queryReplay = await readNavigationProbe(page);
    expect(queryReplay.documents).toHaveLength(1);
    expect(queryReplay.titles).toContain('Server title for one');
    expect(await acceptedRevisions(frame)).toBe(accepted);
    await expect(title).toHaveText('Unsaved across Nuxt navigation');

    await frame.getByTestId('navigate-two').click();
    await expect.poll(() => new URL(frame.url()).pathname).toBe('/navigation-two');
    await expect.poll(async () => (await readNavigationProbe(page)).events).toBe(2);
    await expect.poll(async () => (await readNavigationProbe(page)).ready).toBe(2);
    const firstReplay = await readNavigationProbe(page);
    expect(firstReplay.documents).toHaveLength(1);
    expect(firstReplay.titles).toContain('Server title for two');
    expect(await acceptedRevisions(frame)).toBe(accepted);
    await expect(title).toHaveText('Unsaved across Nuxt navigation');

    await frame.getByTestId('navigate-rapid').click();
    await expect.poll(() => new URL(frame.url()).pathname).toBe('/navigation-final');
    await expect.poll(async () => (await readNavigationProbe(page)).events).toBe(3);
    await expect.poll(async () => (await readNavigationProbe(page)).ready).toBe(3);
    await page.waitForTimeout(600);
    const rapidReplay = await readNavigationProbe(page);
    expect(rapidReplay.documents).toHaveLength(1);
    expect(rapidReplay.titles).toContain('Server title for final');
    expect(rapidReplay.titles).not.toContain('Server title for slow');
    expect(await acceptedRevisions(frame)).toBe(accepted);
    await expect(title).toHaveText('Unsaved across Nuxt navigation');

    await frame.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            typeof (window as Window & { __livePreviewRouteRefresh?: unknown })
              .__livePreviewRouteRefresh,
        ),
      )
      .toBe('undefined');
  });

  test('preserves query-carried preview intent and credentials across navigation', async ({
    page,
  }) => {
    // This v1-profile fixture treats the token as opaque. The contract here is
    // URL retention; signed-token authorization is covered by the strict suites.
    await page.goto(`${APP}/navigation?preview=true&previewToken=kept-for-navigation`);

    await page.getByTestId('navigate-query').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('query');
    expect(new URL(page.url()).searchParams.get('preview')).toBe('true');
    expect(new URL(page.url()).searchParams.get('previewToken')).toBe('kept-for-navigation');

    await page.getByTestId('navigate-two').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/navigation-two');
    expect(new URL(page.url()).searchParams.get('preview')).toBe('true');
    expect(new URL(page.url()).searchParams.get('previewToken')).toBe('kept-for-navigation');
    expect(new URL(page.url()).searchParams.get('view')).toBe('query');

    await page.getByTestId('navigate-rapid').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/navigation-final');
    expect(new URL(page.url()).searchParams.get('preview')).toBe('true');
    expect(new URL(page.url()).searchParams.get('previewToken')).toBe('kept-for-navigation');
    expect(new URL(page.url()).searchParams.get('view')).toBe('query');
  });

  test('awaits refreshNuxtData before reapplying the unsaved document', async ({ page }) => {
    await page.goto(`${APP}/admin.html?target=/navigation`);
    const frame = await waitForPreviewFrame(page, '/navigation');
    await waitForStarted(frame);
    const title = frame.locator('[data-payload-field="title"]');
    await expect(title).toHaveText('Hello from the demo');

    await page.getByTestId('title-input').fill('Unsaved across refreshNuxtData');
    await expect(title).toHaveText('Unsaved across refreshNuxtData');
    const generation = await frame.getByTestId('navigation-generation').textContent();

    // `subtitle` is intentionally absent from this route. The unbound edit
    // invokes the native refresh seam; the endpoint-backed generation proves
    // Nuxt settled new async data before the runtime reapplied this revision.
    await page.getByTestId('subtitle-input').fill('Unsaved and deliberately unbound');
    await expect(frame.getByTestId('navigation-generation')).not.toHaveText(generation ?? '');
    await expect(title).toHaveText('Unsaved across refreshNuxtData');
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (
              window as Window & {
                __livePreview?: {
                  inspect: () => { route: { refreshes: number; partial: number } };
                };
              }
            ).__livePreview?.inspect().route.refreshes ?? 0,
        ),
      )
      .toBe(1);
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (
              window as Window & {
                __livePreview?: { inspect: () => { route: { partial: number } } };
              }
            ).__livePreview?.inspect().route.partial ?? 0,
        ),
      )
      .toBe(1);
  });
});

test.describe('nuxt live preview — origin enforcement', () => {
  test('messages from an untrusted origin are ignored', async ({ page }) => {
    await page.goto(`${APP}/`);
    // Mimic a malicious page that tries to drive the preview. On a top-level
    // navigation the Nitro plugin does not inject the runtime (no preview
    // signal) and the runtime would refuse to start outside an iframe
    // anyway — the DOM must not change.
    await page.evaluate(() => {
      window.postMessage(
        {
          type: 'payload-live-preview',
          data: { title: 'attacker-controlled' },
        },
        '*',
      );
    });
    // Give the runtime time to (not) react.
    await page.waitForTimeout(150);
    await expect(page.locator('[data-payload-field="title"]')).not.toHaveText(
      'attacker-controlled',
    );
  });
});

/**
 * ADR 0015, addendum. Measured 2026-09-11 before the guard existed: the mock
 * admin answers `ready` at once, the runtime wrote the document at 25 ms, Vue
 * hydrated at 94 ms and repaired every written value back to the server's —
 * quietly, `Hydration completed but contains mismatches.` on the console and
 * no error — and what put the values right again was the admin answering the
 * runtime's second `ready` at 500 ms. A real admin answers `ready` once.
 */
test.describe('nuxt live preview — the first message and Vue', () => {
  test('the first write is not put back by hydration, so it stands without a second message', async ({
    page,
  }) => {
    // The dev server compiles `/` and its client chunks on first request; the
    // first load warms it, through to hydration, so the measured load below
    // is the page as served.
    await page.goto(`${APP}/admin.html`);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();
    await hydrated(page);

    // Every value `hero.alt` changes to, in order, seen from before the frame's
    // own scripts run: the admin's document says "Hero image" where the server
    // rendered "Mountains at dusk", so a write shows here — and so does a
    // repair that takes it back.
    await page.addInitScript(() => {
      if (window === window.top) return;
      const changes: string[] = [];
      (window as ProbedWindow).__altChanges = changes;
      // Firefox runs this once, on the frame's initial document, and keeps the
      // window when the real one replaces it — an observer attached here would
      // watch a document nothing writes to. So attach to whatever `document`
      // is now and again at DOMContentLoaded, once per document; the writes
      // this test records come after hydration, well after that event.
      const observed = new WeakSet<Document>();
      const attach = (): void => {
        if (observed.has(document)) return;
        observed.add(document);
        new MutationObserver((records) => {
          for (const record of records) {
            const target = record.target as Element;
            const value = target.getAttribute('alt') ?? '';
            if (target.getAttribute('data-payload-field') === 'hero' && value !== record.oldValue) {
              changes.push(value);
            }
          }
        }).observe(document, {
          subtree: true,
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ['alt'],
        });
      };
      attach();
      window.addEventListener('DOMContentLoaded', attach);
    });
    const mismatches: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('Hydration completed')) {
        mismatches.push(message.text());
      }
    });
    await page.goto(`${APP}/admin.html`);
    await expect(preview.locator('[data-payload-field="hero"]')).toHaveAttribute(
      'alt',
      'Hero image',
    );
    // Judged once Vue is through: the repair is made inside `hydrate()`, and
    // Nuxt clears `isHydrating` as it returns; one frame more for the observer.
    const frame = await hydrated(page);
    await page.waitForTimeout(100);
    expect(await frame.evaluate(() => (window as ProbedWindow).__altChanges)).toEqual([
      'Hero image',
    ]);
    expect(mismatches).toEqual([]);
    const hydration = await frame.evaluate(
      () => (window as ProbedWindow).__livePreview?.inspect().hydration,
    );
    expect(hydration).toEqual({ mode: 'vue', state: 'committed' });
  });
});
