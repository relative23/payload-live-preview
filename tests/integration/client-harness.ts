import { vi } from 'vitest';
import type { LivePreviewClientConfig } from '@client/index';

export const TRUSTED = 'https://admin.example.com';

export class IO implements IntersectionObserver {
  static latest: IO | undefined;
  readonly callback: IntersectionObserverCallback;
  readonly observed = new Set<Element>();
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
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

export function fakeIframe(): void {
  Object.defineProperty(window, 'top', {
    get: () => {
      throw new Error('cross-origin');
    },
    configurable: true,
  });
}

export function fireMessage(data: unknown, origin: string = TRUSTED): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

export async function fireUpdate(fields: Record<string, unknown>): Promise<void> {
  fireMessage({ type: 'payload-live-preview', data: fields });
  await vi.advanceTimersByTimeAsync(50);
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function settlesWithinMicrotaskDrain(promise: Promise<void>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  return settled;
}

/** Fake timers, a stub IntersectionObserver, a cross-origin parent and an empty body. */
export function preparePreviewPage(): void {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
  IO.latest = undefined;
  fakeIframe();
  document.body.innerHTML = '';
}

export function restorePreviewPage(): void {
  vi.useRealTimers();
}

/** Pinned to v1: these tests exercise the render pipeline, not the 2.0 default flip. */
export function v1Config(overrides: LivePreviewClientConfig = {}): LivePreviewClientConfig {
  return {
    defaults: 'v1',
    allowedOrigins: [TRUSTED],
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    ...overrides,
  };
}
