/**
 * What the real-admin specs share about the homepage's upload field: the media the backend seeds
 * (`examples/payload-backend/payload.config.ts`), how an editor chooses it, and the request the
 * preview makes when it asks Payload for the document behind an id.
 */
import { expect, type Page, type Response } from '@playwright/test';

/** The seeded `media` document: the file's name and the alt text the admin posts and Payload returns. */
export const SEEDED_MEDIA = { filename: 'e2e-pixel.png', alt: 'A single pixel' } as const;

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
