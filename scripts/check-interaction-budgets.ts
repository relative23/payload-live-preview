/**
 * The interaction gate: how many merge requests one burst of typing costs, and
 * how long a single keystroke takes to reach the page.
 *
 * The runtime is driven in jsdom against a merge endpoint that answers without
 * delay, so both numbers are the package's own and reproduce run to run. The
 * network half of what an editor waits for is carried by the request count
 * instead: an update that makes no request cannot wait for one.
 */

import { JSDOM } from 'jsdom';
import {
  findInteractionViolations,
  INTERACTION_BUDGETS,
  type InteractionBudget,
  type InteractionMeasurement,
} from './interaction-budgets';
import {
  KEYSTROKES,
  KEYSTROKE_INTERVAL_MS,
  populate,
  SCENARIOS,
  type InteractionScenario,
} from './interaction-scenarios';

const ADMIN = 'http://localhost:3001';
const PREVIEW = 'http://localhost:4173/';
/** Samples kept per scenario, after the discarded warm-up. */
const LATENCY_SAMPLES = 30;
/** Discarded: the first keystrokes on a cold page are a different population. */
const LATENCY_WARMUP = 10;
/** Idle between measured keystrokes, so each one is measured on a closed debounce window. */
const LATENCY_GAP_MS = 40;
/** Long enough for the debounce deadline (4 x 50 ms) to have fired. */
const SETTLE_MS = 300;
/**
 * Long enough for the route strategy's own minimum interval (1 000 ms) to close
 * on the last refusal of the burst, so the trailing refresh is inside the
 * measurement rather than after it. Measuring a shorter window would report the
 * bug this row exists to hold shut.
 */
const ROUTE_SETTLE_MS = 1_600;
const PROBE_TIMEOUT_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A stub: jsdom has no layout, and every scenario page stays under the gate's threshold anyway. */
class NoIntersections {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

/**
 * Publish one jsdom window as the process globals the runtime reads.
 *
 * `opener` points at the window itself for two reasons: it makes
 * `isInPreviewContext()` true, and it gives the 2.0 source policy a window it
 * can accept, because this process has no second realm to post from. Which
 * windows may post is a message-bus decision with its own tests; neither number
 * measured here depends on it.
 */
function installDom(dom: JSDOM): Window & typeof globalThis {
  const win = dom.window as unknown as Window & typeof globalThis;
  for (const key of Object.getOwnPropertyNames(win)) {
    if (key in globalThis) continue;
    try {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        get: () => (win as unknown as Record<string, unknown>)[key],
      });
    } catch {
      // A few jsdom accessors refuse redefinition; nothing the runtime reads.
    }
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: win.document });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: NoIntersections,
  });
  Object.defineProperty(win, 'opener', { configurable: true, value: win });
  return win;
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: PREVIEW,
  pretendToBeVisual: true,
});
const win = installDom(dom);
const { LivePreviewClient } = await import('../src/client-entry');
const { createRouteStrategy } = await import('../src/fragment/index');

/** Post one update the way the Admin does, with the event that follows every autosave. */
function post(fields: Record<string, unknown>, relationshipEvent: boolean): void {
  const message: Record<string, unknown> = {
    type: 'payload-live-preview',
    data: fields,
    collectionSlug: 'posts',
  };
  if (relationshipEvent) {
    message['externallyUpdatedRelationship'] = { id: 15, doc: { title: 'another document' } };
  }
  win.dispatchEvent(
    new win.MessageEvent('message', {
      data: message,
      origin: ADMIN,
      source: win as unknown as Window,
    }),
  );
}

/** Resolves when the probed element carries `expected`; rejects rather than hanging. */
function waitForText(element: Element, expected: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`the preview never showed ${JSON.stringify(expected)}`));
    }, PROBE_TIMEOUT_MS);
    const observer = new win.MutationObserver(() => {
      if (!element.textContent.includes(expected)) return;
      clearTimeout(timer);
      observer.disconnect();
      resolve(performance.now());
    });
    observer.observe(element, { subtree: true, childList: true, characterData: true });
  });
}

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.NaN;
}

interface Session {
  readonly requests: () => number;
  /** Route refreshes the strategy actually performed; 0 on a page without one. */
  readonly refreshes: () => number;
  /** What the auto-binding search cost on the first message; `undefined` until it ran, or where it never runs. */
  readonly searchMs: () => number | undefined;
  readonly reset: () => void;
  readonly destroy: () => Promise<void>;
}

/**
 * The route as this page's own server would answer it: the same markup, because
 * the count is the finding here and a changing page would only add noise to it.
 */
