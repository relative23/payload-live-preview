import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/session/lifecycle';
import type { FieldRenderer } from '@core/types';

/**
 * The row `skipUnchanged` in both states from one parametrised suite: the
 * default, and `false` written out, which is what 1.x did and what the
 * removed `defaults: 'v1'` stood for. The default is the runtime's own: the
 * option is left out, and the runtime takes its row of the defaults table.
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

const TRUSTED = 'https://admin.example.com';
const MODES = [
  { name: 'skipUnchanged: false', skipUnchanged: false },
  { name: 'the default', skipUnchanged: undefined },
] as const;

let emitter: EventEmitter;
let runtime: LivePreviewRuntime | undefined;
const renders: string[] = [];
const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    renders.push(String(value));
    target.element.textContent = String(value);
  },
};

function post(
  data: Record<string, unknown>,
  origin = TRUSTED,
  source: Window | null = window,
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', data },
      origin,
      ...(source !== null ? { source } : {}),
    }),
  );
}
function afterUpdate(): Promise<void> {
  return new Promise((resolve) => {
    emitter.once('afterUpdate', () => {
      resolve();
    });
  });
}

/** Build a runtime with the row given, or left out. */
function startFor(skipUnchanged: false | undefined): LivePreviewRuntime {
  runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    enableVisibilityGate: false,
    enableA11y: false,
    warn: () => {},
    ...(skipUnchanged === undefined ? {} : { skipUnchanged }),
    // Held at 'any': jsdom's window is its own parent, so 'parent-or-opener'
    // cannot be exercised here — the message-bus unit tests cover that flip
    // with a mocked parent. This suite isolates the skipUnchanged row.
    eventSourcePolicy: 'any',
  });
  runtime.start();
  return runtime;
}

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  renders.length = 0;
  document.body.innerHTML = '<p data-payload-field="title">old</p>';
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

describe.each(MODES)('skipUnchanged under $name', ({ skipUnchanged }) => {
  const skips = skipUnchanged === undefined;
  it(skips ? 'skips an unchanged value' : 're-applies an unchanged value', async () => {
    const rt = startFor(skipUnchanged);
    let done = afterUpdate();
    post({ title: 'same' });
    await done;
    expect(renders).toEqual(['same']);
    // Second identical message.
    if (skips) {
      post({ title: 'same' });
      // Waits for the runtime, not a fixed time: a fixed wait failed under load (PHD-15).
      await vi.waitFor(() => {
        expect(rt.inspect().revisions.skippedUnchanged).toBe(1);
      });
      expect(renders).toEqual(['same']);
    } else {
      done = afterUpdate();
      post({ title: 'same' });
      await done;
      expect(renders).toEqual(['same', 'same']);
      expect(rt.inspect().revisions.skippedUnchanged).toBe(0);
    }
  });
});
