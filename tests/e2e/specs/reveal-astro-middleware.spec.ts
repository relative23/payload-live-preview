import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * The Astro adapter's *middleware* delivery (mode:'middleware'): the runtime is
 * injected into SSR HTML responses at request time by the integration-registered
 * middleware, gated on preview intent (a `?preview=true` query param under the
 * query-only signal). No other fixture exercises the addMiddleware registration
 * path. Intent-only (defaults:'v1') because integration middleware cannot carry
 * the authorizePreview function the 2.0 strict default requires — the SvelteKit
 * fixture and astro-hybrid cover the authorized paths.
 */

const ORIGIN = 'http://localhost:4183';

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

test('patches a bound field (Astro middleware mode)', async ({ page }) => {
  await page.goto(`${ORIGIN}/admin?target=${encodeURIComponent('/?preview=true')}`);
  await expect
    .poll(() => previewFrame(page)?.url() ?? '', { timeout: 15_000 })
    .toContain('preview=true');
  const frame = previewFrame(page);
  if (!frame) throw new Error('preview frame missing');
  await expect.poll(() => started(frame), { timeout: 15_000 }).toBe(true);

  await sendUpdate(page, { title: 'Live from Astro middleware', subtitle: 'sub' });
  await expect(page.frameLocator('[data-testid="preview-frame"]').getByTestId('title')).toHaveText(
    'Live from Astro middleware',
  );
});

test('reveals an off-screen field on edit (Astro middleware mode)', async ({ page }) => {
  await page.goto(`${ORIGIN}/admin?target=${encodeURIComponent('/reveal?preview=true')}`);
  await expect
    .poll(() => previewFrame(page)?.url().includes('/reveal') ?? false, { timeout: 15_000 })
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
