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
import { requirePreviewFrame } from '../helpers/preview';

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
