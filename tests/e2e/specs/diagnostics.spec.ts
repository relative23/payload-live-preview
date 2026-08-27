/**
 * Diagnostics in a real browser.
 *
 * The inspection API and the diagnostic codes have unit and integration tests,
 * but those run against jsdom and against the programmatic client. Neither is
 * what an adapter consumer gets: adapters inject the *inline* runtime, a
 * separate build. Shipping a feature to the client alone and believing it
 * reachable is exactly how `bindNavigationLifecycle()` stayed invisible to
 * every adapter user in 1.3.0.
 *
 * These tests call `__livePreview.inspect()` on the handle the Astro adapter
 * actually injects, in Chromium, Firefox and WebKit, and read the console the
 * way a person debugging would.
 */
import { expect, test, type Page } from '@playwright/test';

/** The preview iframe: the only frame that is not the admin page itself. */
function previewFrame(page: Page) {
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error('preview frame missing');
  return frame;
}

interface Snapshot {
  version: string;
  started: boolean;
  status: string;
  origins: { trusted: string[]; locked?: string };
  protocol: { ours: number; negotiated: number; capabilities: string[] };
  revisions: { accepted: number; superseded: number };
  bindings: {
    elements: number;
    fields: number;
    fieldNames: string[];
    orphanFields: string[];
    ownerScoped: boolean;
  };
  scheduler: {
    pending: number;
    deferred: number;
    visibilityGateThreshold: number;
    visibilityGateActive: boolean;
    lastFlush?: { applied: number; deferred: number; durationMs: number };
  };
  renderers: string[];
}

async function inspect(page: Page): Promise<Snapshot> {
  return (await previewFrame(page).evaluate(() =>
    (window as Window & { __livePreview?: { inspect: () => unknown } }).__livePreview?.inspect(),
  )) as Snapshot;
}

test.describe('inspect() on the handle an adapter injects', () => {
  test('describes the page the runtime is actually bound to', async ({ page }) => {
    await page.goto('/admin');
    await expect(
      page.frameLocator('[data-testid="preview-frame"]').locator('[data-payload-field="title"]'),
    ).toBeVisible();

    const snapshot = await inspect(page);

    expect(snapshot.started).toBe(true);
    expect(snapshot.version).toMatch(/^\d+\.\d+\.\d+/u);
    // The example page carries these; counting them proves the cache was built
    // from the real DOM rather than reported from a default.
    expect(snapshot.bindings.fieldNames).toContain('title');
    expect(snapshot.bindings.elements).toBeGreaterThan(0);
    expect(snapshot.bindings.fields).toBeGreaterThan(0);
    expect(snapshot.origins.trusted.length).toBeGreaterThan(0);
    expect(snapshot.renderers.length).toBeGreaterThan(0);
    expect(snapshot.protocol.negotiated).toBeLessThanOrEqual(snapshot.protocol.ours);
  });

  test('counts a real edit and records the flush it produced', async ({ page }) => {
    await page.goto('/admin');
    const title = page
      .frameLocator('[data-testid="preview-frame"]')
      .locator('[data-payload-field="title"]');
    await expect(title).toBeVisible();

    // The mock admin posts the form's initial state on load, so the count is
    // already non-zero here. Compare against it rather than assuming a zero.
    const before = (await inspect(page)).revisions.accepted;

    await page.getByTestId('title-input').fill('counted by the inspector');
    await expect(title).toHaveText('counted by the inspector');

    const after = await inspect(page);
    expect(after.revisions.accepted).toBeGreaterThan(before);
    expect(after.status).toBe('connected');
    expect(after.origins.locked).toBeTruthy();
    expect(after.scheduler.lastFlush?.applied).toBeGreaterThan(0);
  });

  test('returns a snapshot that does not change after it is handed over', async ({ page }) => {
    await page.goto('/admin');
    const title = page
      .frameLocator('[data-testid="preview-frame"]')
      .locator('[data-payload-field="title"]');
    await expect(title).toBeVisible();

    // Read once, edit, read again: the first object must still describe the
    // moment it was taken. A live view into runtime state would be a trap for
    // anyone capturing it in a failure report.
    const both = await previewFrame(page).evaluate(() => {
      const api = (window as Window & { __livePreview?: { inspect: () => unknown } }).__livePreview;
      return { first: JSON.stringify(api?.inspect()) };
    });
    const first = JSON.parse(both.first) as Snapshot;

    await page.getByTestId('title-input').fill('changed after the first read');
    await expect(title).toHaveText('changed after the first read');

    // Re-read the very same serialized object: it must still describe the
    // moment it was taken, while a fresh call reports the newer state.
    const stillFirst = JSON.parse(both.first) as Snapshot;
    const second = await inspect(page);
    expect(stillFirst.revisions.accepted).toBe(first.revisions.accepted);
    expect(second.revisions.accepted).toBeGreaterThan(first.revisions.accepted);
  });
});

test.describe('diagnostic codes reach the browser console', () => {
  test('stamps LP0201 on an update for a field with no binding', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        warnings.push(message.text());
      }
    });

    await page.goto('/admin');
    await expect(
      page.frameLocator('[data-testid="preview-frame"]').locator('[data-payload-field="title"]'),
    ).toBeVisible();

    // Post a field the page has no anchor for, the way the admin would — from
    // the parent window into the iframe, so the v2 parent-or-opener source
    // policy accepts it (a self-post would be dropped, correctly).
    await page.evaluate(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
      iframe?.contentWindow?.postMessage(
        { type: 'payload-live-preview', data: { thisFieldHasNoAnchor: 'x' } },
        window.location.origin,
      );
    });

    await expect
      .poll(() => warnings.some((line) => line.includes('LP0201')), {
        message: 'the orphan-field warning must carry its code',
      })
      .toBe(true);

    // And the same fact is readable without scraping the console.
    const snapshot = await inspect(page);
    expect(snapshot.bindings.orphanFields).toContain('thisFieldHasNoAnchor');
  });
});
