import { bench, describe } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import { buildBuiltinRenderers } from '@field-types/index';

/**
 * What `skipUnchanged` saves on a keystroke: one message carrying N fields of
 * which one changed, applied to a page with N bindings.
 *
 * jsdom, so the absolute numbers are not browser numbers — the
 * `tests/browser-bench` spec measures those. What this isolates is the
 * scheduling loop and the renderer calls it issues, which is the work the
 * option removes; the ratio between the two cases is the signal.
 */

class IO implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
globalThis.IntersectionObserver = IO;

const TRUSTED = 'https://admin.example.com';
const BINDINGS = 300;

const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    target.element.textContent = typeof value === 'string' ? value : JSON.stringify(value);
  },
};

type Population = 'text' | 'richText';

function mountPage(population: Population): void {
  const items: string[] = [];
  const type = population === 'richText' ? ' data-payload-type="richText"' : '';
  for (let index = 0; index < BINDINGS; index += 1) {
    items.push(
      `<li><div data-payload-field="f${String(index)}"${type}>f${String(index)}</div></li>`,
    );
  }
  document.body.innerHTML = `<ol data-payload-owner="global:bench">${items.join('')}</ol>`;
}

/** A small Lexical document: three paragraphs, one with inline formatting. */
function lexical(text: string): unknown {
  return {
    root: {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', text }] },
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Mix of ' },
            { type: 'text', text: 'bold', format: 1 },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', format: 2 },
          ],
        },
        { type: 'paragraph', children: [{ type: 'text', text: 'Third paragraph.' }] },
      ],
    },
  };
}

function fields(population: Population, changed: number): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (let index = 0; index < BINDINGS; index += 1) {
    const value = `v${String(index)}`;
    data[`f${String(index)}`] = population === 'richText' ? lexical(value) : value;
  }
  const changedValue = `changed-${String(changed)}`;
  data['f0'] = population === 'richText' ? lexical(changedValue) : changedValue;
  return data;
}

let emitter = new EventEmitter();

function createRuntime(population: Population, skipUnchanged: boolean): LivePreviewRuntime {
  emitter = new EventEmitter();
  return new LivePreviewRuntime({
    renderers: population === 'richText' ? buildBuiltinRenderers() : { text: textRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: () => {},
    skipUnchanged,
  });
}

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'payload-live-preview', data }, origin: TRUSTED }),
  );
}

/**
 * Wait for the flush that applied this message. The scheduler flushes on
 * `requestAnimationFrame`, which jsdom shims at ~16 ms; a `setTimeout(0)` here
 * returned before any render happened and made the first version of this
 * bench time message dispatch alone. `f0` changes in every message, so at
 * least one write is applied in both modes and `afterUpdate` always fires.
 */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => {
    emitter.once('afterUpdate', () => {
      resolve();
    });
  });
}

// Two populations, because the option's value depends entirely on what a
// render costs. A scalar text write is a few microseconds and the identity
// check costs about as much, so the scalar case is expected to be roughly
// neutral; a rich-text render is a Lexical pass plus a sanitizer pass, and
// that is what the skip removes. A static table, not a loop: the test policy
// forbids registering benches under a loop or a condition.
describe.each([
  { population: 'text', skipUnchanged: false },
  { population: 'text', skipUnchanged: true },
  { population: 'richText', skipUnchanged: false },
  { population: 'richText', skipUnchanged: true },
] as const satisfies readonly { population: Population; skipUnchanged: boolean }[])(
  '$population: one changed field of 300 — skipUnchanged: $skipUnchanged',
  ({ population, skipUnchanged }) => {
    let runtime: LivePreviewRuntime;
    let sequence = 0;

    bench(
      'keystroke',
      async () => {
        sequence += 1;
        const applied = settle();
        post(fields(population, sequence));
        await applied;
      },
      {
        setup: () => {
          mountPage(population);
          runtime = createRuntime(population, skipUnchanged);
          runtime.start();
          // Prime: the first message applies everything in both modes.
          post(fields(population, 0));
        },
        teardown: () => {
          runtime.destroy();
        },
        iterations: 200,
        warmupIterations: 20,
      },
    );
  },
);
