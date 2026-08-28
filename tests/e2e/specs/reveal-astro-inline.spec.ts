import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * The Astro adapter's *inline* delivery (mode:'inline'): the runtime is baked
 * into every built page via injectScript('head-inline'). astro-payload covers
 * the 'loader' branch in a browser; this covers 'inline', which was otherwise
 * only unit-tested — patch and reveal, on a real static Astro build.
 */

const ORIGIN = 'http://localhost:4182';

function previewFrame(page: Page): Frame | undefined {
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

async function started(frame: Frame): Promise<boolean> {
  return frame.evaluate(
    () =>
      (
        window as Window & { __livePreview?: { inspect(): { started: boolean } } }
      ).__livePreview?.inspect().started ?? false,
  );
}

async function footerInView(frame: Frame): Promise<boolean> {
  return frame.evaluate(() => {
    const el = document.querySelector('[data-testid="footer"]');
    if (el === null) return false;
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });
}

test('patches a bound field (Astro inline mode)', async ({ page }) => {
  await page.goto(`${ORIGIN}/admin/?target=/`);
  await expect.poll(() => previewFrame(page)?.url() ?? '', { timeout: 15_000 }).toContain(ORIGIN);
  const frame = previewFrame(page);
  if (!frame) throw new Error('preview frame missing');
  await expect.poll(() => started(frame), { timeout: 15_000 }).toBe(true);

  await sendUpdate(page, { title: 'Live from Astro inline', subtitle: 'sub' });
  await expect(page.frameLocator('[data-testid="preview-frame"]').getByTestId('title')).toHaveText(
    'Live from Astro inline',
  );
});

test('reveals an off-screen field on edit (Astro inline mode)', async ({ page }) => {
  await page.goto(`${ORIGIN}/admin/?target=/reveal/`);
  await expect
    .poll(() => previewFrame(page)?.url().endsWith('/reveal/') ?? false, { timeout: 15_000 })
    .toBe(true);
  const frame = previewFrame(page);
  if (!frame) throw new Error('preview frame missing');
  await expect.poll(() => started(frame), { timeout: 15_000 }).toBe(true);

  const footer = page.frameLocator('[data-testid="preview-frame"]').getByTestId('footer');
  await sendUpdate(page, { heroTitle: 'Top', footer: 'baseline footer' });
  await expect(footer).toHaveText('baseline footer');
  expect(await footerInView(frame), 'footer starts below the fold').toBe(false);

  await sendUpdate(page, { heroTitle: 'Top', footer: 'edited footer' });
  await expect(footer).toHaveText('edited footer');
  await expect.poll(() => footerInView(frame), { timeout: 5_000 }).toBe(true);
});
