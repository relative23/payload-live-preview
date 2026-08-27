import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Records the wire corpus (roadmap 1.8.0): every message the REAL Payload
 * admin posts into the preview iframe while an editor types, edits rich
 * text, adds an array row and saves. The capture is checked in under
 * `tests/fixtures/wire-corpus/payload-<version>.json` and replayed by
 * `tests/integration/wire-corpus.test.ts`; the protocol watch compares the
 * latest official client against it.
 *
 * Runs only with `PLP_RECORD_CORPUS=1` — it writes a file. Without the
 * flag it still runs and asserts the capture would be non-empty, so the
 * recorder itself cannot silently rot.
 */

const PORT = process.env['PLP_E2E_PORT'] ?? '4173';
const PREVIEW_IFRAME = `iframe[src*="localhost:${PORT}"]`;
const RECORD = process.env['PLP_RECORD_CORPUS'] === '1';

interface Captured {
  readonly origin: string;
  readonly data: unknown;
}

function previewFrame(page: Page): Frame | undefined {
  return page.frames().find((frame) => frame.url().includes(`localhost:${PORT}`));
}

function payloadVersion(): string {
  // The backend fixture pins Payload exactly; read the pin rather than the
  // installed package, so this file references no module of its own.
  const manifest = JSON.parse(readFileSync('examples/payload-backend/package.json', 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const pinned = manifest.dependencies['payload'];
  if (pinned === undefined) throw new Error('examples/payload-backend does not pin payload');
  return pinned.replace(/^[\^~]/u, '');
}

test.describe('wire corpus', () => {
  test('captures what the admin posts while editing, and writes it as a fixture', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      const w = window as Window & { __wireCorpus?: Captured[] };
      w.__wireCorpus = [];
      window.addEventListener('message', (event) => {
        w.__wireCorpus?.push({ origin: event.origin, data: event.data as unknown });
      });
    });
    await page.goto('/admin/globals/homepage');
    await expect(page.locator('#field-title')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const panel = page.locator('.live-preview-window');
    const isOpen = async (): Promise<boolean> =>
      panel.evaluate((el) => el instanceof HTMLElement && el.offsetWidth > 0).catch(() => false);
    if (!(await isOpen())) {
      await page.locator('.live-preview-toggler').click();
      await expect.poll(isOpen, { timeout: 15_000 }).toBe(true);
    }
    await expect(page.locator(PREVIEW_IFRAME)).toBeVisible({ timeout: 30_000 });
    const preview = page.frameLocator(PREVIEW_IFRAME);
    await expect(preview.locator('[data-payload-field="title"]')).toBeVisible();

    // Scalar text, twice, so the corpus holds consecutive updates.
    await page.locator('#field-title').fill('Corpus title');
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText('Corpus title');
    await page.locator('#field-subtitle').fill('Corpus subtitle');
    await expect(preview.locator('[data-payload-field="subtitle"]')).toHaveText('Corpus subtitle');
    // Rich text: the Lexical editor's contenteditable.
    const editor = page.locator('#field-body [contenteditable="true"]').first();
    if (await editor.isVisible().catch(() => false)) {
      await editor.click();
      await editor.pressSequentially('Corpus body paragraph.');
    }
    // Array: add a row and fill it.
    const addRow = page.locator('#field-tags button', { hasText: /add/iu }).first();
    if (await addRow.isVisible().catch(() => false)) {
      await addRow.click();
      const label = page
        .locator('[id^="field-tags__"][id$="__label"], #field-tags-0-label')
        .first();
      if (await label.isVisible().catch(() => false)) await label.fill('corpus-tag');
    }
    // Let the admin flush its debounced posts.
    await page.waitForTimeout(1_500);

    const frame = previewFrame(page);
    if (!frame) throw new Error('preview frame missing');
    const captured = await frame.evaluate(
      () => (window as Window & { __wireCorpus?: Captured[] }).__wireCorpus ?? [],
    );
    const messages = captured.filter(
      (entry) =>
        typeof entry.data === 'object' &&
        entry.data !== null &&
        typeof (entry.data as { type?: unknown }).type === 'string' &&
        (entry.data as { type: string }).type.startsWith('payload-'),
    );
    expect(messages.length).toBeGreaterThan(2);
    const types = new Set(messages.map((entry) => (entry.data as { type: string }).type));
    expect(types).toContain('payload-live-preview');

    if (RECORD) {
      const version = payloadVersion();
      const file = `tests/fixtures/wire-corpus/payload-${version}.json`;
      await mkdir('tests/fixtures/wire-corpus', { recursive: true });
      await writeFile(
        file,
        `${JSON.stringify(
          {
            $comment:
              'Captured verbatim from a real Payload admin (examples/payload-backend) by tests/real-payload/record-wire-corpus.spec.ts. Do not edit; re-record with PLP_RECORD_CORPUS=1.',
            payload: version,
            capturedAt: new Date().toISOString().slice(0, 10),
            adminOrigin: messages[0]?.origin,
            messages: messages.map((entry) => entry.data),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    }
  });
});
