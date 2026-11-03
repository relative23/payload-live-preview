/**
 * Opening the admin's Live Preview panel, shared by the real-admin specs. The toggle is a per-user preference, so
 * the panel may already be open. The click is one DOM event dispatched once React has wired the button, not
 * Playwright's click: that waits for two animation frames first, and WebKit on a loaded CI runner can give the admin
 * none for the rest of the test (PR #180, run 40508357795: the click never got past "visible, enabled and stable").
 */
import { expect, test, type Page } from '@playwright/test';
import { REPEATED_ATTEMPT } from '../../scripts/playwright-zero-skip-reporter';

/** The frame the panel shows the preview in. */
const PANEL_FRAME = '.live-preview-window iframe';

/**
 * The panel open and the first load of its frame complete. A 0×0 panel is closed; the iframe is no signal, its
 * loader keeps it hidden until `onLoad`.
 */
export async function openLivePreviewPanel(page: Page): Promise<void> {
  const panel = page.locator('.live-preview-window');
  const isOpen = async (): Promise<boolean> =>
    panel.evaluate((el) => el instanceof HTMLElement && el.offsetWidth > 0).catch(() => false);
  if (!(await isOpen())) {
    const toggler = page.locator('.live-preview-toggler');
    await expect(toggler).toBeVisible({ timeout: 15_000 });
    // Before hydration the click would be lost, or replayed afterwards on top of a second one and close the panel.
    await expect
      .poll(
        () =>
          toggler.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps$'))),
        { timeout: 15_000 },
      )
      .toBe(true);
    await toggler.dispatchEvent('click');
    // The toggle loads the panel's chunks; a cold `next dev` compiles them first (see the config's timeout).
    await expect.poll(isOpen, { timeout: 45_000 }).toBe(true);
  }
  await awaitFirstLoad(page);
}

/**
 * The frame's first load, which the admin starts when the panel opens. In WebKit that load once did not complete
 * within the test's minute: the frame stayed blank, and the retry loaded it in 5 s (run 41629530551, the nuxt smoke
 * spec). A first load that has not completed after 20 s is started again like a reload, and the restart is listed at
 * the end of the run with the address and state the frame had reached.
 */
async function awaitFirstLoad(page: Page): Promise<void> {
  // A read that lands while the frame commits its response loses its context: that is "not yet".
  const read = (): Promise<{ readonly href: string; readonly readyState: string }> =>
    page
      .frameLocator(PANEL_FRAME)
      .locator(':root')
      .evaluate(() => ({ href: location.href, readyState: document.readyState }), undefined, {
        timeout: 1_000,
      })
      .catch(() => ({ href: 'unreadable', readyState: 'navigating' }));
  const deadline = Date.now() + 20_000;
  let frame = await read();
  // The frame shows `about:blank` until its response commits; `complete` means its `load` has fired.
  while (frame.readyState !== 'complete' || frame.href === 'about:blank') {
    if (Date.now() > deadline) {
      test.info().annotations.push({
        type: REPEATED_ATTEMPT,
        description: `the preview frame had not loaded 20 s after the panel opened (${frame.href}, ${frame.readyState}); its load started again`,
      });
      await reloadPreviewFrame(page, PANEL_FRAME);
      return;
    }
    await page.waitForTimeout(250);
    frame = await read();
  }
}

/**
 * The preview frame reloaded, as the editor's browser would after a sign-in or a sign-out. In WebKit one such
 * reload fired no `load` within the test's minute (run 41507231988, the nuxt4 session spec), so a reload that has
 * not loaded after 20 s is started again, up to three reloads in all. A cold dev server that compiles the page for
 * longer goes on compiling, and the next request is answered when it is done. Each reload started again is listed
 * at the end of the run (scripts/playwright-zero-skip-reporter.ts): the test passes, but a growing count shows.
 */
export async function reloadPreviewFrame(page: Page, selector: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const loaded = await page.locator(selector).evaluate(
      (frame, timeout) =>
        new Promise<boolean>((resolve) => {
          const element = frame as HTMLIFrameElement;
          const timer = setTimeout(() => resolve(false), timeout);
          element.addEventListener(
            'load',
            () => {
              clearTimeout(timer);
              resolve(true);
            },
            { once: true },
          );
          element.setAttribute('src', element.src);
        }),
      20_000,
    );
    if (loaded) return;
    if (attempt < 3) {
      test.info().annotations.push({
        type: REPEATED_ATTEMPT,
        description: `the preview frame fired no load within 20 s; reload ${String(attempt + 1)} of 3`,
      });
    }
  }
  throw new Error('the preview frame fired no load event after three reloads');
}
