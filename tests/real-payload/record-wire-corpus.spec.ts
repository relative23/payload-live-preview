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
 * The session **must cross a save**. Payload's panel fills
 * `externallyUpdatedRelationship` from `useDocumentEvents()`, which is a plain
 * `useState` set on every save and never cleared — so before the first save the
 * field is `null` in every message, and after it, it is set in every message.
 * A recording that never saves therefore holds only half the protocol, and the
 * half it misses is the one LP-1 lives in. The assertion below fails rather
 * than record that half again.
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
      // Deliberately unfiltered, and not a trust boundary: this listener is a
      // recorder. It captures what the real admin puts on the wire, and the
      // origin is part of the record rather than a condition for keeping it —
      // filtering here would discard the very evidence the corpus exists for.
      // The runtime's own listener does check the origin; that is `message-bus`.
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

    // Save, then keep typing. Everything the panel posts from here on carries
    // `externallyUpdatedRelationship` — the document's own save event, because
    // `mostRecentUpdate` is not scoped to foreign documents and is never
    // cleared. This second half is the state a real editor spends most of a
    // session in, and it was missing from every earlier recording.
    // Payload disables `#action-save` while the form is unmodified, so the
    // button going disabled again is the admin's own signal that the save
    // landed — no toast class or REST route to keep in step with its releases.
    const save = page.locator('#action-save');
    await save.click();
    await expect(save).toBeDisabled({ timeout: 30_000 });
    await page.locator('#field-title').fill('Corpus title after save');
    await expect(preview.locator('[data-payload-field="title"]')).toHaveText(
      'Corpus title after save',
    );
    await page.locator('#field-subtitle').fill('Corpus subtitle after save');
    await expect(preview.locator('[data-payload-field="subtitle"]')).toHaveText(
      'Corpus subtitle after save',
    );
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
    // The half of the protocol an unsaved session cannot show. Asserted with or
    // without `PLP_RECORD_CORPUS`, so a recorder that stops crossing the save
    // fails here instead of quietly writing a corpus that cannot see LP-1.
    const afterSave = messages.filter(
      (entry) =>
        (entry.data as { externallyUpdatedRelationship?: unknown }).externallyUpdatedRelationship !=
        null,
    );
    expect(afterSave.length).toBeGreaterThan(0);

    if (RECORD) {
      const version = payloadVersion();
      const file = `tests/fixtures/wire-corpus/payload-${version}.json`;
      await mkdir('tests/fixtures/wire-corpus', { recursive: true });
      await writeFile(
        file,
        `${JSON.stringify(
          {
            $comment:
              'Captured verbatim from a real Payload admin (examples/payload-backend) by tests/real-payload/record-wire-corpus.spec.ts. The session crosses a save, so the messages after it carry externallyUpdatedRelationship. Do not edit; re-record with PLP_RECORD_CORPUS=1.',
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
