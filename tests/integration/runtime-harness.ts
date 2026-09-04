/**
 * Fixtures for the inline runtime entry point, exercised by `runtime-*.test.ts`.
 * Importing this module also installs their shared hooks.
 *
 * The runtime is the seam between `LivePreviewRuntime` and the IIFE
 * that ships in `runtime.generated.ts`. It auto-starts when running
 * in a preview context and exposes `window.__livePreview`. These
 * tests exercise the bootstrap function directly under jsdom so we
 * get coverage on every branch that currently relies on Playwright.
 */

import { afterEach, beforeEach, vi } from 'vitest';

// jsdom needs IntersectionObserver — supply a controllable stub.
export class IO implements IntersectionObserver {
  readonly callback: IntersectionObserverCallback;
  readonly observed = new Set<Element>();
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
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
}

export const TRUSTED = 'https://admin.example.com';

export interface BakedConfig {
  readonly additionalOrigins: readonly string[];
  readonly serverURL?: string;
  readonly apiRoute?: string;
  readonly mergeDepth?: number;
  readonly debug: boolean;
  readonly debounceMs: number;
  readonly enableA11y: boolean;
  readonly heartbeatMs: number;
  readonly disableVisibilityGate: boolean;
  readonly visibilityGateThreshold: number;
  readonly intersectionRootMargin: string;
  readonly disableReferrerDetection: boolean;
  readonly disableLocalhostMatching: boolean;
  readonly scopeBindingsByOwner?: boolean;
  readonly skipUnchanged?: boolean;
  readonly eventSourcePolicy?: 'any' | 'parent-or-opener';
  readonly sanitizerPolicy?: 'compat' | 'strict';
}

export type BakedConfigTuple = readonly unknown[];

export function bakeConfig(overrides: Partial<BakedConfig> = {}): BakedConfigTuple {
  const config: BakedConfig = {
    additionalOrigins: [TRUSTED],
    debug: false,
    debounceMs: 0,
    enableA11y: false,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    visibilityGateThreshold: 50,
    intersectionRootMargin: '200px',
    disableReferrerDetection: true,
    disableLocalhostMatching: true,
    // These pipeline tests predate the 2.0 default flip and assert v1 behaviour
    // (any message source, no skip-unchanged, compat sanitizer). The flip
    // itself is covered by defaults-profile, dual-mode and the adapter suites.
    skipUnchanged: false,
    eventSourcePolicy: 'any',
    sanitizerPolicy: 'compat',
    ...overrides,
  };
  return [
    config.additionalOrigins,
    config.serverURL,
    config.apiRoute,
    config.mergeDepth,
    config.debug,
    config.debounceMs,
    config.enableA11y,
    config.heartbeatMs,
    config.disableVisibilityGate,
    config.visibilityGateThreshold,
    config.intersectionRootMargin,
    config.disableReferrerDetection,
    config.disableLocalhostMatching,
    config.scopeBindingsByOwner,
    config.skipUnchanged,
    config.eventSourcePolicy,
    config.sanitizerPolicy,
  ];
}

export function fakeIframe(): void {
  Object.defineProperty(window, 'top', {
    get: () => {
      throw new Error('cross-origin iframe simulated');
    },
    configurable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  globalThis.IntersectionObserver = IO;
  document.body.innerHTML = '';
  fakeIframe();
  // Remove any previous __livePreview from earlier tests.
  Reflect.deleteProperty(window, '__livePreview');
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, '__livePreview');
});

declare global {
  interface Window {
    __livePreview?: unknown;
  }
}
