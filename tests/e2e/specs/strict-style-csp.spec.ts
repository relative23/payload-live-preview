import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted, type RuntimeHandle } from '../helpers/preview';

/**
 * PHD-03: what the package itself puts on the page under a strict style
 * policy. The preview page is served with a policy that refuses every inline
 * style attribute, one set through `setAttribute('style')` included. The live
 * region must still be visually hidden and exposed to assistive technology,
 * the overlay still laid out, and neither may cause a style violation.
 */

/** `'self'` is the usual strict setting; the other two refuse more, and the attribute alone. */
const POLICIES = ["style-src 'self'", "style-src 'none'", "style-src-attr 'none'"] as const;

type ViolationWindow = Window & { __plpStyleViolations?: string[] };

async function openStrict(
  page: Page,
  policy: string,
  app: string,
  target: string,
  handle?: RuntimeHandle,
): Promise<Frame> {
  await page.route(`${app}${target}*`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': policy },
    });
  });
  await page.goto(`${app}/admin.html?target=${encodeURIComponent(target)}`);
  const frame = await waitForPreviewFrame(page, target);
  await waitForStarted(frame, handle);
  // The package mounts its elements on the first message, so every violation
  // from here on is its own; the page's markup was parsed before.
  await frame.evaluate(() => {
    const seen: string[] = [];
    (window as ViolationWindow).__plpStyleViolations = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.effectiveDirective.startsWith('style-src')) {
        seen.push(`${event.effectiveDirective} ${event.sample}`);
      }
    });
  });
  return frame;
}

function violations(frame: Frame): Promise<string[]> {
  return frame.evaluate(() => (window as ViolationWindow).__plpStyleViolations ?? []);
}

POLICIES.forEach((policy) => {
  test.describe(`a strict style policy (${policy})`, () => {
    test('keeps the package live region visually hidden', async ({ page }) => {
      const frame = await openStrict(page, policy, 'http://localhost:4180', '/full.html');

      await post(page, { title: 'Announced under a strict policy' });

      const region = frame.locator('#payload-live-preview-a11y');
      await expect(region).not.toBeEmpty();
      // Hidden from sight, not from the accessibility tree a screen reader reads.
      await expect(region).toMatchAriaSnapshot('- status: /\\w+/');
      await expect(region).toHaveCSS('position', 'absolute');
      await expect(region).toHaveCSS('width', '1px');
      await expect(region).toHaveCSS('overflow', 'hidden');
      expect(await violations(frame)).toEqual([]);
    });

    test('is in force, and its violations are seen', async ({ page }) => {
      const frame = await openStrict(page, policy, 'http://localhost:4180', '/full.html');

      // The countercheck for the other two: a `style` attribute set the way the
      // package used to set its own is refused, and the refusal is reported.
      await frame.evaluate(() => {
        const probe = document.createElement('div');
        probe.setAttribute('style', 'position:absolute');
        document.body.append(probe);
      });

      await expect.poll(() => violations(frame)).not.toEqual([]);
    });

    test('lays out the unbound-fields overlay', async ({ page }) => {
      const frame = await openStrict(
        page,
        policy,
        'http://localhost:4181',
        '/overlay.html',
        '__lpClient',
      );

      await post(page, { title: 'Bound', subtitle: 'nowhere to land' });

      const panel = frame.locator('#payload-live-preview-unbound');
      await expect(panel).toBeVisible();
      await expect(panel).toHaveCSS('position', 'fixed');
      await expect(panel.locator('button').first()).toHaveCSS('cursor', 'pointer');
      expect(await violations(frame)).toEqual([]);
    });
  });
});
