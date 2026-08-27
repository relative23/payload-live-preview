import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Island interoperability (roadmap 1.3.0): a binding inside a hydrated
 * island is never patched by the runtime; the island receives every update
 * as a `payload-live-preview:update` event and re-renders itself. Proven
 * in three browsers on the Astro fixture's `/island/` page, framed by `/bench`.
 */

const PATH = '/island/';

function previewFrame(page: Page): Frame | undefined {
  return page.frames().find((candidate) => candidate !== page.mainFrame());
}

async function open(page: Page): Promise<Frame> {
  await page.goto(`/bench?target=${PATH}`);
  await expect
    .poll(() => previewFrame(page)?.url().endsWith(PATH) ?? false, { timeout: 15_000 })
    .toBe(true);
  const frame = previewFrame(page);
  if (!frame) throw new Error('preview frame missing');
  await expect
    .poll(
      async () =>
        (await frame.evaluate(
          () =>
            (
              window as Window & { __livePreview?: { inspect: () => { started: boolean } } }
            ).__livePreview?.inspect().started,
        )) ?? false,
      { timeout: 15_000 },
    )
    .toBe(true);
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

test.describe('island bridge', () => {
  test('the runtime patches outside the island and the island rerenders itself from the event', async ({
    page,
  }) => {
    const frame = await open(page);
    await post(page, { title: 'First' });
    await expect(frame.getByTestId('outside')).toHaveText('First');
    await expect(frame.getByTestId('inside')).toHaveText('island: First');
    await expect(frame.getByTestId('renders')).toHaveText('1');

    await post(page, { title: 'Second' });
    await expect(frame.getByTestId('outside')).toHaveText('Second');
    await expect(frame.getByTestId('inside')).toHaveText('island: Second');
    await expect(frame.getByTestId('renders')).toHaveText('2');

    // The inner binding was never a runtime binding.
    const bindings = await frame.evaluate(
      () =>
        (
          window as Window & {
            __livePreview?: { inspect: () => { bindings: { elements: number } } };
          }
        ).__livePreview?.inspect().bindings.elements,
    );
    expect(bindings).toBe(1);
  });
});
