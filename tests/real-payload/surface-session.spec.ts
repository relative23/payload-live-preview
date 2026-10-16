/**
 * Where a surface's preview verifies the editor's session (`payload-session`),
 * the real admin is what supplies it: the editor signs in through the real login
 * form, Payload issues `payload-token`, and the cookie reaches the preview site
 * with the iframe request. The runtime is part of the response only for that
 * request. `surface-smoke.spec.ts` holds what every surface shares.
 */
import { expect, test } from '@playwright/test';

const PORT = process.env['PLP_REAL_PAYLOAD_PORT'] ?? '4474';
const SURFACE = process.env['PLP_REAL_PAYLOAD_SURFACE'] ?? 'nextjs';
const PREVIEW_ORIGIN = `http://localhost:${PORT}`;

test.describe(`real Payload session → ${SURFACE} preview`, () => {
  test('a request without the session gets no runtime, the editor’s gets it', async ({
    page,
    request,
  }) => {
    await page.goto('/admin/login');
    await page.locator('#field-email').fill('e2e@example.com');
    await page.locator('#field-password').fill('test1234');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/admin(?!\/login)/u);

    const anonymous = await request.get(`${PREVIEW_ORIGIN}/?preview=true`);
    expect(anonymous.status()).toBe(200);
    expect(await anonymous.text()).not.toContain('__livePreview');
    const editor = await page.context().request.get(`${PREVIEW_ORIGIN}/?preview=true`);
    expect(editor.status()).toBe(200);
    expect(await editor.text()).toContain('__livePreview');
  });
});
