import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Reveal the edited section (roadmap 2.0), in a real browser. The reveal
 * fixture puts `footer` below a 2,200px spacer — off-screen on load. Editing
 * it must scroll it into view; the pure guards (off-screen only, reduced
 * motion, field-change dedupe) are unit-tested, this proves the actual
 * scrollIntoView + layout in Chromium/Firefox/WebKit.
 */

function previewFrame(page: Page): Frame | undefined {
  // The preview is the only child frame; the bench is the main frame (and its
  // URL also contains '/reveal/' in the query, so match by frame identity).
  return page.frames().find((frame) => frame !== page.mainFrame());
}

async function sendUpdate(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.evaluate((payload) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    frame?.contentWindow?.postMessage(
      { type: 'payload-live-preview', data: payload },
      window.location.origin,
    );
  }, data);
}

/** Whether the element with the given test id is within the iframe viewport. */
async function footerInView(frame: Frame): Promise<boolean> {
  return frame.evaluate(() => {
    const el = document.querySelector('[data-testid="footer"]');
    if (el === null) return false;
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });
}

test('editing an off-screen field scrolls it into view', async ({ page }) => {
  await page.goto('/bench?target=/reveal/');
  await expect
    .poll(() => previewFrame(page)?.url().endsWith('/reveal/') ?? false, { timeout: 15_000 })
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

  // Baseline: establish the last-values snapshot. Await the applied text so the
  // baseline flush completes before the edit — two messages inside the debounce
  // would coalesce into one flush, which is (correctly) treated as the baseline
  // and never scrolls.
  await sendUpdate(page, { heroTitle: 'Top', footer: 'baseline footer' });
  await expect(footer).toHaveText('baseline footer');
  expect(await footerInView(frame), 'footer starts below the fold').toBe(false);

  // Edit the footer → the preview should reveal it.
  await sendUpdate(page, { heroTitle: 'Top', footer: 'edited footer' });
  await expect(footer).toHaveText('edited footer');
  await expect.poll(() => footerInView(frame), { timeout: 5_000 }).toBe(true);
});
