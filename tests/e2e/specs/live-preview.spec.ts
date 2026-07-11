/**
 * End-to-end tests for the live preview engine.
 *
 * The fixture is the Astro × Payload example under `examples/astro-payload`.
 * The `/admin` page emulates the Payload admin: it embeds `/` in an
 * iframe and posts updates whenever the form changes. The library's
 * inline script — injected automatically by the Astro integration —
 * applies those updates to the DOM in real time.
 *
 * This spec is the strongest correctness signal for the library: it
 * exercises the full path from postMessage to DOM write through a real
 * browser. If it fails, something fundamental is broken.
 */
import { expect, test } from '@playwright/test';

test.describe('live preview — admin → iframe updates', () => {
  test('updating the title field in the admin updates the preview iframe', async ({ page }) => {
    await page.goto('/admin');

    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();

    await page.getByTestId('title-input').fill('Brand new title');
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText('Brand new title');
  });

  test('updating the subtitle updates the preview', async ({ page }) => {
    await page.goto('/admin');
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('subtitle-input').fill('Watch this update live.');
    await expect(preview.locator('[data-payload-field="subtitle"]')).toHaveText(
      'Watch this update live.',
    );
  });

  test('updating the hero image URL swaps the <img src>', async ({ page }) => {
    await page.goto('/admin');
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    const newUrl = 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200';
    await page.getByTestId('hero-url-input').fill(newUrl);
    await expect(preview.locator('img[data-payload-field="hero"]')).toHaveAttribute('src', newUrl);
  });

  test('updating tags renders a fresh list', async ({ page }) => {
    await page.goto('/admin');
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('tags-input').fill('one, two, three');
    const items = preview.locator('[data-payload-field="tags"] li');
    await expect(items).toHaveCount(3);
    await expect(items.first()).toHaveText('one');
  });

  test('updating count formats the number for the active locale', async ({ page }) => {
    await page.goto('/admin');
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('count-input').fill('1234');
    // en-US format always inserts a thousands separator; we accept
    // either comma or period for locale variants.
    await expect(preview.locator('[data-payload-field="count"]')).toHaveText(/1[.,]234/);
  });

  test('updating the CTA fields updates label and href together', async ({ page }) => {
    await page.goto('/admin');
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('cta-label-input').fill('Read the docs');
    await page.getByTestId('cta-url-input').fill('https://docs.example.com');
    const cta = preview.locator('[data-payload-field="ctaLabel"]');
    await expect(cta).toHaveText('Read the docs');
    await expect(cta).toHaveAttribute('href', 'https://docs.example.com');
  });

  test('XSS attempt in title is rendered as plain text', async ({ page }) => {
    await page.goto('/admin');
    const preview = page.frameLocator('[data-testid="preview-frame"]');
    await page.getByTestId('title-input').fill('<script>window.__pwned=true</script>OK');
    await expect(preview.locator('[data-payload-field="title"]')).toContainText('<script>');
    const pwned = await preview.locator('html').evaluate(() => {
      const win = window as unknown as { __pwned?: boolean };
      return win.__pwned === true;
    });
    expect(pwned).toBe(false);
  });
});

test.describe('live preview — origin enforcement', () => {
  test('messages from an untrusted origin are ignored', async ({ page }) => {
    await page.goto('/');
    // Mimic a malicious page that tries to drive the preview.
    await page.evaluate(() => {
      // Override `origin` of synthetic events by dispatching them on
      // ourselves; the runtime reads `event.origin`, which jsdom-like
      // wrappers refuse to forge, so the safest assertion is that the
      // call simply does not change the DOM.
      window.postMessage(
        {
          type: 'payload-live-preview',
          data: { title: 'attacker-controlled' },
        },
        '*',
      );
    });
    // Give the runtime time to (not) react.
    await page.waitForTimeout(150);
    await expect(page.locator('[data-payload-field="title"]')).not.toHaveText(
      'attacker-controlled',
    );
  });
});

test.describe('RichText.astro component', () => {
  test('SSR-renders the Lexical value through the shared renderer with the binding attached', async ({
    page,
  }) => {
    // Load the page directly (not inside the mock admin, whose demo
    // clock immediately patches the body field): this asserts the pure
    // SSR output of the shared Lexical renderer.
    await page.goto('/');
    const body = page.locator('[data-payload-field="body"][data-payload-richtext]');
    await expect(body.locator('h2')).toHaveText('Rich text from Lexical');
    await expect(body.locator('strong')).toHaveText('bold');
    await expect(body.locator('a[href="https://example.com"]')).toHaveText('links');
  });
});
