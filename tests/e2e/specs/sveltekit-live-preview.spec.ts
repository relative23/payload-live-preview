/**
 * End-to-end tests for the SvelteKit adapter (`livePreviewHandle`).
 *
 * The fixture is the SvelteKit example under `examples/sveltekit-payload`,
 * expected at `PLP_SVELTE_ORIGIN`, or the development server on port 4175
 * when that variable is absent. The static `/admin.html` page
 * emulates the Payload admin: it embeds `/` in an iframe and posts
 * updates whenever the form changes. Because the iframe load carries
 * `Sec-Fetch-Dest: iframe`, the handle's default `'preview-only'`
 * injection kicks in — so a passing suite also proves preview gating,
 * not just DOM patching.
 *
 * URLs are absolute on purpose: the repo-level Playwright `baseURL`
 * points at the Astro example (port 4173), and this spec must not
 * depend on it.
 */
import { expect, test } from '@playwright/test';
import {
  acceptedRevisions,
  installNavigationProbe,
  readNavigationProbe,
  waitForPreviewFrame,
  waitForStarted,
} from '../helpers/preview';

const APP = process.env['PLP_SVELTE_ORIGIN'] ?? 'http://localhost:4175';

test.describe('sveltekit live preview — admin → iframe updates', () => {
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

  test('locally reapplies one unchanged unsaved document after each afterNavigate commit', async ({
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

    await page.getByTestId('title-input').fill('Unsaved across SvelteKit navigation');
    await expect(title).toHaveText('Unsaved across SvelteKit navigation');
    await expect.poll(async () => (await readNavigationProbe(page)).documents.length).toBe(1);
    const accepted = await acceptedRevisions(frame);

    await frame.getByTestId('navigate-two').click();
    await expect.poll(() => new URL(frame.url()).searchParams.get('step')).toBe('two');
    await expect.poll(async () => (await readNavigationProbe(page)).events).toBe(1);
    await expect.poll(async () => (await readNavigationProbe(page)).ready).toBe(1);
    const firstReplay = await readNavigationProbe(page);
    expect(firstReplay.documents).toHaveLength(1);
    expect(firstReplay.titles).toContain('Server title for two');
    expect(await acceptedRevisions(frame)).toBe(accepted);
    await expect(title).toHaveText('Unsaved across SvelteKit navigation');

    await frame.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="navigate-slow"]')?.click();
      document.querySelector<HTMLElement>('[data-testid="navigate-final"]')?.click();
    });
    await expect.poll(() => new URL(frame.url()).searchParams.get('step')).toBe('final');
    await expect.poll(async () => (await readNavigationProbe(page)).events).toBe(2);
    await expect.poll(async () => (await readNavigationProbe(page)).ready).toBe(2);
    await page.waitForTimeout(600);
    const rapidReplay = await readNavigationProbe(page);
    expect(rapidReplay.documents).toHaveLength(1);
    expect(rapidReplay.titles).toContain('Server title for final');
    expect(rapidReplay.titles).not.toContain('Server title for slow');
    expect(await acceptedRevisions(frame)).toBe(accepted);
    await expect(title).toHaveText('Unsaved across SvelteKit navigation');

    await frame.getByTestId('navigate-off').click();
    await expect.poll(() => new URL(frame.url()).searchParams.get('step')).toBe('off');
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

  test('reapplies the retained document when a streamed load binding arrives', async ({ page }) => {
    await page.goto(`${APP}/admin.html?target=/navigation`);
    const frame = await waitForPreviewFrame(page, '/navigation');
    const title = frame.locator('[data-payload-field="title"]');
    await expect(title).toBeVisible();
    await page.waitForTimeout(2_100);
    await installNavigationProbe(page);

    await page.getByTestId('title-input').fill('Unsaved across a streamed Svelte destination');
    await expect(title).toHaveText('Unsaved across a streamed Svelte destination');
    await expect.poll(async () => (await readNavigationProbe(page)).documents.length).toBe(1);
    const accepted = await acceptedRevisions(frame);

    await frame.getByTestId('navigate-stream').click();
    await expect.poll(() => new URL(frame.url()).searchParams.get('step')).toBe('stream');
    await expect(frame.getByTestId('streamed-title-pending')).toBeVisible();
    await expect.poll(async () => (await readNavigationProbe(page)).events).toBe(1);
    await expect.poll(async () => (await readNavigationProbe(page)).ready).toBe(1);
    await expect(title).toHaveText('Unsaved across a streamed Svelte destination');

    await page.waitForTimeout(250);
    const replay = await readNavigationProbe(page);
    expect(replay.documents).toHaveLength(1);
    expect(await acceptedRevisions(frame)).toBe(accepted);
  });

  test('awaits invalidateAll before reapplying the unsaved document', async ({ page }) => {
    await page.goto(`${APP}/admin.html?target=/navigation`);
    const frame = await waitForPreviewFrame(page, '/navigation');
    await waitForStarted(frame);
    const title = frame.locator('[data-payload-field="title"]');
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (
              window as Window & {
                __livePreview?: { inspect: () => { revisions: { accepted: number } } };
              }
            ).__livePreview?.inspect().revisions.accepted ?? 0,
        ),
      )
      .toBeGreaterThan(0);

    await page.getByTestId('title-input').fill('Unsaved across invalidateAll');
    await expect(title).toHaveText('Unsaved across invalidateAll');
    const generation = await frame.getByTestId('navigation-generation').textContent();

    // `subtitle` has no binding on this route. Its unsaved change therefore
    // enters the route strategy, which must await the native server load before
    // the same revision is reapplied to the newly keyed heading.
    await page.getByTestId('subtitle-input').fill('Unsaved and deliberately unbound');
    await expect(frame.getByTestId('navigation-generation')).not.toHaveText(generation ?? '');
    await expect(title).toHaveText('Unsaved across invalidateAll');
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

test.describe('sveltekit live preview — origin enforcement', () => {
  test('messages from an untrusted origin are ignored', async ({ page }) => {
    await page.goto(`${APP}/`);
    // Mimic a malicious page that tries to drive the preview. On a
    // top-level navigation the handle does not inject the runtime
    // (no preview signal) and the runtime would refuse to start
    // outside an iframe anyway — the DOM must not change.
    await page.evaluate(() => {
      window.postMessage(
        {
          type: 'payload-live-preview',
          data: { title: 'attacker-controlled' },
        },
        '*',
      );
    });
    // Give the runtime time to (not) react. Since 1.1.0 a public response
    // carries no binding at all, so there is nothing an attacker could even
    // address — the heading is plain markup and stays what it was.
    await page.waitForTimeout(150);
    await expect(page.locator('[data-payload-field]')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveText('Hello from the demo');
  });
});

test.describe('sveltekit live preview — authorized preview context (ADR 0006)', () => {
  async function token(request: Parameters<Parameters<typeof test>[2]>[0]['request']) {
    const response = await request.get(`${APP}/preview-token?path=/`);
    return response.text();
  }

  test('a public request carries no binding, no runtime and no preview CSP', async ({
    request,
  }) => {
    const response = await request.get(`${APP}/`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toMatch(/\sdata-payload-[a-z-]+="/);
    expect(html).not.toContain('__LIVE_PREVIEW_CONFIG__');
    expect(response.headers()['content-security-policy']).toBeUndefined();
  });

  test('intent without a token is refused the same way', async ({ request }) => {
    const response = await request.get(`${APP}/?preview=true`, {
      headers: { 'sec-fetch-dest': 'iframe' },
    });
    const html = await response.text();
    expect(html).not.toMatch(/\sdata-payload-[a-z-]+="/);
    expect(html).not.toContain('__LIVE_PREVIEW_CONFIG__');
    expect(response.headers()['content-security-policy']).toBeUndefined();
  });

  test('a token bound to another path is refused', async ({ request }) => {
    const other = await request.get(`${APP}/preview-token?path=/elsewhere`);
    const response = await request.get(`${APP}/?preview=true&previewToken=${await other.text()}`);
    const html = await response.text();
    expect(html).not.toMatch(/\sdata-payload-[a-z-]+="/);
    expect(html).not.toContain('__LIVE_PREVIEW_CONFIG__');
  });

  test('a valid token yields bindings, runtime and CSP together', async ({ request }) => {
    const response = await request.get(`${APP}/?preview=true&previewToken=${await token(request)}`);
    const html = await response.text();
    expect(html).toContain('data-payload-field="title"');
    expect(html).toContain('data-payload-owner="collection:pages"');
    expect(html).toContain('__LIVE_PREVIEW_CONFIG__');
    expect(response.headers()['content-security-policy']).toContain('frame-ancestors');
  });
});

test.describe("sveltekit live preview — eventSourcePolicy 'parent-or-opener' (defaults: 'v2')", () => {
  async function previewUrl(request: Parameters<Parameters<typeof test>[2]>[0]['request']) {
    const token = await (await request.get(`${APP}/preview-token?path=/`)).text();
    return `${APP}/?preview=true&previewToken=${encodeURIComponent(token)}`;
  }

  test('a message posted by the page itself is refused even though its origin is trusted', async ({
    page,
  }) => {
    await page.goto(`${APP}/admin.html`);
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();
    // The parent (this admin page) is the one legitimate sender: prove the
    // runtime is live by going through it first.
    await page.getByTestId('title-input').fill('From the parent');
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText('From the parent');
    // Now post from inside the frame: same origin, wrong window.
    const frame = page.frame({ url: /previewToken=/ });
    if (frame === null) throw new Error('preview frame not found');
    await frame.evaluate(() => {
      window.postMessage(
        {
          type: 'payload-live-preview',
          data: { title: 'From the page itself' },
          collectionSlug: 'pages',
        },
        window.location.origin,
      );
    });
    await page.waitForTimeout(200);
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText('From the parent');
  });

  test('a message from the opener of a popup is accepted', async ({ page, request }) => {
    await page.goto(`${APP}/admin.html`);
    const url = await previewUrl(request);
    const popupPromise = page.waitForEvent('popup');
    await page.evaluate((target) => {
      (window as Window & { __popup?: Window | null }).__popup = window.open(
        target,
        'preview-popup',
      );
    }, url);
    const popup = await popupPromise;
    await expect(popup.locator('[data-payload-field="title"]')).toBeVisible();
    await expect
      .poll(
        () =>
          popup.evaluate(
            () =>
              (
                window as Window & { __livePreview?: { inspect: () => { started: boolean } } }
              ).__livePreview?.inspect().started ?? false,
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.evaluate((origin) => {
      (window as Window & { __popup?: Window | null }).__popup?.postMessage(
        {
          type: 'payload-live-preview',
          data: { title: 'From the opener' },
          collectionSlug: 'pages',
        },
        origin,
      );
    }, APP);
    await expect(popup.locator('[data-payload-field="title"]')).toHaveText('From the opener');
    await popup.close();
  });
});
