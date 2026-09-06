import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePreviewRuntime } from '@core/lifecycle';
import { EventEmitter } from '@events/emitter';
import { buildBuiltinRenderers } from '@field-types/index';
import { IO } from '../../integration/runtime-harness';

/**
 * The second default 2.0 flipped without saying so.
 *
 * `eventSourcePolicy` was `'any'` in 1.x and is `'parent-or-opener'` now, so an
 * arrangement whose admin posts from anywhere else stops updating on upgrade.
 * The refusal reached the debug log only, which is off in production and in
 * most development — from the outside it looks like "live preview is broken",
 * with nothing to go on. LP0501 is said out loud once instead, the same way
 * LP0503 reports protocol drift.
 */

const ADMIN = 'https://admin.example.com';

interface Harness {
  readonly runtime: LivePreviewRuntime;
  readonly warnings: string[];
}

function start(policy: 'any' | 'parent-or-opener'): Harness {
  const warnings: string[] = [];
  const runtime = new LivePreviewRuntime({
    renderers: buildBuiltinRenderers(),
    originMatcher: (origin) => origin === ADMIN,
    readyTargets: [],
    emitter: new EventEmitter(),
    eventSourcePolicy: policy,
    warn: (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    },
  });
  runtime.start();
  return { runtime, warnings };
}

/** A window that is neither this page's parent nor its opener. */
function sendFromForeignWindow(): void {
  const event = new MessageEvent('message', {
    origin: ADMIN,
    data: { type: 'payload-live-preview', data: { title: 'edited' } },
  });
  Object.defineProperty(event, 'source', { value: {}, configurable: true });
  window.dispatchEvent(event);
}

let harness: Harness | undefined;

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  document.body.innerHTML = '<h1 data-payload-field="title">t</h1>';
});

afterEach(() => {
  harness?.runtime.destroy();
  harness = undefined;
  vi.restoreAllMocks();
});

const lp0501 = (h: Harness): string[] => h.warnings.filter((line) => line.includes('LP0501'));

describe('LP0501: a trusted origin, the wrong window', () => {
  it('names the option, its 2.0 default and the 1.x behaviour', () => {
    harness = start('parent-or-opener');

    sendFromForeignWindow();

    const [message] = lp0501(harness);
    expect(message).toContain('eventSourcePolicy');
    expect(message).toContain("'parent-or-opener'");
    expect(message).toContain('1.x');
    expect(message).toContain(ADMIN);
  });

  it('leaves the value alone — this is a report, not a recovery', () => {
    harness = start('parent-or-opener');

    sendFromForeignWindow();

    expect(document.querySelector('h1')?.textContent).toBe('t');
  });

  it('says it once, however many messages that window sends', () => {
    harness = start('parent-or-opener');

    sendFromForeignWindow();
    sendFromForeignWindow();
    sendFromForeignWindow();

    expect(lp0501(harness)).toHaveLength(1);
  });

  it('says nothing under the 1.x policy, where the window is not refused', () => {
    // Whether the value then lands is the message bus's contract, held by
    // message-bus-source.test.ts. What matters here is that nothing is
    // reported, because nothing changed for this arrangement.
    harness = start('any');

    sendFromForeignWindow();

    expect(harness.warnings).toEqual([]);
  });
});
