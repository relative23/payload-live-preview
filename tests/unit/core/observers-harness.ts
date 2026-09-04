/**
 * Fixtures for the `ObserverManager` suites. Importing this module installs
 * the hooks that put fake timers and the IntersectionObserver stub in place.
 */

import { afterEach, beforeEach, vi } from 'vitest';

// jsdom does not implement IntersectionObserver — install a controllable stub.
export interface MockIntersectionObserver {
  readonly callback: IntersectionObserverCallback;
  readonly observed: Set<Element>;
  trigger(element: Element, isIntersecting: boolean): void;
  triggerBatch(entries: readonly [element: Element, isIntersecting: boolean][]): void;
}

export const mockObservers: MockIntersectionObserver[] = [];

export function makeIntersectionObserverStub(): typeof IntersectionObserver {
  return class implements IntersectionObserver {
    readonly callback: IntersectionObserverCallback;
    readonly observed = new Set<Element>();
    readonly root: Element | Document | null = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];

    constructor(cb: IntersectionObserverCallback) {
      this.callback = cb;
      const observed = this.observed;
      const makeEntry = (el: Element, isIntersecting: boolean): IntersectionObserverEntry => ({
        target: el,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
        time: performance.now(),
        boundingClientRect: el.getBoundingClientRect(),
        intersectionRect: el.getBoundingClientRect(),
        rootBounds: null,
      });
      const triggerBatch = (entries: readonly [Element, boolean][]): void => {
        cb(
          entries.map(([element, isIntersecting]) => makeEntry(element, isIntersecting)),
          {} as unknown as IntersectionObserver,
        );
      };
      const trigger = (el: Element, isIntersecting: boolean): void => {
        triggerBatch([[el, isIntersecting]]);
      };
      mockObservers.push({ callback: cb, observed, trigger, triggerBatch });
    }
    observe(target: Element): void {
      this.observed.add(target);
    }
    unobserve(target: Element): void {
      this.observed.delete(target);
    }
    disconnect(): void {
      this.observed.clear();
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockObservers.length = 0;
  globalThis.IntersectionObserver = makeIntersectionObserverStub();
});

afterEach(() => {
  vi.useRealTimers();
});

export function getLatestStub(): MockIntersectionObserver {
  const last = mockObservers.at(-1);
  if (!last) throw new Error('no intersection observer was created');
  return last;
}

// MutationObserver dispatches via microtask, so tests must flush them
// after every mutation before advancing fake timers for the debounce.
export const flushMutations = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
