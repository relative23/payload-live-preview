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
    ({ first, size }) => {
      const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
      if (frame?.contentWindow == null) throw new Error('preview frame is unavailable');
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
    { first: start, size: count },
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
