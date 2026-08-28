import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * The zero-framework baseline: a plain static HTML page with the inline runtime
 * baked by generateInlineScript() — no adapter, no bundler. Proves patch and
 * reveal on the most minimal consumer there is. If it works here it works on
 * any page that can carry a <script>.
 */

const ORIGIN = 'http://localhost:4180';

function frameOf(page: Page, suffix: string): Frame | undefined {
  // The admin URL carries `?target=/reveal.html`, so it too ends with the
  // suffix — match the sub-frame only, never the main frame.
  return page.frames().find((frame) => frame !== page.mainFrame() && frame.url().includes(suffix));
}

async function post(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.evaluate((payload) => {
    const iframe = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    iframe?.contentWindow?.postMessage(
      { type: 'payload-live-preview', data: payload },
      window.location.origin,
    );
  }, data);
}

async function started(frame: Frame): Promise<boolean> {
  return frame.evaluate(
    () =>
      (
        window as Window & { __livePreview?: { inspect(): { started: boolean } } }
      ).__livePreview?.inspect().started ?? false,
  );
}

test('patches a bound field on a plain HTML page', async ({ page }) => {
  await page.goto(`${ORIGIN}/admin.html?target=/index.html`);
  await expect
    .poll(() => frameOf(page, '/index.html')?.url() ?? '', { timeout: 15_000 })
    .toContain('/index.html');
  const frame = frameOf(page, '/index.html');
  if (!frame) throw new Error('preview frame missing');
  await expect.poll(() => started(frame), { timeout: 15_000 }).toBe(true);

  await post(page, { title: 'Live from HTML', subtitle: 'sub' });
  await expect(page.frameLocator('[data-testid="preview-frame"]').getByTestId('title')).toHaveText(
    'Live from HTML',
  );
});

test('reveals an off-screen field on edit (plain HTML)', async ({ page }) => {
  await page.goto(`${ORIGIN}/admin.html?target=/reveal.html`);
  await expect
    .poll(() => frameOf(page, '/reveal.html')?.url() ?? '', { timeout: 15_000 })
    .toContain('/reveal.html');
  const frame = frameOf(page, '/reveal.html');
  if (!frame) throw new Error('preview frame missing');
  await expect.poll(() => started(frame), { timeout: 15_000 }).toBe(true);

  const footer = page.frameLocator('[data-testid="preview-frame"]').getByTestId('footer');
  // WebKit can drop the first postMessage after the runtime starts; retry the
  // post until the baseline is applied. Confirming it before the edit also stops
  // the two messages from coalescing inside the debounce window (which would be
  // treated as a single baseline and never scroll).
  await expect(async () => {
    await post(page, { heroTitle: 'Top', footer: 'baseline footer' });
    await expect(footer).toHaveText('baseline footer', { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  expect(
    await frame.evaluate(() => {
      const r = document.querySelector('[data-testid="footer"]')!.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    }),
    'footer starts below the fold',
  ).toBe(false);

  await expect(async () => {
    await post(page, { heroTitle: 'Top', footer: 'edited footer' });
    await expect(footer).toHaveText('edited footer', { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect
    .poll(
      () =>
        frame.evaluate(() => {
          const r = document.querySelector('[data-testid="footer"]')!.getBoundingClientRect();
          return r.top < window.innerHeight && r.bottom > 0;
        }),
      { timeout: 5_000 },
    )
    .toBe(true);
});
