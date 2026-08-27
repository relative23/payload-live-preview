import { expect, test, type FrameLocator, type Page } from '@playwright/test';

/**
 * Roadmap 1.1.0 acceptance gate: "A page rendering two documents that share
 * a field name patches only the binding owned by the selected document,
 * proven in a browser E2E rather than a unit test."
 *
 * Runs against the SvelteKit fixture, whose hook enables
 * `scopeBindingsByOwner` and whose `/owners` route renders `global:a` and
 * `global:b`, both with a `title` binding. The runtime starts only inside a
 * preview context, so the page is framed by the fixture's mock admin and
 * opened with a real preview token; updates are posted from the admin
 * window — the parent, on the origin the fixture trusts.
 */

const APP = 'http://localhost:4175';

async function openOwners(page: Page): Promise<FrameLocator> {
  const token = await (await page.request.get(`${APP}/preview-token?path=/owners`)).text();
  await page.goto(`${APP}/admin.html`);
  await page.evaluate(
    (src) => {
      const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
      if (frame === null) throw new Error('preview frame missing');
      frame.src = src;
    },
    `${APP}/owners?preview=true&previewToken=${encodeURIComponent(token)}`,
  );
  const frame = page.frameLocator('[data-testid="preview-frame"]');
  await expect(frame.getByTestId('doc-a')).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
          const w = frame?.contentWindow as
            | (Window & { __livePreview?: { inspect: () => { started: boolean } } })
            | null
            | undefined;
          return w?.__livePreview?.inspect().started ?? false;
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
  return frame;
}

async function post(page: Page, message: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ m, origin }) => {
      const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
      frame?.contentWindow?.postMessage({ type: 'payload-live-preview', ...m }, origin);
    },
    { m: message, origin: APP },
  );
}

test.describe('owner scoping — two documents, one field name', () => {
  test('an update naming document a patches a and leaves b alone, and vice versa', async ({
    page,
  }) => {
    const frame = await openOwners(page);
    const a = frame.getByTestId('doc-a').locator('[data-payload-field="title"]');
    const b = frame.getByTestId('doc-b').locator('[data-payload-field="title"]');
    await expect(a).toHaveText('Title of A');
    await expect(b).toHaveText('Title of B');

    await post(page, { data: { title: 'A, edited' }, globalSlug: 'a' });
    await expect(a).toHaveText('A, edited');
    await expect(b).toHaveText('Title of B');

    await post(page, { data: { title: 'B, edited' }, globalSlug: 'b' });
    await expect(b).toHaveText('B, edited');
    await expect(a).toHaveText('A, edited');
  });

  test('an update that names no document patches nothing', async ({ page }) => {
    const frame = await openOwners(page);
    const a = frame.getByTestId('doc-a').locator('[data-payload-field="title"]');
    const b = frame.getByTestId('doc-b').locator('[data-payload-field="title"]');
    await post(page, { data: { title: 'nobody asked' } });
    // Give the runtime more than a debounce window to prove it stayed quiet.
    await page.waitForTimeout(200);
    await expect(a).toHaveText('Title of A');
    await expect(b).toHaveText('Title of B');
  });

  test('without authorization the page carries neither owner nor field attributes', async ({
    request,
  }) => {
    const html = await (await request.get(`${APP}/owners`)).text();
    expect(html).not.toMatch(/\sdata-payload-[a-z-]+="/);
    expect(html).toContain('Title of A');
  });
});