function routeResponse(scenario: InteractionScenario): Response {
  return new Response(
    `<!doctype html><html><head><title>preview</title></head><body>${scenario.page}</body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

/** One client on one scenario page, merging against the modelled endpoint. */
function openPage(scenario: InteractionScenario): Session {
  win.document.body.innerHTML = scenario.page;
  let requests = 0;
  let refreshes = 0;
  const strategies =
    scenario.routeStrategy === true
      ? {
          route: createRouteStrategy({
            fetch: () => {
              refreshes += 1;
              return Promise.resolve(routeResponse(scenario));
            },
            document: win.document,
            location: { href: PREVIEW },
            window: { scrollX: 0, scrollY: 0, scrollTo: () => undefined },
          }),
        }
      : undefined;
  const client = new LivePreviewClient({
    ...(strategies === undefined ? {} : { strategies }),
    ...(scenario.autoBind === undefined ? {} : { autoBind: scenario.autoBind }),
    allowedOrigins: [ADMIN],
    serverURL: ADMIN,
    // The runtime's debug log is on by default outside production; a gate
    // prints its own numbers and nothing else.
    debug: false,
    mergeDepth: 1,
    mergeFetch: (_input, init) => {
      requests += 1;
      // The merger posts `{ data, depth, flattenLocales }` as a JSON string;
      // anything else means the request under measurement is not the one the
      // budget describes.
      const sent: unknown = init?.body;
      if (typeof sent !== 'string') throw new Error('the merge request carried no JSON body');
      const body = JSON.parse(sent) as { data: Record<string, unknown> };
      return Promise.resolve(
        new Response(JSON.stringify(populate(body.data)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  });
  if (!client.inspect().started) throw new Error(`${scenario.name}: the runtime did not start`);
  return {
    requests: () => requests,
    refreshes: () => refreshes,
    searchMs: () => client.inspect().bindings.autoBind.searchMs,
    reset: () => {
      requests = 0;
      refreshes = 0;
    },
    destroy: () => client.destroy(),
  };
}

/** The audit's typing pattern, and what it costs in merge requests and route refreshes. */
async function measureBurst(
  scenario: InteractionScenario,
): Promise<{ requests: number; refreshes: number; searchMs: number | undefined }> {
  const session = openPage(scenario);
  try {
    // The saved document first: it is what the server already rendered, which
    // is what makes everything after it an edit rather than a first impression.
    post(scenario.base, false);
    await sleep(SETTLE_MS);
    // Read after the first message and before the burst: the search runs on
    // that message alone, and it is the one cost here that is paid once.
    const searchMs = session.searchMs();
    session.reset();
    for (let step = 0; step < KEYSTROKES; step += 1) {
      post(scenario.keystroke(step), true);
      await sleep(KEYSTROKE_INTERVAL_MS);
    }
    await sleep(scenario.routeStrategy === true ? ROUTE_SETTLE_MS : SETTLE_MS);
    return { requests: session.requests(), refreshes: session.refreshes(), searchMs };
  } finally {
    await session.destroy();
  }
}

/**
 * Keystroke to change on screen, one isolated keystroke at a time.
 *
 * Isolated, because during a burst only the last keystroke is ever shown: the
 * debounce is a trailing edge, so the ones in between have no arrival time to
 * measure. The burst answers the request question; this answers the latency one.
 */
async function measureLatency(scenario: InteractionScenario): Promise<readonly number[]> {
  const probe = scenario.probe;
  if (probe === undefined) return [];
  const session = openPage(scenario);
  try {
    post(scenario.base, false);
    await sleep(SETTLE_MS);
    const element = win.document.querySelector(probe.selector);
    if (element === null) throw new Error(`${scenario.name}: ${probe.selector} is not on the page`);
    const samples: number[] = [];
    for (let step = 0; step < LATENCY_WARMUP + LATENCY_SAMPLES; step += 1) {
      const arrived = waitForText(element, probe.expect(step));
      const sentAt = performance.now();
      post(scenario.keystroke(step), true);
      samples.push((await arrived) - sentAt);
      await sleep(LATENCY_GAP_MS);
    }
    return samples.slice(LATENCY_WARMUP);
  } finally {
    await session.destroy();
  }
}

async function measure(scenario: InteractionScenario): Promise<InteractionMeasurement> {
  const { requests, refreshes, searchMs } = await measureBurst(scenario);
  const routed = scenario.routeStrategy === true ? { routeRefreshes: refreshes } : {};
  const searched = searchMs === undefined ? {} : { baselineSearchMs: searchMs };
  const samples = [...(await measureLatency(scenario))].sort((a, b) => a - b);
  if (samples.length === 0) return { requests, ...routed, ...searched };
  return {
    requests,
    ...routed,
    ...searched,
    p50Ms: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
  };
}

function report(
  scenario: InteractionScenario,
  measurement: InteractionMeasurement,
  budget: InteractionBudget,
): number {
  const violations = findInteractionViolations(measurement, budget);
  const latency =
    measurement.p95Ms === undefined
      ? 'no visible change'
      : `${measurement.p50Ms?.toFixed(1) ?? '?'} ms p50 / ${measurement.p95Ms.toFixed(1)} ms p95`;
  const refreshes =
    measurement.routeRefreshes === undefined
      ? ''
      : ` / ${String(measurement.routeRefreshes)} route refreshes`;
  const searched =
    measurement.baselineSearchMs === undefined
      ? ''
      : ` / ${measurement.baselineSearchMs.toFixed(1)} ms baseline search`;
  console.log(
    `${violations.length === 0 ? 'PASS' : 'FAIL'} ${scenario.name}: ${measurement.requests} requests${refreshes} / ${latency}${searched}`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.metric} ${violation.actual}: ${violation.reason}`);
  }
  return violations.length;
}

async function main(): Promise<void> {
  const budgets = new Map(INTERACTION_BUDGETS.map((budget) => [budget.scenario, budget]));
  let failures = 0;
  for (const scenario of SCENARIOS) {
    const budget = budgets.get(scenario.name);
    if (budget === undefined) {
      console.error(`FAIL ${scenario.name}: no budget names this scenario`);
      failures += 1;
      continue;
    }
    failures += report(scenario, await measure(scenario), budget);
  }
  for (const budget of INTERACTION_BUDGETS) {
    if (SCENARIOS.some((scenario) => scenario.name === budget.scenario)) continue;
    console.error(`FAIL ${budget.scenario}: a budget for a scenario the gate does not run`);
    failures += 1;
  }
  dom.window.close();
  if (failures > 0) {
    throw new Error(`interaction gate failed with ${failures} violation(s)`);
  }
}

await main();
