import { expect, test, type Frame, type Page } from '@playwright/test';
import {
  footerInView,
  post,
  waitForPreviewFrame,
  waitForStarted,
  type RuntimeHandle,
} from '../helpers/preview';

/**
 * Reveal the edited section, on every delivery path we ship. Each fixture serves
 * the same page — `heroTitle` on top, `footer` below a 2,200px spacer — so one
 * table drives them all: patch a visible binding, then prove an edit to the
 * off-screen one scrolls it in. The pure guards are unit-tested; this is the
 * real scrollIntoView and layout in Chromium, Firefox and WebKit.
 */

interface RevealTarget {
  readonly name: string;
  /** The PLP_E2E_SERVERS fixture this row needs. */
  readonly server: string;
  /** Relative admin URLs resolve against baseURL, which is the astro fixture. */
  readonly admin: string;
  readonly path: string;
  /** Set when the admin frames a fixed page and has no `?target=`. */
  readonly frameSrc?: string;
  readonly handle: RuntimeHandle;
  /** SPA hydration can re-render and revert an applied value. */
  readonly hydrationWaitMs?: number;
}

const TARGETS: readonly RevealTarget[] = [
  {
    name: 'pure-html — inline runtime, no framework',
    server: 'pure-html',
    admin: 'http://localhost:4180/admin.html',
    path: '/reveal.html',
    handle: '__livePreview',
  },
  {
    name: 'vanilla-client — the /client npm import',
    server: 'vanilla-client',
    admin: 'http://localhost:4181/admin.html',
    path: '/reveal.html',
    handle: '__lpClient',
  },
  {
    name: 'astro — loader delivery',
    server: 'astro',
    admin: '/bench',
    path: '/reveal/',
    handle: '__livePreview',
  },
  {
    name: 'astro — inline delivery',
    server: 'astro-inline',
    admin: 'http://localhost:4182/admin/',
    path: '/reveal/',
    handle: '__livePreview',
  },
  {
    // Middleware injection is gated on preview intent, which this fixture
    // signals with a query parameter, so the framed path carries it.
    name: 'astro — middleware delivery',
    server: 'astro-middleware',
    admin: 'http://localhost:4183/admin',
    path: '/reveal?preview=true',
    handle: '__livePreview',
  },
  {
    name: 'nextjs — inline delivery, React',
    server: 'nextjs',
    admin: 'http://localhost:4174/admin.html',
    path: '/reveal',
    frameSrc: '/reveal',
    handle: '__livePreview',
    // React hydrates after the runtime starts. On a slow runner it lands
    // between the reveal and the assertion and resets the scroll position,
    // which reads as "the reveal did not happen". Same reason as Nuxt below.
    hydrationWaitMs: 800,
  },
  {
    name: 'nuxt — inline delivery, Vue',
    server: 'nuxt',
    admin: 'http://localhost:4176/admin.html',
    path: '/reveal',
    frameSrc: '/reveal',
    handle: '__livePreview',
    hydrationWaitMs: 800,
  },
];

const PATCHED_HERO = 'Patched hero';
const BASELINE = 'baseline footer';
const EDITED = 'edited footer';
const RETRY = { timeout: 15_000 };

function bound(page: Page, testId: string) {
  return page.frameLocator('[data-testid="preview-frame"]').getByTestId(testId);
}

async function openReveal(page: Page, target: RevealTarget): Promise<Frame> {
  const admin =
    target.frameSrc === undefined
      ? `${target.admin}?target=${encodeURIComponent(target.path)}`
      : target.admin;
  await page.goto(admin);
  if (target.frameSrc !== undefined) {
    await page.evaluate((src) => {
      const iframe = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
      if (iframe) iframe.src = src;
    }, target.frameSrc);
  }

  const frame = await waitForPreviewFrame(page, target.frameSrc ?? target.path);
  await waitForStarted(frame, target.handle);
  if (target.hydrationWaitMs !== undefined) await page.waitForTimeout(target.hydrationWaitMs);
  return frame;
}

/**
 * WebKit can drop the first postMessage after the runtime starts, so every post
 * is retried until its value lands. Confirming the baseline before the edit also
 * keeps the two messages out of one debounce window — coalesced, they would read
 * as a single baseline and never scroll.
 */
async function apply(
  page: Page,
  fields: Record<string, string>,
  testId: string,
  expected: string,
): Promise<void> {
  await expect(async () => {
    await post(page, fields);
    await expect(bound(page, testId)).toHaveText(expected, { timeout: 2_000 });
  }).toPass(RETRY);
}

function registerTarget(target: RevealTarget): void {
  test.describe(`reveal — ${target.name}`, () => {
    test('patches a bound field', async ({ page }) => {
      await openReveal(page, target);
      await apply(page, { heroTitle: PATCHED_HERO, footer: BASELINE }, 'hero', PATCHED_HERO);
    });

    test('editing an off-screen field scrolls it into view', async ({ page }) => {
      const frame = await openReveal(page, target);
      await apply(page, { heroTitle: 'Top', footer: BASELINE }, 'footer', BASELINE);
      expect(await footerInView(frame), 'footer starts below the fold').toBe(false);

      await apply(page, { heroTitle: 'Top', footer: EDITED }, 'footer', EDITED);
      await expect.poll(() => footerInView(frame), { timeout: 5_000 }).toBe(true);
    });
  });
}

registerTarget(TARGETS[0]!);
registerTarget(TARGETS[1]!);
registerTarget(TARGETS[2]!);
registerTarget(TARGETS[3]!);
registerTarget(TARGETS[4]!);
registerTarget(TARGETS[5]!);
registerTarget(TARGETS[6]!);
