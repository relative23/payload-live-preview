import { expect, test, type CDPSession, type Page } from '@playwright/test';

const BATCH_SIZE = 1_000;
const MINIMUM_UPDATES = 10_000;
const DEFAULT_HEAP_BUDGET_BYTES = 8 * 1024 * 1024;

function positiveInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function sendBatch(page: Page, start: number, count: number): Promise<string> {
  const finalTitle = `soak-${String(start + count - 1)}`;
  await page.evaluate(
    ({ first, size, currentTitle }) => {
      const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
      if (frame?.contentWindow == null) throw new Error('preview frame is unavailable');
      const titleInput = document.querySelector<HTMLInputElement>('[data-testid="title-input"]');
      if (titleInput === null) throw new Error('mock admin title input is unavailable');

      // The throughput path bypasses input events, but a startup ready retry
      // makes the mock admin replay its form state. Keep that authoritative
      // state aligned with the newest direct message, as real Payload does.
      titleInput.value = currentTitle;
      for (let offset = 0; offset < size; offset += 1) {
        frame.contentWindow.postMessage(
          {
            type: 'payload-live-preview',
            data: { title: `soak-${String(first + offset)}` },
          },
          window.location.origin,
        );
      }
    },
    { first: start, size: count, currentTitle: finalTitle },
  );
  return finalTitle;
}

async function readHeap(session: CDPSession): Promise<number> {
  await session.send('HeapProfiler.collectGarbage');
  const { metrics } = await session.send('Performance.getMetrics');
  const heap = metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value;
  if (heap === undefined) throw new Error('Chromium did not expose JSHeapUsedSize');
  return heap;
}

async function requestReadyRetry(page: Page): Promise<string> {
  const previewFrame = page.frames().find((frame) => frame.parentFrame() === page.mainFrame());
  if (previewFrame === undefined) throw new Error('preview frame is unavailable');

  return previewFrame.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener('message', onMessage);
          reject(new Error('mock admin did not answer the ready retry'));
        }, 5_000);
        const onMessage = (event: MessageEvent) => {
          const message = event.data as {
            readonly type?: unknown;
            readonly data?: { readonly title?: unknown };
          };
          if (
            event.origin !== window.location.origin ||
            message.type !== 'payload-live-preview' ||
            typeof message.data?.title !== 'string'
          ) {
            return;
          }
          window.clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          resolve(message.data.title);
        };
        window.addEventListener('message', onMessage);
        window.parent.postMessage(
          { type: 'payload-live-preview', ready: true, protocolVersion: 4 },
          window.location.origin,
        );
      }),
  );
}

test('10k updates and optional long session keep latest-write and heap invariants', async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/admin');
  const preview = page.frameLocator('[data-testid="preview-frame"]');
  const title = preview.locator('[data-payload-field="title"]');
  await expect(title).toBeVisible();

  // Warm parser/JIT/caches before establishing the retained-heap baseline.
  const warmTitle = await sendBatch(page, 0, 100);
  await expect(title).toHaveText(warmTitle);

  // Ready is retried during startup. The mock admin must answer with the same
  // current form state that the update stream represents, just like Payload.
  const retryTitle = await requestReadyRetry(page);
  expect(retryTitle).toBe(warmTitle);
  await expect(title).toHaveText(warmTitle);

  const session = await context.newCDPSession(page);
  await session.send('Performance.enable');
  const baselineHeap = await readHeap(session);

  const durationMs = positiveInteger('PLP_SOAK_DURATION_MS', 0);
  const heapBudget = positiveInteger('PLP_BROWSER_HEAP_BUDGET_BYTES', DEFAULT_HEAP_BUDGET_BYTES);
  const deadline = durationMs > 0 ? Date.now() + durationMs : 0;
  let updateCount = 0;
  let finalTitle: string;

  do {
    finalTitle = await sendBatch(page, 100 + updateCount, BATCH_SIZE);
    updateCount += BATCH_SIZE;
    await expect(title).toHaveText(finalTitle);
  } while (updateCount < MINIMUM_UPDATES || (deadline > 0 && Date.now() < deadline));

  // A stale delayed write must not appear after the newest batch settled.
  await page.waitForTimeout(250);
  await expect(title).toHaveText(finalTitle);
  expect(errors).toEqual([]);

  const finalHeap = await readHeap(session);
  const retainedBytes = finalHeap - baselineHeap;
  const metrics = { updateCount, baselineHeap, finalHeap, retainedBytes };
  testInfo.annotations.push({
    type: 'soak',
    description: JSON.stringify(metrics),
  });
  console.info(`[soak] ${JSON.stringify(metrics)}`);
  expect(retainedBytes).toBeLessThan(heapBudget);
});
