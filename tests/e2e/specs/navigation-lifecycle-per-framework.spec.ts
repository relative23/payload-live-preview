import { expect, test } from '@playwright/test';
import { requirePreviewFrame } from '../helpers/preview';

/**
 * Per-framework BFCache restore (roadmap 1.9.0). The pagehide/persisted-pageshow
 * path is one window-level implementation in the injected runtime, so it cannot
 * differ per framework — but "a full page load passing is not evidence for
 * either", so each framework's own served, hydrated preview page is driven
 * through a real hide/restore cycle here, not just a load. The astro fixture is
 * covered by `navigation-lifecycle.spec.ts`; this covers the Next.js, SvelteKit
 * and Nuxt fixtures against their admin mocks.
 *
 * Each fixture is addressed absolutely because Playwright's baseURL is the
 * astro fixture; a case is skipped when its server is not part of this run
 * (PLP_E2E_SERVERS), so the file is safe in any single-fixture job.
 */

interface Framework {
  readonly name: string;
  readonly admin: string;
}

const FRAMEWORKS: readonly Framework[] = [
  { name: 'nextjs', admin: 'http://localhost:4174/admin.html' },
  { name: 'sveltekit', admin: 'http://localhost:4175/admin.html' },
  { name: 'nuxt', admin: 'http://localhost:4176/admin.html' },
];

function registerFramework(framework: Framework): void {
  test.describe(`${framework.name} — BFCache restore`, () => {
    test('stops applying while hidden and resumes after a persisted restore', async ({ page }) => {
      await page.goto(framework.admin);
      const preview = page.frameLocator('[data-testid="preview-frame"]');
      const title = preview.locator('[data-payload-field="title"]');
      await expect(title).toBeVisible();

      await page.getByTestId('title-input').fill('before the document hides');
      await expect(title).toHaveText('before the document hides');

      const frame = requirePreviewFrame(page);

      // Hide (BFCache freeze): the runtime must release its listener.
      await frame.evaluate(() => {
        window.dispatchEvent(new Event('pagehide'));
      });
      await page.getByTestId('title-input').fill('while frozen');
      await page.waitForTimeout(500);
      await expect(title).not.toHaveText('while frozen');

      // Persisted restore: the runtime must reacquire and apply again.
      await frame.evaluate(() => {
        const restore = new Event('pageshow');
        Object.defineProperty(restore, 'persisted', { value: true });
        window.dispatchEvent(restore);
      });
      await page.getByTestId('title-input').fill('after the restore');
      await expect(title).toHaveText('after the restore');
    });
  });
}

registerFramework(FRAMEWORKS[0]!);
registerFramework(FRAMEWORKS[1]!);
registerFramework(FRAMEWORKS[2]!);
