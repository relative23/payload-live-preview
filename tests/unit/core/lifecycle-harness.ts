/**
 * Shared jsdom harness for the `LivePreviewRuntime` suites: a controllable
 * IntersectionObserver, the trusted origins, and the message/renderer helpers
 * every split file uses. `beforeEach`/`afterEach` here apply to the importing
 * file, so each suite gets fake timers and a fresh observer.
 */

import { afterEach, beforeEach, vi } from 'vitest';
import type { FieldRenderer } from '@core/types';

// Provide a controllable IntersectionObserver in jsdom.
export class IO implements IntersectionObserver {
  static latest: IO | undefined;
  readonly callback: IntersectionObserverCallback;
  readonly observed = new Set<Element>();
  readonly root: Element | Document | null = null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[] = [];
  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = cb;
    this.rootMargin = options?.rootMargin ?? '';
    IO.latest = this;
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.observed.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  setVisible(element: Element, visible: boolean): void {
    this.callback(
      [{ target: element, isIntersecting: visible } as IntersectionObserverEntry],
      this,
    );
  }
}

export const TRUSTED = 'https://admin.example.com';
export const OTHER_TRUSTED = 'https://admin-other.example.com';

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

export async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

export function textRenderer(): FieldRenderer {
  return {
    name: 'text',
    render(target, value) {
      target.element.textContent =
        value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  IO.latest = undefined;
  globalThis.IntersectionObserver = IO;
});
afterEach(() => {
  vi.useRealTimers();
});
