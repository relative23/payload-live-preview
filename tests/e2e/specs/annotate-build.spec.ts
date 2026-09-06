import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * `livePreviewAnnotate()` on a real build (`examples/astro-hybrid`, route
 * `/annotated`).
 *
 * The page has no `data-payload-*` in its source — `src/pages/annotated.astro`
 * is what a site writes. The plugin rewrites each printed field into a call to
 * the helper the middleware's authorization decides, which is the whole point:
 * the binding exists for an editor and does not exist for anyone else. The
 * hand-annotated pages in the same fixture are what it is measured against.
 */

const APP = 'http://localhost:4177';
const OWNER = { globalSlug: 'home' };
const BINDING = /\sdata-payload-[a-z-]+="/u;

async function tokenedUrl(request: APIRequestContext): Promise<string> {
  const host = await (await request.get(`${APP}/bench?target=/annotated`)).text();
  const src = /src="([^"]*)"/u.exec(host)?.[1];
  expect(src, 'the bench frames the route').toBeDefined();
  return `${APP}${src!.replaceAll('&amp;', '&')}`;
}

async function open(page: Page): Promise<ReturnType<typeof waitForPreviewFrame>> {
  await page.goto(`${APP}/bench?target=/annotated`);
  const frame = await waitForPreviewFrame(page, 'preview=true');
  await waitForStarted(frame);
  return frame;
}

test.describe('bindings written at build time', () => {
  test('a public response carries none of them', async ({ request }) => {
    const response = await request.get(`${APP}/annotated`);
    const html = await response.text();

    expect(html).toContain('Annotated title');
    expect(html).not.toMatch(BINDING);
    // Not even the helper's own import: the page is the page.
    expect(html).not.toContain('__lpPreview');
  });

  test('an authorized preview carries exactly the fields the template prints', async ({
    request,
  }) => {
    const html = await (await request.get(await tokenedUrl(request))).text();

    expect(html).toContain('data-payload-field="title"');
    expect(html).toContain('data-payload-field="subtitle"');
    // `{Date.now()}` is a call, and the scanner refuses a call. A binding there
    // would make the runtime write a field value over a timestamp.
    expect(html).toMatch(/<footer data-testid="stamp">/u);
  });

  test('intent without a token is a public response, byte for byte', async ({ request }) => {
    const claimed = await (await request.get(`${APP}/annotated?preview=true`)).text();

    expect(claimed).not.toMatch(BINDING);
  });

  test('the generated bindings patch like hand-written ones', async ({ page }) => {
    const frame = await open(page);

    await post(page, { title: 'Edited by the admin', subtitle: 'Edited subtitle' }, OWNER);

    await expect(frame.locator('[data-payload-field="title"]')).toHaveText('Edited by the admin');
    await expect(frame.locator('[data-payload-field="subtitle"]')).toHaveText('Edited subtitle');
  });
});
