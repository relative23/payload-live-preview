import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { post } from '../helpers/preview';

/**
 * Roadmap 1.1.0 acceptance gate: "A page rendering two documents that share
 * a field name patches only the binding owned by the selected document,
 * proven in a browser E2E rather than a unit test."
 *
 * Runs against the SvelteKit fixture, whose hook enables
 * `scopeBindingsByOwner` and whose `/owners` route renders `global:a` and
 * `global:b`, both with a `title` binding. The runtime starts only inside a
 * preview context, so the page is framed by the fixture's mock admin
 * (`admin.html?target=/owners`), which fetches a real preview token for it;
 * updates are posted from the admin window — the parent, on the origin the
 * fixture trusts.
 */

const APP = 'http://localhost:4175';

async function openOwners(page: Page): Promise<FrameLocator> {
  // The mock admin fetches a token for `target` and frames that route.
  await page.goto(`${APP}/admin.html?target=/owners`);
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

test.describe('owner scoping — two documents, one field name', () => {
  test('an update naming document a patches a and leaves b alone, and vice versa', async ({
    page,
  }) => {
    const frame = await openOwners(page);
    const a = frame.getByTestId('doc-a').locator('[data-payload-field="title"]');
    const b = frame.getByTestId('doc-b').locator('[data-payload-field="title"]');
    await expect(a).toHaveText('Title of A');
    await expect(b).toHaveText('Title of B');

    await post(page, { title: 'A, edited' }, { globalSlug: 'a', targetOrigin: APP });
    await expect(a).toHaveText('A, edited');
    await expect(b).toHaveText('Title of B');

    await post(page, { title: 'B, edited' }, { globalSlug: 'b', targetOrigin: APP });
    await expect(b).toHaveText('B, edited');
    await expect(a).toHaveText('A, edited');
  });

  test('an update that names no document patches nothing', async ({ page }) => {
    const frame = await openOwners(page);
    const a = frame.getByTestId('doc-a').locator('[data-payload-field="title"]');
    const b = frame.getByTestId('doc-b').locator('[data-payload-field="title"]');
    await post(page, { title: 'nobody asked' }, { targetOrigin: APP });
    // Give the runtime more than a debounce window to prove it stayed quiet.
    await page.waitForTimeout(200);
    await expect(a).toHaveText('Title of A');
    await expect(b).toHaveText('Title of B');
  });

  test('reveals the edited document, not the first element with that field name', async ({
    page,
  }) => {
    const frame = await openOwners(page);
    const inView = async (testId: string): Promise<boolean> =>
      frame
        .getByTestId(testId)
        .evaluate(
          (element) =>
            element.getBoundingClientRect().top < window.innerHeight &&
            element.getBoundingClientRect().bottom > 0,
        );

    expect(await inView('doc-a'), 'A starts above the fold').toBe(true);
    expect(await inView('doc-b'), 'B starts below it').toBe(false);

    // First message is the baseline for B; the second is the edit that reveals.
    await post(page, { title: 'B, first' }, { globalSlug: 'b', targetOrigin: APP });
    await expect(frame.getByTestId('doc-b').locator('[data-payload-field="title"]')).toHaveText(
      'B, first',
    );
    expect(await inView('doc-b'), 'the baseline does not scroll').toBe(false);

    await post(page, { title: 'B, edited' }, { globalSlug: 'b', targetOrigin: APP });
    await expect(frame.getByTestId('doc-b').locator('[data-payload-field="title"]')).toHaveText(
      'B, edited',
    );
    // Both documents bind `title`; revealing A's copy would leave B off-screen.
    await expect.poll(() => inView('doc-b'), { timeout: 5_000 }).toBe(true);
  });

  test('without authorization the page carries neither owner nor field attributes', async ({
    request,
  }) => {
    const html = await (await request.get(`${APP}/owners`)).text();
    expect(html).not.toMatch(/\sdata-payload-[a-z-]+="/);
    expect(html).toContain('Title of A');
  });
});
