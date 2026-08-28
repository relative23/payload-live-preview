/**
 * Fixtures and hooks for the startup suites. Runtime behaviours added for
 * real-world Payload/Astro compatibility:
 *
 *   - deferred startup while the document is still parsing (script in
 *     `<head>` — `document.body` is null at execute time)
 *   - Lexical auto-detection for rich-text values bound without
 *     `data-payload-richtext`
 *   - `data-payload-attribute` writes
 *   - REST data merging via the `dataMerge` option
 */

import { afterEach, beforeEach, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';

export class IO implements IntersectionObserver {
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

export const TRUSTED = 'https://admin.example.com';

export function fireMessage(data: unknown, origin: string = TRUSTED): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export function textRenderer(): FieldRenderer {
  return {
    name: 'text',
    render(target, value) {
      target.element.textContent = typeof value === 'string' ? value : JSON.stringify(value);
    },
  };
}

export function makeRuntime(
  overrides: Partial<ConstructorParameters<typeof LivePreviewRuntime>[0]> = {},
): LivePreviewRuntime {
  return new LivePreviewRuntime({
    renderers: { text: textRenderer() },
    originMatcher: (o) => o === TRUSTED,
    readyTargets: [TRUSTED],
    emitter: new EventEmitter(),
    debounceMs: 0,
    disableVisibilityGate: true,
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});
