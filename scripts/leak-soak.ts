/**
 * Deterministic lifecycle/resource soak plus a forced-GC retained-heap gate.
 *
 * Run this script in its own process with `node --expose-gc --import tsx`.
 * The scheduled gate uses 10,000 cycles. `PLP_SOAK_CYCLES` may lower the count
 * for a quick local smoke without weakening the scheduled/release contract.
 */
import { strict as assert } from 'node:assert';
import { setImmediate as waitImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { LivePreviewRuntime } from '../src/core/lifecycle';
import { EventEmitter } from '../src/events/emitter';
import { buildBuiltinRenderers } from '../src/field-types';

const TRUSTED_ORIGIN = 'https://admin.example.test';
const DEFAULT_CYCLES = 10_000;
const QUICK_CYCLES = 500;
const MAX_RETAINED_BYTES = 2 * 1024 * 1024;

const requestedCycles = Number.parseInt(process.env['PLP_SOAK_CYCLES'] ?? '', 10);
const cycles =
  Number.isFinite(requestedCycles) && requestedCycles > 0
    ? requestedCycles
    : process.argv.includes('--quick')
      ? QUICK_CYCLES
      : DEFAULT_CYCLES;
const enforceHeapBudget = cycles >= DEFAULT_CYCLES;

if (typeof globalThis.gc !== 'function') {
  throw new Error('leak soak requires Node --expose-gc');
}

class TrackedMutationObserver implements MutationObserver {
  static active = 0;
  #observing = false;

  disconnect(): void {
    if (!this.#observing) return;
    this.#observing = false;
    TrackedMutationObserver.active -= 1;
  }

  observe(): void {
    if (this.#observing) return;
    this.#observing = true;
    TrackedMutationObserver.active += 1;
  }

  takeRecords(): MutationRecord[] {
    return [];
  }
}

class TrackedIntersectionObserver implements IntersectionObserver {
  static active = 0;
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  #connected = true;

  constructor(_callback: IntersectionObserverCallback) {
    TrackedIntersectionObserver.active += 1;
  }

  disconnect(): void {
    if (!this.#connected) return;
    this.#connected = false;
    TrackedIntersectionObserver.active -= 1;
  }

  observe(): void {}
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

interface ResourceSnapshot {
  readonly mutationObservers: number;
  readonly intersectionObservers: number;
  readonly messageListeners: number;
  readonly timeouts: number;
  readonly packageDomNodes: number;
}

const dom = new JSDOM(
  '<!doctype html><html lang="en"><body><span data-payload-field="title">initial</span></body></html>',
  { url: 'https://preview.example.test/' },
);
const browserWindow = dom.window;

for (const [name, value] of Object.entries({
  window: browserWindow,
  document: browserWindow.document,
  navigator: browserWindow.navigator,
  Node: browserWindow.Node,
  Element: browserWindow.Element,
  HTMLElement: browserWindow.HTMLElement,
  Text: browserWindow.Text,
  MutationObserver: TrackedMutationObserver,
  IntersectionObserver: TrackedIntersectionObserver,
  MessageEvent: browserWindow.MessageEvent,
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}

const originalAddEventListener = browserWindow.addEventListener.bind(browserWindow);
const originalRemoveEventListener = browserWindow.removeEventListener.bind(browserWindow);
let messageListeners = 0;
browserWindow.addEventListener = ((
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void => {
  if (type === 'message') messageListeners += 1;
  originalAddEventListener(type, listener, options);
}) as typeof browserWindow.addEventListener;
browserWindow.removeEventListener = ((
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | EventListenerOptions,
): void => {
  if (type === 'message') messageListeners -= 1;
  originalRemoveEventListener(type, listener, options);
}) as typeof browserWindow.removeEventListener;

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const activeTimeouts = new Set<ReturnType<typeof setTimeout>>();
globalThis.setTimeout = ((
  handler: (...args: unknown[]) => void,
  timeout?: number,
  ...args: unknown[]
) => {
  const handle = originalSetTimeout(() => {
    activeTimeouts.delete(handle);
    handler(...args);
  }, timeout);
  activeTimeouts.add(handle);
  return handle;
}) as unknown as typeof globalThis.setTimeout;
globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
  if (handle !== undefined) activeTimeouts.delete(handle);
  originalClearTimeout(handle);
}) as typeof globalThis.clearTimeout;

function snapshotResources(): ResourceSnapshot {
  return {
    mutationObservers: TrackedMutationObserver.active,
    intersectionObservers: TrackedIntersectionObserver.active,
    messageListeners,
    timeouts: activeTimeouts.size,
    packageDomNodes: browserWindow.document.querySelectorAll(
      '#payload-live-preview-a11y, style[data-payload-live-preview]',
    ).length,
  };
}

function createRuntime(emitter = new EventEmitter()): LivePreviewRuntime {
  return new LivePreviewRuntime({
    root: browserWindow.document.body,
    renderers: buildBuiltinRenderers(),
    originMatcher: (origin) => origin === TRUSTED_ORIGIN,
    readyTargets: [TRUSTED_ORIGIN],
    emitter,
    debounceMs: 0,
    disableVisibilityGate: true,
    enableA11y: true,
    sendReady: () => undefined,
    log: () => undefined,
    warn: () => undefined,
  });
}

function dispatchUpdate(index: number): void {
  browserWindow.dispatchEvent(
    new browserWindow.MessageEvent('message', {
      origin: TRUSTED_ORIGIN,
      data: {
        type: 'payload-live-preview',
        data: { title: `title-${String(index)}` },
      },
    }),
  );
}

async function dispatchAndWaitForPaint(index: number, emitter: EventEmitter): Promise<void> {
  const expectedTitle = `title-${String(index)}`;
  const applied = new Promise<void>((resolve) => {
    emitter.once('afterUpdate', ({ data }) => {
      assert.equal(data.fields['title'], expectedTitle);
      resolve();
    });
  });
  dispatchUpdate(index);
  await applied;
  assert.equal(
    browserWindow.document.querySelector('[data-payload-field="title"]')?.textContent,
    expectedTitle,
  );
}

async function collectHeap(): Promise<number> {
  const samples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    globalThis.gc!();
    await waitImmediate();
    samples.push(process.memoryUsage().heapUsed);
  }
  return Math.min(...samples);
}

// First exercise repeated ownership acquisition/release. This catches leaked
// observers, listeners, timers and package DOM even when heap sampling is noisy.
for (let index = 0; index < 250; index += 1) {
  const runtime = createRuntime();
  assert.equal(runtime.start(), true);
  dispatchUpdate(index);
  runtime.destroy();
}
await waitImmediate();
assert.deepEqual(snapshotResources(), {
  mutationObservers: 0,
  intersectionObservers: 0,
  messageListeners: 0,
  timeouts: 0,
  packageDomNodes: 0,
});
const baselineHeap = await collectHeap();

// Keep one real runtime alive for the complete update soak. Awaiting afterUpdate
// proves each message traversed validation, resolution, scheduling, rendering and
// event publication before the next sample; destroying immediately after dispatch
// would only measure cancellation and could make the update path a false green.
const soakEmitter = new EventEmitter();
const soakRuntime = createRuntime(soakEmitter);
assert.equal(soakRuntime.start(), true);
for (let index = 0; index < 250; index += 1) {
  await dispatchAndWaitForPaint(index, soakEmitter);
}
const updateBaselineHeap = await collectHeap();

for (let index = 0; index < cycles; index += 1) {
  await dispatchAndWaitForPaint(index + 250, soakEmitter);
}

const updateFinalHeap = await collectHeap();
const updateRetainedBytes = updateFinalHeap - updateBaselineHeap;
soakRuntime.destroy();
await waitImmediate();

const finalResources = snapshotResources();
assert.deepEqual(finalResources, {
  mutationObservers: 0,
  intersectionObservers: 0,
  messageListeners: 0,
  timeouts: 0,
  packageDomNodes: 0,
});

const finalHeap = await collectHeap();
const retainedBytes = finalHeap - baselineHeap;
if (enforceHeapBudget) {
  assert.ok(
    updateRetainedBytes < MAX_RETAINED_BYTES,
    `long-session retained heap drift ${String(updateRetainedBytes)} B exceeds ${String(MAX_RETAINED_BYTES)} B`,
  );
  assert.ok(
    retainedBytes < MAX_RETAINED_BYTES,
    `post-destroy retained heap drift ${String(retainedBytes)} B exceeds ${String(MAX_RETAINED_BYTES)} B`,
  );
}

process.stdout.write(
  `${JSON.stringify({ cycles, baselineHeap, updateBaselineHeap, updateFinalHeap, updateRetainedBytes, finalHeap, retainedBytes, heapBudgetEnforced: enforceHeapBudget, resources: finalResources })}\n`,
);

dom.window.close();
