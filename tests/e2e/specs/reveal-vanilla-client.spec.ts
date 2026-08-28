import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * The npm-import path: a bundled SPA calls initLivePreview() from
 * payload-live-preview/client — the LivePreviewClient class, not the baked
 * inline script. This is the code path every JS-framework SPA (Remix, Solid,
 * Vue, Svelte, Qwik) reduces to, so patch + reveal green here covers them all.
 */

const ORIGIN = 'http://localhost:4181';

function frameOf(page: Page, suffix: string): Frame | undefined {
  // The admin URL carries `?target=…`, so it too ends with the suffix — match
  // the sub-frame only, never the main frame.
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

// The client factory returns the instance only when it actually started, so a
// non-null handle exposed on the window is the "started" signal.
async function started(frame: Frame): Promise<boolean> {
  return frame.evaluate(
    () =>
      (
        window as Window & { __lpClient?: { inspect(): { started: boolean } } | null }
      ).__lpClient?.inspect().started ?? false,
  );
}

test('patches a bound field via the /client import', async ({ page }) => {
  await page.goto(`${ORIGIN}/admin.html?target=/index.html`);
  await expect
    .poll(() => frameOf(page, '/index.html')?.url() ?? '', { timeout: 15_000 })
    .toContain('/index.html');
  const frame = frameOf(page, '/index.html');
  if (!frame) throw new Error('preview frame missing');
  await expect.poll(() => started(frame), { timeout: 15_000 }).toBe(true);

  await post(page, { title: 'Live from bundle', subtitle: 'sub' });
  await expect(page.frameLocator('[data-testid="preview-frame"]').getByTestId('title')).toHaveText(
    'Live from bundle',
  );
});

test('reveals an off-screen field on edit (/client import)', async ({ page }) => {
  await page.goto(`${ORIGIN}/admin.html?target=/reveal.html`);
  await expect
    .poll(() => frameOf(page, '/reveal.html')?.url() ?? '', { timeout: 15_000 })
    .toContain('/reveal.html');
  const frame = frameOf(page, '/reveal.html');
  if (!frame) throw new Error('preview frame missing');
  await expect.poll(() => started(frame), { timeout: 15_000 }).toBe(true);

  const footer = page.frameLocator('[data-testid="preview-frame"]').getByTestId('footer');
  await post(page, { heroTitle: 'Top', footer: 'baseline footer' });
  await expect(footer).toHaveText('baseline footer');
  expect(
    await frame.evaluate(() => {
      const r = document.querySelector('[data-testid="footer"]')!.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    }),
    'footer starts below the fold',
  ).toBe(false);

  await post(page, { heroTitle: 'Top', footer: 'edited footer' });
  await expect(footer).toHaveText('edited footer');
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
