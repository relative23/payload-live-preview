/**
 * End-to-end tests for the documented Next.js (App Router) wiring.
 *
 * The fixture is `examples/nextjs-payload`: the root layout renders
 * `<LivePreviewScript />`, the async server component that waits for
 * `authorizePreview` before it renders anything — the pattern
 * docs/nextjs.md documents (no middleware injection). The static mock
 * admin at `/admin.html` enters through `/preview-session`, which mints
 * the signed token the layout verifies, and posts `payload-live-preview`
 * messages on form input, mirroring the Astro fixture.
 *
 * URLs are absolute on purpose: the Playwright `baseURL` points at
 * the Astro example, and this spec must not depend on it.
 */
import { expect, test } from '@playwright/test';
import {
  acceptedRevisions,
  countReadyHandshakes,
  installNavigationProbe,
  NEXT_ORIGIN,
  readNavigationProbe,
  requirePreviewFrame,
  waitForPreviewFrame,
  waitForStartupReadies,
} from '../helpers/preview';

const ADMIN_URL = `${NEXT_ORIGIN}/admin.html`;
/** The base path the app is served under, empty at the site root. */
const BASE = new URL(NEXT_ORIGIN).pathname.replace(/\/$/u, '');

interface HydrationApi {
  inspect: () => { hydration: { mode: string; state: string } };
}

interface RouteCommitApi {
  inspect: () => { revisions: { accepted: number }; route: { refreshes: number; partial: number } };
}

test.describe('live preview (Next.js) — admin → iframe updates', () => {
  test('updating the title field in the admin updates the preview iframe', async ({ page }) => {
    await page.goto(ADMIN_URL);

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();

    await page.getByTestId('title-input').fill('Brand new title');
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText('Brand new title');
  });

  test('updating the subtitle updates the preview', async ({ page }) => {
    await page.goto(ADMIN_URL);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('subtitle-input').fill('Watch this update live.');
    await expect(preview.locator('[data-payload-field="subtitle"]')).toHaveText(
      'Watch this update live.',
    );
  });

  test('XSS attempt in title is rendered as plain text', async ({ page }) => {
    await page.goto(ADMIN_URL);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('title-input').fill('<script>window.__pwned=true</script>OK');
    await expect(preview.locator('[data-payload-field="title"]')).toContainText('<script>');
    const pwned = await preview.locator('html').evaluate(() => {
      const win = window as unknown as { __pwned?: boolean };
      return win.__pwned === true;
    });
    expect(pwned).toBe(false);
  });

  test('reapplies an unsaved revision only after the App Router commit', async ({ page }) => {
    await page.goto(`${ADMIN_URL}?target=/route-commit`);
    const frame = await waitForPreviewFrame(page, '/route-commit');
    const generation = frame.getByTestId('server-generation');
    await expect(generation).toBeVisible();
    const before = await generation.textContent();
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            typeof (window as Window & { __livePreviewRouteRefresh?: unknown })
              .__livePreviewRouteRefresh,
        ),
      )
      .toBe('function');
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (window as Window & { __livePreview?: RouteCommitApi }).__livePreview?.inspect()
              .revisions.accepted ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await page.getByTestId('title-input').fill('Unsaved after the router commit');
    await page.getByTestId('show-extra-input').check();
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (window as Window & { __livePreview?: RouteCommitApi }).__livePreview?.inspect().route
              .refreshes ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (window as Window & { __livePreview?: RouteCommitApi }).__livePreview?.inspect().route
              .partial ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await expect(generation).not.toHaveText(before ?? '');
    await expect(frame.locator('[data-payload-field="title"]')).toHaveText(
      'Unsaved after the router commit',
    );
  });

  test('locally reapplies one unchanged unsaved document after each committed App Router navigation', async ({
    page,
  }) => {
    await countReadyHandshakes(page);
    await page.goto(`${ADMIN_URL}?target=/soft-navigation/one`);
    const frame = await waitForPreviewFrame(page, '/soft-navigation/one');
    const title = frame.locator('[data-payload-field="title"]');
    await expect(title).toBeVisible();
    await waitForStartupReadies(page);
    await installNavigationProbe(page);

    await page.getByTestId('title-input').fill('Unsaved across Next navigation');
    await expect(title).toHaveText('Unsaved across Next navigation');
    await expect.poll(async () => (await readNavigationProbe(page)).documents.length).toBe(1);
    const accepted = await acceptedRevisions(frame);
    const firstGeneration = await frame.getByTestId('navigation-generation').textContent();

    await frame.getByTestId('navigate-two').click();
    await expect.poll(() => new URL(frame.url()).pathname).toBe(`${BASE}/soft-navigation/two`);
    await expect(frame.getByTestId('navigation-generation')).not.toHaveText(firstGeneration ?? '');
    await expect(title).toHaveText('Unsaved across Next navigation');
    await expect.poll(async () => (await readNavigationProbe(page)).events).toBe(1);
    await expect.poll(async () => (await readNavigationProbe(page)).ready).toBe(1);
    const firstReplay = await readNavigationProbe(page);
    expect(firstReplay.documents).toHaveLength(1);
    expect(firstReplay.titles).toContain('Server title for two');
    expect(await acceptedRevisions(frame)).toBe(accepted);

    await frame.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="navigate-slow"]')?.click();
      document.querySelector<HTMLElement>('[data-testid="navigate-final"]')?.click();
    });
    await expect.poll(() => new URL(frame.url()).pathname).toBe(`${BASE}/soft-navigation/final`);
    await expect(title).toHaveText('Unsaved across Next navigation');
    await expect.poll(async () => (await readNavigationProbe(page)).events).toBe(2);
    await expect.poll(async () => (await readNavigationProbe(page)).ready).toBe(2);
    await page.waitForTimeout(1_000);
    const rapidReplay = await readNavigationProbe(page);
    expect(rapidReplay.documents).toHaveLength(1);
    expect(rapidReplay.titles).toContain('Server title for final');
    expect(rapidReplay.titles).not.toContain('Server title for slow');
    expect(await acceptedRevisions(frame)).toBe(accepted);

    await frame.getByTestId('navigate-off').click();
    await expect.poll(() => new URL(frame.url()).pathname).toBe(BASE === '' ? '/' : BASE);
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

  test('reapplies the retained document when a streamed App Router binding arrives', async ({
    page,
  }) => {
    await page.goto(`${ADMIN_URL}?target=/soft-navigation/one`);
    const frame = await waitForPreviewFrame(page, '/soft-navigation/one');
    const title = frame.locator('[data-payload-field="title"]');
    await expect(title).toHaveText('Hello from the demo');
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            typeof (window as Window & { __livePreviewRouteRefresh?: unknown })
              .__livePreviewRouteRefresh,
        ),
      )
      .toBe('function');
    await installNavigationProbe(page);

    await page.getByTestId('title-input').fill('Unsaved across a streamed Next destination');
    await expect(title).toHaveText('Unsaved across a streamed Next destination');
    await expect.poll(async () => (await readNavigationProbe(page)).documents.length).toBe(1);
    const accepted = await acceptedRevisions(frame);

    // Dispatch in the frame so WebKit cannot keep Playwright's action promise
    // open until the RSC response has finished. The trace below, rather than
    // Next's optional transient fallback, proves the late server binding was
    // inserted and then received the retained unsaved value.
    await frame.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="navigate-slow"]')?.click();
    });
    await expect.poll(() => new URL(frame.url()).pathname).toBe(`${BASE}/soft-navigation/slow`);
    await expect.poll(async () => (await readNavigationProbe(page)).events).toBe(1);
    await expect(title).toHaveText('Unsaved across a streamed Next destination');

    await page.waitForTimeout(250);
    const replay = await readNavigationProbe(page);
    expect(replay.documents).toHaveLength(1);
    expect(replay.titles).toContain('Server title for slow');
    expect(await acceptedRevisions(frame)).toBe(accepted);
  });
});

