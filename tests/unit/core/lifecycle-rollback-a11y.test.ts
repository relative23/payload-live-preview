import { afterEach, describe, expect, it, vi } from 'vitest';
import { A11yAnnouncer } from '@core/a11y';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';

/**
 * A failed start rolls the session back through the scope and then detaches
 * the announcer, which lives with the instance rather than the session. A
 * detach that throws is logged like any other cleanup and does not hide the
 * start's own error.
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
const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    target.element.textContent = String(value);
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a failed start with an announcer that will not detach', () => {
  it('logs the detach failure and still throws the start error', () => {
    globalThis.IntersectionObserver = IO;
    document.body.innerHTML = '<h1 data-payload-field="title">Saved</h1>';
    const logs: unknown[][] = [];
    vi.spyOn(A11yAnnouncer.prototype, 'detach').mockImplementationOnce(() => {
      throw new Error('detach exploded');
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      enableA11y: true,
      warn: () => {},
      log: (...args: unknown[]) => {
        logs.push(args);
      },
      sendReady: () => {
        throw new Error('ready failed');
      },
    });
    expect(() => runtime.start()).toThrow('ready failed');
    const failure = logs.find((entry) => entry[0] === 'runtime cleanup failed:');
    expect(failure).toBeDefined();
    expect((failure?.[1] as Error).message).toBe('detach exploded');
    expect(runtime.inspect().started).toBe(false);
    runtime.destroy();
  });
});
