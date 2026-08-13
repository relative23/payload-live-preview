import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

function assertAxeResult(result: Awaited<ReturnType<AxeBuilder['analyze']>>): void {
  expect(result.violations).toEqual([]);
  // Axe marks checks requiring human judgment as incomplete. Keep them visible
  // in the gate instead of silently treating an unevaluated rule as a pass.
  expect(result.incomplete).toEqual([]);
}

/**
 * Accessibility coverage is intentionally scoped to the package-owned preview
 * experience. Axe catches machine-detectable WCAG regressions; the semantic
 * live-region ownership and timing contract remains covered by deterministic
 * unit/integration tests.
 */
test.describe('package-owned preview accessibility', () => {
  test('has no detectable WCAG A/AA violations before or after a live update', async ({ page }) => {
    await page.goto('/admin');

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();

    const before = await new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS]).analyze();
    assertAxeResult(before);

    await page.getByTestId('title-input').fill('Accessible live update');
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText(
      'Accessible live update',
    );
    await expect(preview.locator('#payload-live-preview-a11y')).toHaveAttribute(
      'aria-live',
      'polite',
    );

    const after = await new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS]).analyze();
    assertAxeResult(after);
  });
});
