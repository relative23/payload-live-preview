/**
 * Opening the admin's Live Preview panel, shared by the real-admin specs. The toggle is a per-user preference, so
 * the panel may already be open. The click is one DOM event dispatched once React has wired the button, not
 * Playwright's click: that waits for two animation frames first, and WebKit on a loaded CI runner can give the admin
 * none for the rest of the test (PR #180, run 40508357795: the click never got past "visible, enabled and stable").
 */
import { expect, type Page } from '@playwright/test';

/** The panel open. A 0×0 panel is closed; the iframe is no signal, its loader keeps it hidden until `onLoad`. */
export async function openLivePreviewPanel(page: Page): Promise<void> {
  const panel = page.locator('.live-preview-window');
  const isOpen = async (): Promise<boolean> =>
    panel.evaluate((el) => el instanceof HTMLElement && el.offsetWidth > 0).catch(() => false);
  if (await isOpen()) return;
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

/**
 * The preview frame reloaded, as the editor's browser would after a sign-in or a sign-out. In WebKit one such
 * reload fired no `load` within the test's minute (run 41507231988, the nuxt4 session spec), so a reload that has
 * not loaded after 20 s is started again, at most three times. A cold dev server that compiles the page for longer
 * goes on compiling, and the next request is answered when it is done.
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
  }
  throw new Error('the preview frame fired no load event after three reloads');
}
