import { expect, test, type Frame, type Page } from '@playwright/test';
import { post, waitForPreviewFrame, waitForStarted } from '../helpers/preview';

/**
 * Island interoperability (roadmap 1.3.0): a binding inside a hydrated
 * island is never patched by the runtime; the island receives every update
 * as a `payload-live-preview:update` event and re-renders itself. Proven
 * in three browsers on the Astro fixture's `/island/` page, framed by `/bench`.
 */

const PATH = '/island/';
const OWNER = { globalSlug: 'homepage' };

async function open(page: Page): Promise<Frame> {
  await page.goto(`/bench?target=${PATH}`);
  const frame = await waitForPreviewFrame(page, PATH);
  await waitForStarted(frame);
  return frame;
}

test.describe('island bridge', () => {
  test('the runtime patches outside the island and the island rerenders itself from the event', async ({
    page,
  }) => {
    const frame = await open(page);
    await post(page, { title: 'First' }, OWNER);
    await expect(frame.getByTestId('outside')).toHaveText('First');
    await expect(frame.getByTestId('inside')).toHaveText('island: First');
    await expect(frame.getByTestId('renders')).toHaveText('1');

    await post(page, { title: 'Second' }, OWNER);
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
