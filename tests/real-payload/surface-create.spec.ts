/**
 * The real Payload admin decides whether a collection document has a Live Preview while it is being
 * created, and these journeys ask it: the create screen is opened, its real fields are typed into,
 * and neither the toggle nor the frame appears. After the first save both do, the frame shows the
 * saved document, and the editor's unsaved edits reach it while REST reads show that the collection
 * still holds only what was saved. `playwright.real-payload.config.ts` starts the SvelteKit example
 * and an admin that has the two collections (`create`).
 */
import { expect, test, type FrameLocator, type Page } from '@playwright/test';

const PORT = process.env['PLP_REAL_PAYLOAD_PORT'] ?? '4475';
const ADMIN_ORIGIN = 'http://localhost:3001';
const PREVIEW_ORIGIN = `http://localhost:${PORT}`;
const PREVIEW_IFRAME = `iframe[src^="${PREVIEW_ORIGIN}/"]`;
/** For waits that depend on a dev server compiling a screen or a page on its first visit; the other real-admin specs give a frame as long. */
const COLD = { timeout: 60_000 } as const;

/** What the preview page was sent by the admin, as the page's own `message` listener saw it. */
interface AdminMessage {
  readonly collectionSlug: string | null;
  readonly id: number | string | null;
  readonly title: string | null;
  readonly subtitle: string | null;
}

/** What differs between the two ways a collection gets its preview URL; the journey is the same. */
interface Subject {
  readonly collection: string;
  readonly label: string;
  /** Where the preview URL points once the document is saved. */
  readonly path: (id: number) => string;
  /** The owner marker the preview page puts on the saved document. */
  readonly owner: (id: number) => string;
}

/** The plugin's function routes it, and the function needs the saved document's id. */
const MAPPED: Subject = {
  collection: 'mapped-pages',
  label: 'Mapped',
  path: (id) => `/mapped/${String(id)}`,
  owner: (id) => `collection:mapped-pages:${String(id)}`,
};

/** Payload's own option holds a fixed string: no id in the path, so the owner is the collection. */
const MANUAL: Subject = {
  collection: 'manual-pages',
  label: 'Manual',
  path: () => '/manual',
  owner: () => 'collection:manual-pages',
};

/** The editor signs in through the real login form: the preview site verifies the session it issues. */
async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.locator('#field-email').fill('e2e@example.com');
  await page.locator('#field-password').fill('test1234');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin(?!\/login)/u);
}

/**
 * Records what the admin posts to a framed page, from the frame's end. The frame is the only place
 * that can tell what reached it, so the listener checks the sender the way the runtime does: the
 * admin's origin and the window that framed the page.
 */
async function recordAdminMessages(page: Page): Promise<void> {
  await page.addInitScript((adminOrigin: string) => {
    if (window === window.top) return;
    const seen: AdminMessage[] = [];
    (window as Window & { __createStateWire?: AdminMessage[] }).__createStateWire = seen;
    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.origin !== adminOrigin || event.source !== window.parent) return;
      const message = event.data as {
        type?: unknown;
        collectionSlug?: unknown;
        data?: Record<string, unknown>;
      } | null;
      if (message?.type !== 'payload-live-preview' || message.data === undefined) return;
      const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
      const id = message.data['id'];
      seen.push({
        collectionSlug: text(message.collectionSlug),
        id: typeof id === 'number' || typeof id === 'string' ? id : null,
        title: text(message.data['title']),
        subtitle: text(message.data['subtitle']),
      });
    });
  }, ADMIN_ORIGIN);
}

/** The messages the frame has heard; `[]` while a read lands in a navigation of the frame. */
function adminMessages(preview: FrameLocator): () => Promise<readonly AdminMessage[]> {
  return () =>
    preview
      .locator('body')
      .evaluate(
        () => (window as Window & { __createStateWire?: AdminMessage[] }).__createStateWire ?? [],
      )
      .catch(() => []);
}

/**
 * Payload's form says itself when it is ready: mounted, initialized and not processing. That is the
 * state a keystroke needs, and a quiet network does not tell it.
 */
async function documentFormReady(page: Page): Promise<void> {
  const form = page.locator('form').filter({ has: page.locator('#field-title') });
  await expect(form).toHaveAttribute('data-form-ready', 'true', COLD);
  await expect(page.locator('#field-title')).toBeEditable();
  await expect(page.locator('#field-subtitle')).toBeEditable();
}

/**
 * The document controls are on screen (the Save button is one of them) and the toggle, the panel and
 * the frame are not: the toggle belongs to the same controls, so it cannot be late.
 */
async function expectNoPreview(page: Page): Promise<void> {
  await expect(page.locator('#action-save')).toBeVisible();
  await expect(page.locator('.live-preview-toggler')).toHaveCount(0);
  await expect(page.locator('.live-preview-window')).toHaveCount(0);
  await expect(page.locator(PREVIEW_IFRAME)).toHaveCount(0);
}

