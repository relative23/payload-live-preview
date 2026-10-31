import { expect, test } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * ADR 0024 in a browser: Astro's one-line middleware setup under the strict
 * default. The integration cannot carry `authorizePreview`, so
 * `examples/astro-middleware` names the module that exports it; the mock
 * admin mints the token a real admin's `livePreview.url` would. Only a
 * request with a valid token receives the runtime: the intent parameter
 * alone, or with a forged token, gets the public page.
 */

const APP = 'http://localhost:4183';

test.describe('the Astro middleware setup under the strict default', () => {
  test('an authorized frame receives the runtime, and an update lands', async ({ page }) => {
    await page.goto(`${APP}/admin`);
    const frame = await waitForPreviewFrame(page, 'previewToken=');
    await waitForStarted(frame, '__livePreview');

    await post(page, { title: 'Authorized edit', subtitle: 'sub' });

    await expect(frame.getByTestId('title')).toHaveText('Authorized edit');
  });

  test('the intent parameter alone receives the public page', async ({ request }) => {
    const response = await request.get(`${APP}/?preview=true`);
    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(html).toContain('data-testid="title"');
    expect(html).not.toContain('__LIVE_PREVIEW_CONFIG__');
  });

  test('PreviewBoundary and RichText carry no binding attribute for anyone unauthorized', async ({
    request,
    page,
  }) => {
    for (const path of [
      '/gated',
      '/gated?preview=true',
      '/gated?preview=true&previewToken=x.y.z',
    ]) {
      const html = await (await request.get(`${APP}${path}`)).text();
      expect(html, path).toContain('data-testid="anchor"');
      expect(html, path).not.toContain('data-payload-');
    }
    await page.goto(`${APP}/admin`);
    const token = new URL(
      (await waitForPreviewFrame(page, 'previewToken=')).url(),
    ).searchParams.get('previewToken');
    const authorized = await (
      await request.get(`${APP}/gated?preview=true&previewToken=${token ?? ''}`)
    ).text();
    expect(authorized).toContain('data-payload-field="subtitle"');
    expect(authorized).toContain('data-payload-boundary');
    expect(authorized).toContain('data-payload-field="body"');
  });

  test('a forged token receives the public page', async ({ request }) => {
    const response = await request.get(`${APP}/?preview=true&previewToken=forged.token.value`);
    const html = await response.text();

    expect(html).toContain('data-testid="title"');
    expect(html).not.toContain('__LIVE_PREVIEW_CONFIG__');
  });
});
