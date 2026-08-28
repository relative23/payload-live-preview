import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Reveal the edited section through the nuxt adapter — real-browser proof the
 * feature is framework-agnostic (identical reveal runtime, nuxt injection).
 * `/reveal` puts `footer` below a 2,200px spacer; editing it scrolls it in.
 */

const ADMIN = 'http://localhost:4176/admin.html';

function previewFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame.url().endsWith('/reveal'));
}

async function sendUpdate(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.evaluate((payload) => {
    const iframe = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    iframe?.contentWindow?.postMessage(
      { type: 'payload-live-preview', data: payload },
      window.location.origin,
    );
  }, data);
}

async function footerInView(frame: Frame): Promise<boolean> {
  return frame.evaluate(() => {
    const el = document.querySelector('[data-testid="footer"]');
    if (el === null) return false;
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });
}

test('editing an off-screen field scrolls it into view (nuxt adapter)', async ({ page }) => {
  await page.goto(ADMIN);
  await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    if (iframe) iframe.src = '/reveal';
  });
  await expect
    .poll(() => previewFrame(page)?.url().endsWith('/reveal') ?? false, { timeout: 15_000 })
    .toBe(true);
  const frame = previewFrame(page);
  if (!frame) throw new Error('preview frame missing');
  await expect
    .poll(
      () =>
        frame.evaluate(
          () =>
            (
              window as Window & { __livePreview?: { inspect(): { started: boolean } } }
            ).__livePreview?.inspect().started ?? false,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);

  // Let SPA hydration settle so an applied value is not reverted by a re-render.
  await page.waitForTimeout(800);

  const footer = page.frameLocator('[data-testid="preview-frame"]').getByTestId('footer');
  await sendUpdate(page, { heroTitle: 'Top', footer: 'baseline footer' });
  await expect(footer).toHaveText('baseline footer');
  expect(await footerInView(frame), 'footer starts below the fold').toBe(false);

  await sendUpdate(page, { heroTitle: 'Top', footer: 'edited footer' });
  await expect(footer).toHaveText('edited footer');
  await expect.poll(() => footerInView(frame), { timeout: 5_000 }).toBe(true);
});