test.describe('live preview (Next.js) — origin enforcement', () => {
  test('messages from an untrusted origin are ignored', async ({ page }) => {
    // Through the entry route, so the page is one an editor could be
    // looking at: without the cookie it minted the layout renders no
    // runtime at all, and "the message changed nothing" would be true
    // for a reason that has nothing to do with origins.
    await page.goto(`${NEXT_ORIGIN}/preview-session?to=%2F`);
    // Mimic a malicious page that tries to drive the preview. Loaded
    // top-level (not framed by the admin) the runtime never boots, so
    // the safest assertion — same as the Astro spec — is that the
    // message simply does not change the DOM.
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
 * ADR 0015. Measured 2026-09-11 before the guard existed: the mock admin
 * answers `ready` at once, the runtime wrote the document 81 ms before React
 * hydrated the page, React threw `Hydration failed because the server rendered
 * text didn't match the client` and regenerated the tree — the write was gone
 * until the admin's next message. Once per framed load of `/`, four times per
 * Chromium run, and no spec listened to `pageerror`, so the suite was green.
 */
test.describe('live preview (Next.js) — the first message and React', () => {
  test('the first write lands after hydration, so React finds the markup it rendered', async ({
    page,
  }) => {
    // The dev server compiles `/` and its client chunk on first request; the
    // first load warms it so the measured load below is the page as served.
    await page.goto(ADMIN_URL);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();

    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });
    await page.goto(ADMIN_URL);
    // The admin's document differs from the server's markup in `hero.alt`
    // ("Hero image" against "Mountains at dusk"), so a write that landed
    // shows here — and so would a regeneration that took it back.
    await expect(preview.locator('[data-payload-field="hero"]')).toHaveAttribute(
      'alt',
      'Hero image',
    );
    // Long enough for a regeneration to have happened and been reported;
    // measured, the error came 87 ms after the write.
    await page.waitForTimeout(500);
    expect(errors.filter((message) => message.includes('Hydration failed'))).toEqual([]);
    expect(errors).toEqual([]);
    await expect(preview.locator('[data-payload-field="hero"]')).toHaveAttribute(
      'alt',
      'Hero image',
    );
    const frame = requirePreviewFrame(page);
    const hydration = await frame.evaluate(
      () =>
        (window as Window & { __livePreview?: HydrationApi }).__livePreview?.inspect().hydration,
    );
    expect(hydration).toEqual({ mode: 'react', state: 'committed' });
  });
});
