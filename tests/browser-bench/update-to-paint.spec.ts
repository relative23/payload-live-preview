/**
 * Update-to-paint in a real browser: from the moment the Admin's message is
 * posted to the first frame painted after the bound element changed.
 *
 * The jsdom microbenchmarks in `tests/benchmarks/` time isolated hot paths.
 * None of them can say what an editor experiences, because the cost that
 * matters is the whole chain — message, debounce, resolve, transform, render,
 * layout, paint — on a page whose size is realistic. This measures that chain
 * on the 300 / 1,000 / 5,000-binding scenario pages, one changed field per
 * message, which is what a keystroke is.
 *
 * "Paint" is approximated by the first `requestAnimationFrame` callback after
 * the frame's MutationObserver saw the bound element change. That is the
 * earliest instant at which the new text can be on screen; it is not the
 * compositor's own timestamp, and the report says so.
 *
 * Trend, not gate. Each scenario is reported against the roadmap's stated
 * budget (scalar update-to-paint p95 ≤ 100 ms with the default 50 ms
 * debounce; the fixture uses 25 ms). The only assertions are that
 * measurements were taken and the page raised no errors — a shared runner's
 * timing is not a fact a pull request should fail on.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { expect, test, type Frame, type Page } from '@playwright/test';

const WARMUP = 20;
const SAMPLES = 200;
const BUDGET_P95_MS = 100;

interface Sample {
  readonly postToMutationMs: number;
  readonly postToPaintMs: number;
}

interface ScenarioReport {
  readonly bindings: number;
  readonly samples: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly mutationP95: number;
  readonly budgetP95: number;
  readonly withinBudget: boolean;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.NaN;
}

function previewFrame(page: Page): Frame | undefined {
  return page.frames().find((candidate) => candidate !== page.mainFrame());
}

async function openScenario(page: Page, count: number): Promise<Frame> {
  const path = `/scenario/${String(count)}/`;
  await page.goto(`/bench?target=${path}`);
  await expect
    .poll(() => previewFrame(page)?.url().endsWith(path) ?? false, { timeout: 15_000 })
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

/**
 * Install the probe in the frame: it records, for the bound element under
 * test, the time of the mutation and the time of the next animation frame.
 * Times are `performance.now()` in the frame's own clock; the host posts its
 * timestamp inside the message so no cross-document clock is compared —
 * same-origin frames share the time origin, and the message carries the
 * host's reading of it.
 */
async function installProbe(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const target = document.querySelector('[data-payload-field="f0"]');
    if (target === null) throw new Error('probe target missing');
    const w = window as Window & {
      __bench?: { pending: Map<string, number>; samples: Sample[] };
    };
    const state = { pending: new Map<string, number>(), samples: [] as Sample[] };
    w.__bench = state;
    // The host stashes its post time under the value it sent, so the probe can
    // pair a mutation with the message that caused it even if a flush coalesces.
    new MutationObserver(() => {
      const value = target.textContent;
      const postedAt = state.pending.get(value);
      if (postedAt === undefined) return;
      state.pending.delete(value);
      const mutationAt = performance.now();
      requestAnimationFrame(() => {
        state.samples.push({
          postToMutationMs: mutationAt - postedAt,
          postToPaintMs: performance.now() - postedAt,
        });
      });
    }).observe(target, { subtree: true, childList: true, characterData: true });
  });
}

/** Post one update from the host and register its send time with the probe. */
async function sendTimed(page: Page, value: string): Promise<void> {
  await page.evaluate((text) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="preview-frame"]');
    if (frame?.contentWindow == null) throw new Error('preview frame is unavailable');
    const w = frame.contentWindow as Window & {
      __bench?: { pending: Map<string, number> };
    };
    w.__bench?.pending.set(text, performance.now());
    frame.contentWindow.postMessage(
      { type: 'payload-live-preview', data: { f0: text } },
      window.location.origin,
    );
  }, value);
}

/** Let every already-scheduled measurement frame run before reading the samples. */
async function drainFrames(frame: Frame): Promise<void> {
  await frame.evaluate(
    async () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

async function collect(frame: Frame): Promise<Sample[]> {
  return frame.evaluate(
    () => (window as Window & { __bench?: { samples: Sample[] } }).__bench?.samples ?? [],
  );
}

const reports: ScenarioReport[] = [];

/** Registered from a plain function, not a loop — see the test policy. */
function registerScenario(count: number): void {
  test(`${String(count)} bindings: update-to-paint for one changed field`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const frame = await openScenario(page, count);
    const first = frame.locator('[data-payload-field="f0"]');
    await installProbe(frame);

    // Warm the parser, JIT and caches before measuring; the first messages on
    // a cold page are a different population.
    for (let index = 0; index < WARMUP; index += 1) {
      await sendTimed(page, `warm-${String(index)}`);
      await expect(first).toHaveText(`warm-${String(index)}`);
    }
    // A measurement lands one animation frame after the text does, and
    // `toHaveText` returns as soon as the text is there. Without draining the
    // pending frames first, the last warm-up sample is counted in the measured
    // window and the run fails with one sample too many.
    await drainFrames(frame);
    const warm = (await collect(frame)).length;

    for (let index = 0; index < SAMPLES; index += 1) {
      const value = `sample-${String(index)}`;
      await sendTimed(page, value);
      // Awaiting the DOM keeps messages from coalescing in the debounce, so
      // each sample measures one message, which is what a keystroke is.
      await expect(first).toHaveText(value);
    }

    // The same boundary at the other end: the last sample of the measured run
    // lands a frame after its text, so collecting without draining first counts
    // one too few. Both edges of the window need the same treatment.
    await drainFrames(frame);
    const samples = (await collect(frame)).slice(warm);
    expect(samples.length, 'every sample produced a measurement').toBe(SAMPLES);
    expect(errors).toEqual([]);

    const paint = samples.map((s) => s.postToPaintMs).sort((a, b) => a - b);
    const mutation = samples.map((s) => s.postToMutationMs).sort((a, b) => a - b);
    const report: ScenarioReport = {
      bindings: count,
      samples: samples.length,
      p50: percentile(paint, 50),
      p95: percentile(paint, 95),
      max: paint[paint.length - 1] ?? Number.NaN,
      mutationP95: percentile(mutation, 95),
      budgetP95: BUDGET_P95_MS,
      withinBudget: percentile(paint, 95) <= BUDGET_P95_MS,
    };
    reports.push(report);
    console.log(
      `[bench] ${String(count).padStart(5)} bindings  p50 ${report.p50.toFixed(1)} ms  ` +
        `p95 ${report.p95.toFixed(1)} ms  max ${report.max.toFixed(1)} ms  ` +
        `(mutation p95 ${report.mutationP95.toFixed(1)} ms)  ` +
        `${report.withinBudget ? 'within' : 'OVER'} the ${String(BUDGET_P95_MS)} ms p95 budget`,
    );
  });
}

registerScenario(300);
registerScenario(1_000);
registerScenario(5_000);

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    'test-results/browser-bench.json',
    `${JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        paintProxy: 'first requestAnimationFrame after the MutationObserver saw the change',
        scenarios: reports,
      },
      null,
      2,
    )}\n`,
  );
});