/** The Live Preview panel open and the runtime in its frame started: the admin's next message is one it hears. */
async function openPreview(page: Page): Promise<FrameLocator> {
  // The toggle is a per-user preference and may already be open.
  const panel = page.locator('.live-preview-window');
  const isOpen = async (): Promise<boolean> =>
    panel.evaluate((el) => el instanceof HTMLElement && el.offsetWidth > 0).catch(() => false);
  if (!(await isOpen())) {
    await page.locator('.live-preview-toggler').click();
    await expect.poll(isOpen, { timeout: 15_000 }).toBe(true);
  }
  await expect(page.locator(PREVIEW_IFRAME)).toBeVisible(COLD);
  const preview = page.frameLocator(PREVIEW_IFRAME);
  // A read that lands while the frame navigates loses its context: that is "not yet".
  await expect
    .poll(
      () =>
        preview
          .locator('body')
          .evaluate(
            () =>
              (
                window as Window & { __livePreview?: { inspect(): { started: boolean } } }
              ).__livePreview?.inspect().started === true,
          )
          .catch(() => false),
      COLD,
    )
    .toBe(true);
  return preview;
}

interface Documents {
  readonly totalDocs: number;
  readonly docs: readonly { id: number; title: string; subtitle?: string }[];
}

/** The documents of a collection with this title, as REST answers the signed-in editor. */
async function documentsTitled(page: Page, collection: string, title: string): Promise<Documents> {
  const query = new URLSearchParams({
    'where[title][equals]': title,
    depth: '0',
    limit: '10',
  });
  const response = await page.request.get(`/api/${collection}?${query.toString()}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Documents;
}

/**
 * One journey: the create screen without a preview, the first save, then the edit screen with one.
 * The stamp keeps the titles of two runs apart in a database that outlives them.
 */
async function createThenEdit(page: Page, browser: string, subject: Subject): Promise<void> {
  const stamp = `${browser} ${String(Date.now())}`;
  const saved = {
    title: `${subject.label} saved title ${stamp}`,
    subtitle: 'Saved subtitle',
  };
  const typed = {
    title: `${subject.label} unsaved title ${stamp}`,
    subtitle: 'Unsaved subtitle',
  };

  await signIn(page);
  await recordAdminMessages(page);

  // The toggle is decided when the screen renders, so it has to be absent after typing as well as before.
  await page.goto(`/admin/collections/${subject.collection}/create`);
  await expect(page.locator('#field-title')).toBeVisible(COLD);
  await documentFormReady(page);
  await expectNoPreview(page);
  await page.locator('#field-title').fill(saved.title);
  await page.locator('#field-subtitle').fill(saved.subtitle);
  await page.locator('#field-subtitle').blur();
  await documentFormReady(page);
  await expect(page).toHaveURL(new RegExp(`/${subject.collection}/create$`, 'u'));
  await expectNoPreview(page);
  expect((await documentsTitled(page, subject.collection, saved.title)).totalDocs).toBe(0);

  // The server assigns the id, and the frame's URL and the owner marker are built from it.
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/${subject.collection}` &&
      response.request().method() === 'POST',
  );
  await page.locator('#action-save').click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { doc } = (await response.json()) as { doc: { id: number } };
  expect(doc.id).toBeGreaterThan(0);
  await expect(page).toHaveURL(
    new RegExp(`/admin/collections/${subject.collection}/${String(doc.id)}(?:\\?.*)?$`, 'u'),
    COLD,
  );

  // The save is the only write the journey makes. From here the frame is the editor's view of the
  // document, and the page claims the document with its owner marker.
  await expect(page.locator('.live-preview-toggler')).toBeVisible(COLD);
  await documentFormReady(page);
  await expect(page.locator('#field-title')).toHaveValue(saved.title);
  await expect(page.locator('#field-subtitle')).toHaveValue(saved.subtitle);
  const preview = await openPreview(page);
  await expect(page.locator(PREVIEW_IFRAME)).toHaveAttribute(
    'src',
    `${PREVIEW_ORIGIN}${subject.path(doc.id)}?preview=true`,
  );
  await expect(preview.getByTestId('document')).toHaveAttribute(
    'data-payload-owner',
    subject.owner(doc.id),
    COLD,
  );
  await expect(preview.getByTestId('title')).toHaveText(saved.title, COLD);
  await expect(preview.getByTestId('subtitle')).toHaveText(saved.subtitle, COLD);

  // The page's text is static, so only the admin's messages can change it; the reads show that
  // those messages are not saves.
  await page.locator('#field-title').fill(typed.title);
  await page.locator('#field-subtitle').fill(typed.subtitle);
  await expect(preview.getByTestId('title')).toHaveText(typed.title);
  await expect(preview.getByTestId('subtitle')).toHaveText(typed.subtitle);
  const stored = await documentsTitled(page, subject.collection, saved.title);
  expect(stored.totalDocs).toBe(1);
  expect(stored.docs[0]).toMatchObject({
    id: doc.id,
    title: saved.title,
    subtitle: saved.subtitle,
  });
  expect((await documentsTitled(page, subject.collection, typed.title)).totalDocs).toBe(0);
  // Owner scoping relies on the message naming the collection and the document.
  await expect.poll(adminMessages(preview)).toContainEqual({
    collectionSlug: subject.collection,
    id: doc.id,
    title: typed.title,
    subtitle: typed.subtitle,
  });
}

test.describe('real Payload admin → collection documents in their create state', () => {
  // The first test of a run also pays for the cold compiles of the create screen, the edit screen and the preview page.
  test.describe.configure({ timeout: 120_000 });

  test('a collection the plugin routes by function has no preview while its document is created, and takes unsaved edits after the first save', async ({
    page,
  }, testInfo) => {
    await createThenEdit(page, testInfo.project.name, MAPPED);
  });

  test('a collection with a fixed string URL has no preview while its document is created either, and takes unsaved edits after the first save', async ({
    page,
  }, testInfo) => {
    await createThenEdit(page, testInfo.project.name, MANUAL);
  });
});
