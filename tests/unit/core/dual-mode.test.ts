import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { withProfileDefaults } from '@client/config';
import { runtimeDefaultsFor } from '@core/defaults-profile';
import type { FieldRenderer } from '@core/types';

/**
 * Dual-mode testing (roadmap 1.9.0): the behaviours the readiness flip
 * changes are asserted under BOTH the 1.x defaults and the v2 profile from
 * one parametrised suite, so 2.0's default flip is proven now rather than
 * discovered at release. The profile is resolved through the real
 * `withProfileDefaults`, the same path a consumer's `defaults: 'v2'` takes.
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
  { name: 'v1 (explicit)', defaults: 'v1' as const },
  { name: 'v2', defaults: 'v2' as const },
];

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

/** Build a runtime with the runtime rows the profile resolves to. */
function startFor(defaults: 'v1' | 'v2' | undefined): LivePreviewRuntime {
  const config = withProfileDefaults({ ...(defaults !== undefined ? { defaults } : {}) });
  const rows = runtimeDefaultsFor(defaults);
  runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: () => {},
    skipUnchanged: config.skipUnchanged ?? rows.skipUnchanged,
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

describe.each(MODES)('skipUnchanged under $name', ({ defaults }) => {
  it(defaults === 'v2' ? 'skips an unchanged value' : 're-applies an unchanged value', async () => {
    const rt = startFor(defaults);
    let done = afterUpdate();
    post({ title: 'same' });
    await done;
    expect(renders).toEqual(['same']);
    // Second identical message.
    if (defaults === 'v2') {
      post({ title: 'same' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(renders).toEqual(['same']);
      expect(rt.inspect().revisions.skippedUnchanged).toBe(1);
    } else {
      done = afterUpdate();
      post({ title: 'same' });
      await done;
      expect(renders).toEqual(['same', 'same']);
      expect(rt.inspect().revisions.skippedUnchanged).toBe(0);
    }
  });
});
