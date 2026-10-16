/**
 * An oversized body as the page's own fetch sees it, in each engine. The runtime
 * treats a 413, a 502 and a network error alike (LP0801, then the boundary is
 * patched). What is held here: none of them looks like success, none is a mistake
 * of the setup (a 403 or 404), none leaves the page waiting, and the request
 * after an oversized one is not held up by it. A host that refuses from some size
 * up whole is held to a 413 every time from there. The counts of every run are
 * attached to its test.
 */
import { expect, test, type Page } from '@playwright/test';

const CREDENTIAL = process.env['PLP_LIFETIME_PROBE_KEY'];
if (!CREDENTIAL) {
  throw new Error(
    'Use playwright.fragment-hosts.config.ts or playwright.fragment-lifetime.config.ts with the engines named.',
  );
}
const WHOLE_FROM = Number(process.env['PLP_HOST_REFUSES_WHOLE_FROM'] ?? 'Infinity');
// The probe keeps 256 observations for a minute; every request that reaches it takes one.
const ATTEMPTS = 10;
// A 429 is the probe refusing a browser's automatic retry (same id) of a request
// whose first attempt it had already seen: the connection died before the answer.
const FAILURES = new Set(['413', '429', '502', '503', '504', 'network-error']);
const PROMPT_MS = 3_000;
const SIZES = [90_000, 300_000, 2_000_000] as const;

interface Sent {
  readonly outcome: string;
  readonly ms: number;
}

/** POSTs bodies of the given sizes in turn from the page; one outcome and time each. */
function send(page: Page, sizes: readonly number[]): Promise<Sent[]> {
  return page.evaluate(
    async ({ list, key }) => {
      const sent: { outcome: string; ms: number }[] = [];
      for (const size of list) {
        const body = JSON.stringify({
          fragment: 'probe',
          route: '/lifetime-page',
          search: '',
          revision: 7,
          fields: { pad: 'x'.repeat(size) },
        });
        const started = performance.now();
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
        }, 6_000);
        let outcome: string;
        try {
          const response = await fetch(`/payload/lifetime-probe?id=${crypto.randomUUID()}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-plp-probe-key': key },
            body,
            signal: controller.signal,
          });
          outcome = String(response.status);
        } catch (error) {
          outcome = (error as Error).name === 'AbortError' ? 'stalled' : 'network-error';
        }
        clearTimeout(timer);
        sent.push({ outcome, ms: Math.round(performance.now() - started) });
      }
      return sent;
    },
    { list: sizes, key: CREDENTIAL! },
  );
}

function tally(sent: readonly Sent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { outcome } of sent) counts[outcome] = (counts[outcome] ?? 0) + 1;
  return counts;
}

test.beforeEach(async ({ page, baseURL }) => {
  await page.goto(`${baseURL!}${process.env['PLP_PAGE_PATH'] ?? '/healthz'}`);
});

test('a request within the limit is answered 200 from the page', async ({ page }) => {
  expect(tally(await send(page, Array<number>(ATTEMPTS).fill(100)))).toEqual({ '200': ATTEMPTS });
});

SIZES.forEach((bytes) => {
  test(`${String(bytes / 1000)} kB from the page is refused, never accepted`, async ({
    page,
  }, testInfo) => {
    const counts = tally(await send(page, Array<number>(ATTEMPTS).fill(bytes)));
    testInfo.annotations.push({ type: 'outcomes', description: JSON.stringify({ bytes, counts }) });
    expect(Object.keys(counts).filter((outcome) => !FAILURES.has(outcome))).toEqual([]);
    if (bytes >= WHOLE_FROM) expect(counts).toEqual({ '413': ATTEMPTS });
  });
});

test('an oversized request does not hold up the next one', async ({ page }, testInfo) => {
  const rounds = await send(page, [300_000, 100, 300_000, 100, 300_000, 100]);
  testInfo.annotations.push({ type: 'rounds', description: JSON.stringify(rounds) });
  expect(rounds.filter(({ outcome }) => outcome === 'stalled')).toEqual([]);
  expect(Math.max(...rounds.map(({ ms }) => ms))).toBeLessThan(PROMPT_MS);
});
