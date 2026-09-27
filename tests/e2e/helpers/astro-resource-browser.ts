/**
 * Both resource suites use the same real login and unsaved-message contract.
 * Credentials stay in browser/process memory; only authorization statuses and
 * rendered fixture data reach reports.
 */
import { expect, type Frame, type Page } from '@playwright/test';
import type { startNativeContinuation } from './native-continuation';
type ResourceFixture = Awaited<ReturnType<typeof startNativeContinuation>>;

export async function openResourcePreview(
  fixture: ResourceFixture,
  page: Page,
  editor: 'a' | 'b',
  locale: 'de' | 'en',
): Promise<Frame> {
  await page.goto('/');
  const documentResponse = page.waitForResponse(
    (response) =>
      response.request().resourceType() === 'document' &&
      new URL(response.url()).pathname === '/continuation/' + editor + '/' + locale,
  );
  const token = await fixture.token(editor, locale);
  const statuses = await page.evaluate(
    async ({ editor, locale, password, token }) => {
      const login = await fetch('/continuation/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: editor + '@fixture.invalid', password }),
      });
      const entry = await fetch(
        '/continuation/' + editor + '/' + locale + '/entry?preview=true&locale=' + locale,
        {
          headers: { 'x-preview-token': token },
        },
      );
      document.querySelector<HTMLIFrameElement>('#preview')!.src =
        '/continuation/' + editor + '/' + locale + '?preview=true&locale=' + locale;
      return [login.status, entry.status];
    },
    { editor, locale, password: fixture.backend.password, token },
  );
  expect(statuses).toEqual([204, 200]);
  await expect(page.frameLocator('#preview').getByTestId('ready')).toHaveText('ready');
  const response = await documentResponse;
  const csp = response.headers()['content-security-policy'];
  expect(csp).toContain("style-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
  expect((await response.text()).includes(fixture.backend.password)).toBe(false);
  return page
    .frames()
    .find((value) => new URL(value.url()).pathname === '/continuation/' + editor + '/' + locale)!;
}

export async function sendResourceRevision(
  fixture: ResourceFixture,
  page: Page,
  editor: 'a' | 'b',
  locale: 'de' | 'en',
  title: string,
  delayMs = 0,
): Promise<void> {
  await page.evaluate(
    ({ locale, data }) => {
      document.querySelector<HTMLIFrameElement>('#preview')!.contentWindow!.postMessage(
        {
          type: 'payload-live-preview',
          collectionSlug: 'articles',
          locale,
          data,
        },
        location.origin,
      );
    },
    {
      locale,
      data: { id: Number(fixture.backend.ids['article-' + editor]), show: true, title, delayMs },
    },
  );
}
