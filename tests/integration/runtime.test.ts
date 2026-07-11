/**
 * Integration tests for the inline runtime entry point.
 *
 * The runtime is the seam between `LivePreviewRuntime` and the IIFE
 * that ships in `runtime.generated.ts`. It auto-starts when running
 * in a preview context and exposes `window.__livePreview`. These
 * tests exercise the bootstrap function directly under jsdom so we
 * get coverage on every branch that currently relies on Playwright.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom needs IntersectionObserver — supply a controllable stub.
class IO implements IntersectionObserver {
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

const TRUSTED = 'https://admin.example.com';

interface BakedConfig {
  additionalOrigins: readonly string[];
  debug: boolean;
  debounceMs: number;
  enableA11y: boolean;
  heartbeatMs: number;
  disableVisibilityGate: boolean;
  visibilityGateThreshold: number;
  intersectionRootMargin: string;
  disableReferrerDetection: boolean;
  disableLocalhostMatching: boolean;
}

function bakeConfig(overrides: Partial<BakedConfig> = {}): BakedConfig {
  return {
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
    ...overrides,
  };
}

function fakeIframe(): void {
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

describe('bootstrapInlineRuntime — preview context', () => {
  it('exposes window.__livePreview with the expected shape', async () => {
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfig }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(api).toBeDefined();
    expect(api?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof api?.destroy).toBe('function');
    expect(typeof api?.refresh).toBe('function');
    expect(typeof api?.enumerateOrigins).toBe('function');
    expect(window.__livePreview).toBe(api);
    api?.destroy();
  });

  it('destroy() clears window.__livePreview so a re-bootstrap starts fresh', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfig }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');

    const first = bootstrapInlineRuntime();
    expect(window.__livePreview).toBe(first);
    first?.destroy();
    // The global handle must be gone, not a dead API.
    expect(window.__livePreview).toBeUndefined();

    // A second bootstrap must produce a NEW, live runtime — not return
    // the destroyed one — and actually process updates.
    const second = bootstrapInlineRuntime();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(window.__livePreview).toBe(second);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'after rebootstrap' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('after rebootstrap');
    second?.destroy();
  });

  it('processes a valid postMessage and updates the DOM', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfig }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'new title' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('new title');
    api?.destroy();
  });

  it('enumerateOrigins returns the trusted origin', async () => {
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfig }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(api?.enumerateOrigins()).toContain(TRUSTED);
    api?.destroy();
  });

  it('refresh() rebuilds the cache for newly added bindings', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfig }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    const newEl = document.createElement('span');
    newEl.setAttribute('data-payload-field', 'subtitle');
    newEl.textContent = '-';
    document.body.appendChild(newEl);
    api?.refresh();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { subtitle: 'refreshed' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('span')?.textContent).toBe('refreshed');
    api?.destroy();
  });

  it('destroy tears down the listener so subsequent messages are ignored', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">stable</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfig }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    api?.destroy();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'should not apply' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('stable');
  });

  it('emits a console warning when production is unconfigured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfig }).__LIVE_PREVIEW_CONFIG__ = bakeConfig({
      additionalOrigins: [],
      disableReferrerDetection: true,
      disableLocalhostMatching: true,
    });
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(warn).toHaveBeenCalled();
    expect((warn.mock.calls[0]?.[0] as string).includes('No trusted origin')).toBe(true);
    api?.destroy();
    warn.mockRestore();
  });
});

describe('bootstrapInlineRuntime — non-preview context', () => {
  it('returns undefined when window.top equals window (no iframe, no popener)', async () => {
    Object.defineProperty(window, 'top', { value: window, configurable: true });
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfig }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    expect(bootstrapInlineRuntime()).toBeUndefined();
    expect(window.__livePreview).toBeUndefined();
  });
});

describe('bootstrapInlineRuntime — config defaults', () => {
  it('falls back to defaults when __LIVE_PREVIEW_CONFIG__ is undefined', async () => {
    Reflect.deleteProperty(globalThis, '__LIVE_PREVIEW_CONFIG__');
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(api).toBeDefined();
    api?.destroy();
  });

  it('routes debug logs through console.debug when debug=true', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfig }).__LIVE_PREVIEW_CONFIG__ = bakeConfig({
      debug: true,
    });
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(debug).toHaveBeenCalled();
    api?.destroy();
    debug.mockRestore();
  });
});

declare global {
  interface Window {
    __livePreview?: unknown;
  }
}
