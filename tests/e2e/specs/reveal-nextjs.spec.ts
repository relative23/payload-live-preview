import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Reveal the edited section through the Next.js adapter (inline mode, React) —
 * a real-browser proof that the feature is not Astro-specific. The reveal
 * runtime is identical across adapters; this drives it via Next's
 * generateInlineScript injection. `/reveal` puts `footer` below a 2,200px
 * spacer; editing it must scroll it into view.
 */

const ADMIN = 'http://localhost:4174/admin.html';

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

test('editing an off-screen field scrolls it into view (Next.js adapter)', async ({ page }) => {
  await page.goto(ADMIN);
  // Point the preview iframe at the tall reveal page.
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

  const footer = page.frameLocator('[data-testid="preview-frame"]').getByTestId('footer');
  await sendUpdate(page, { heroTitle: 'Top', footer: 'baseline footer' });
  await expect(footer).toHaveText('baseline footer');
  expect(await footerInView(frame), 'footer starts below the fold').toBe(false);

  await sendUpdate(page, { heroTitle: 'Top', footer: 'edited footer' });
  await expect(footer).toHaveText('edited footer');
  await expect.poll(() => footerInView(frame), { timeout: 5_000 }).toBe(true);
});
