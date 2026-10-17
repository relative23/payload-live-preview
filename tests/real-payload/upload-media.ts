/**
 * What the real-admin specs share about the homepage's upload field: the media the backend seeds
 * (`examples/payload-backend/payload.config.ts`), how an editor chooses it, and the request the
 * preview makes when it asks Payload for the document behind an id.
 */
import { expect, type Locator, type Page, type Response } from '@playwright/test';

/**
 * The seeded `media` document: the file's name and the alt text the admin posts and Payload returns, and
 * the `src` the preview ends up with. Payload's config sets no `serverURL`, so it returns the path
 * `/api/media/file/e2e-pixel.png`, and the runtime resolves that against the `serverURL` it was given.
 */
export const SEEDED_MEDIA = {
  filename: 'e2e-pixel.png',
  alt: 'A single pixel',
  path: '/api/media/file/e2e-pixel.png',
  src: 'http://localhost:3001/api/media/file/e2e-pixel.png',
} as const;

/**
 * The browser decoded the image. A path left on the preview's own origin is a 404 and a broken image,
 * `naturalWidth` 0; the file is the admin's, and answers the editor's session only.
 */
export async function expectImageLoaded(image: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        image
          .evaluate((el) => (el instanceof HTMLImageElement && el.complete ? el.naturalWidth : 0))
          .catch(() => 0),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
}

/**
 * The editor's way: the field's "Choose from existing" opens a drawer that lists the `media`
 * collection, and the row selects the document. The drawer closing is the admin's signal that the
 * selection was taken, after which the form posts `image` as the media's id.
 */
export async function chooseSeededMedia(page: Page): Promise<void> {
  await page.locator('#field-image button.upload__listToggler').click();
  const drawer = page.locator('dialog.list-drawer');
  await expect(drawer).toBeVisible();
  await drawer
    .locator('tbody tr', { hasText: SEEDED_MEDIA.filename })
    .locator('button.default-cell__first-cell')
    .click();
  await expect(drawer).toBeHidden();
}

/**
 * The preview's population request: a credentialed POST that Payload reads as a GET (its method
 * override), from the preview's origin to the admin's. Start waiting before the action that causes it.
 */
export function waitForPopulation(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.url().startsWith('http://localhost:3001/api/globals/homepage') &&
      response.request().method() === 'POST' &&
      response.request().headers()['x-payload-http-method-override'] === 'GET',
    { timeout: 30_000 },
  );
}
