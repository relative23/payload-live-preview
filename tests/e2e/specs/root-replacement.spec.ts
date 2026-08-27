import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Root replacement and client handover (F-36, roadmap 1.4.0). Proven in the
 * browser on the Astro fixture's `/island/` page framed by `/bench`:
 *
 * - the test really swaps `document.body`, and bindings in the new body are
 *   patched by the running runtime;
 * - the page's inline script is executed a second time. On this fixture
 *   that is the static-delivery loader, so the re-run appends the runtime
 *   file again and the test waits for it to load. Unchanged, the instance
 *   stays; with a different configuration, a new instance takes over, the
 *   old one is destroyed, and updates keep arriving.
 */

const PATH = '/island/';
const HANDOVER_ORIGIN = 'https://handover.example';

interface Api {
  inspect: () => { started: boolean; bindings: { elements: number } };
  enumerateOrigins: () => readonly string[];
  configSignature?: string;
}
type PreviewWindow = Window & { __livePreview?: Api; __first?: Api; __reran?: number };

function previewFrame(page: Page): Frame | undefined {
  return page.frames().find((candidate) => candidate !== page.mainFrame());
}

async function started(frame: Frame): Promise<boolean> {
  return frame.evaluate(() => (window as PreviewWindow).__livePreview?.inspect().started ?? false);
}

async function open(page: Page): Promise<Frame> {
  await page.goto(`/bench?target=${PATH}`);
  await expect
    .poll(() => previewFrame(page)?.url().endsWith(PATH) ?? false, { timeout: 15_000 })
    .toBe(true);
  const frame = previewFrame(page);
  if (!frame) throw new Error('preview frame missing');
  await expect.poll(() => started(frame), { timeout: 15_000 }).toBe(true);
  return frame;
}

async function post(page: Page, fields: Record<string, unknown>): Promise<void> {
  await page.evaluate((data) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    frame?.contentWindow?.postMessage(
      { type: 'payload-live-preview', data, globalSlug: 'homepage' },
      window.location.origin,
    );
  }, fields);
}

/**
 * Run the page's own inline script again, the way a soft navigation that
 * re-executes the document's scripts would. `origin` prepends an origin to
 * the baked configuration so the second run differs from the first.
 */
async function rerunInlineScript(frame: Frame, origin?: string): Promise<void> {
  await frame.evaluate(async (extraOrigin) => {
    const marker = 'var __LIVE_PREVIEW_CONFIG__=[';
    const inline = [...document.scripts].find((script) => script.textContent.includes(marker));
    if (!inline) throw new Error('inline runtime script not found');
    let text = inline.textContent;
    if (extraOrigin !== undefined) {
      const slot = `${marker}[`;
      if (!text.includes(slot)) {
        throw new Error('baked configuration does not start with an origin list');
      }
      text = text.replace(slot, `${slot}${JSON.stringify(extraOrigin)},`);
    }
    const before = new Set(document.scripts);
    const script = document.createElement('script');
    if (inline.nonce !== undefined) script.nonce = inline.nonce;
    script.textContent = `${text};window.__reran = (window.__reran ?? 0) + 1;`;
    document.head.append(script);
    script.remove();
    // The static-delivery loader appends the runtime file; wait until it ran.
    const appended = [...document.scripts].find(
      (candidate) => !before.has(candidate) && candidate.src !== '',
    );
    if (appended) {
      await new Promise<void>((resolve, reject) => {
        appended.addEventListener('load', () => {
          resolve();
        });
        appended.addEventListener('error', () => {
          reject(new Error(`runtime file failed to load: ${appended.src}`));
        });
      });
    }
  }, origin);
  const reran = await frame.evaluate(() => (window as PreviewWindow).__reran ?? 0);
  if (reran === 0) throw new Error('the injected inline script did not execute');
}

test.describe('root replacement and handover', () => {
  test('bindings in a replaced document.body are patched', async ({ page }) => {
    const frame = await open(page);
    await post(page, { title: 'Before' });
    await expect(frame.getByTestId('outside')).toHaveText('Before');

    await frame.evaluate(() => {
      const next = document.createElement('body');
      next.innerHTML =
        '<h1 data-payload-field="title" data-testid="swapped">Swapped shell</h1>' +
        '<p data-payload-field="lede" data-testid="lede"></p>';
      document.body = next;
    });
    await expect
      .poll(() =>
        frame.evaluate(() => (window as PreviewWindow).__livePreview?.inspect().bindings.elements),
      )
      .toBe(2);

    await post(page, { title: 'After the swap', lede: 'Still live' });
    await expect(frame.getByTestId('swapped')).toHaveText('After the swap');
    await expect(frame.getByTestId('lede')).toHaveText('Still live');
    expect(await started(frame)).toBe(true);
  });

  test('re-running the inline script keeps the instance; a changed configuration hands over', async ({
    page,
  }) => {
    const frame = await open(page);
    await frame.evaluate(() => {
      const w = window as PreviewWindow;
      if (w.__livePreview !== undefined) w.__first = w.__livePreview;
    });

    await rerunInlineScript(frame);
    expect(
      await frame.evaluate(() => {
        const w = window as PreviewWindow;
        return w.__livePreview === w.__first;
      }),
    ).toBe(true);

    await rerunInlineScript(frame, HANDOVER_ORIGIN);
    const state = await frame.evaluate(() => {
      const w = window as PreviewWindow;
      return {
        same: w.__livePreview === w.__first,
        firstStarted: w.__first?.inspect().started,
        secondStarted: w.__livePreview?.inspect().started,
        origins: w.__livePreview?.enumerateOrigins() ?? [],
        signatureChanged: w.__livePreview?.configSignature !== w.__first?.configSignature,
      };
    });
    expect(state.same).toBe(false);
    expect(state.firstStarted).toBe(false);
    expect(state.secondStarted).toBe(true);
    expect(state.signatureChanged).toBe(true);
    expect(state.origins).toContain(HANDOVER_ORIGIN);

    await post(page, { title: 'After handover' });
    await expect(frame.getByTestId('outside')).toHaveText('After handover');
    await expect(frame.getByTestId('inside')).toHaveText('island: After handover');
  });
});
