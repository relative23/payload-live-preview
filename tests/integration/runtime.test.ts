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

type BakedConfigTuple = readonly unknown[];

function bakeConfig(overrides: Partial<BakedConfig> = {}): BakedConfigTuple {
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
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(api).toBeDefined();
    expect(api?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof api?.destroy).toBe('function');
    expect(typeof api?.refresh).toBe('function');
    expect(typeof api?.enumerateOrigins).toBe('function');
    expect(typeof api?.inspect).toBe('function');
    expect(window.__livePreview).toBe(api);
    api?.destroy();
  });

  it('inspect() reports the page the inline runtime is actually bound to', async () => {
    // The inline runtime is what every adapter injects, so this is the only
    // path an adapter user can reach a snapshot through — there is no client
    // object to call a method on. Shipping the API to the client alone was
    // exactly the F-36 mistake.
    document.body.innerHTML =
      '<div data-payload-owner="global:home">' +
      '<h1 data-payload-field="title">t</h1>' +
      '<p data-payload-field="subtitle">s</p>' +
      '</div>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();

    const snapshot = api?.inspect();
    expect(snapshot?.started).toBe(true);
    expect(snapshot?.bindings.fieldNames).toEqual(['subtitle', 'title']);
    expect(snapshot?.bindings.owners).toEqual(['global:home']);
    expect(snapshot?.origins.trusted.length).toBeGreaterThan(0);
    expect(snapshot?.version).toBe(api?.version);
    api?.destroy();
  });

  it('inspect() reports the origin the runtime locked onto', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();

    expect(api?.inspect().origins.locked).toBeUndefined();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'new' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(100);

    expect(api?.inspect().origins.locked).toBe(TRUSTED);
    expect(api?.inspect().revisions.accepted).toBe(1);
    api?.destroy();
  });

  it('destroy() clears window.__livePreview so a re-bootstrap starts fresh', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
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

  it('rolls back a started runtime when publishing the global handle fails', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">stable</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const originalDefineProperty = Object.defineProperty;
    const publishError = new Error('global handle is not configurable');
    const defineProperty = vi
      .spyOn(Object, 'defineProperty')
      .mockImplementation((target, property, descriptor) => {
        if (target === window && property === '__livePreview') throw publishError;
        return originalDefineProperty(target, property, descriptor);
      });

    try {
      const { bootstrapInlineRuntime } = await import('@core/runtime');

      expect(() => bootstrapInlineRuntime()).toThrow(publishError);
      expect(window.__livePreview).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);

      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'payload-live-preview', data: { title: 'leaked update' } },
          origin: TRUSTED,
        }),
      );
      await vi.advanceTimersByTimeAsync(50);

      expect(document.querySelector('h1')?.textContent).toBe('stable');
    } finally {
      defineProperty.mockRestore();
    }
  });

  it('processes a valid postMessage and updates the DOM', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
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

  it('survives a back/forward-cache restore instead of going quiet', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();

    const send = async (title: string): Promise<void> => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'payload-live-preview', data: { title } },
          origin: TRUSTED,
        }),
      );
      await vi.advanceTimersByTimeAsync(50);
    };

    await send('before hide');
    expect(document.querySelector('h1')?.textContent).toBe('before hide');

    window.dispatchEvent(new Event('pagehide'));
    await send('while frozen');
    // The ingress is released while the document is away, so nothing lands.
    expect(document.querySelector('h1')?.textContent).toBe('before hide');

    // A restore never re-runs this script. Without the lifecycle the runtime
    // would stay released here and the preview would look broken with no error.
    const restore = new Event('pageshow');
    Object.defineProperty(restore, 'persisted', { value: true });
    window.dispatchEvent(restore);

    await send('after restore');
    expect(document.querySelector('h1')?.textContent).toBe('after restore');
    api?.destroy();
  });

  it('ignores an ordinary pageshow, which already re-ran this script', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();

    // No `persisted` flag: a normal load. Resuming would rebuild a cache the
    // bootstrap above just built.
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'still live' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('still live');
    api?.destroy();
  });

  it('unbinds the lifecycle on destroy so a dead runtime cannot resurrect', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    api?.destroy();

    const restore = new Event('pageshow');
    Object.defineProperty(restore, 'persisted', { value: true });
    window.dispatchEvent(restore);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'must not land' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('old');
  });

  it('enumerateOrigins returns the trusted origin', async () => {
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(api?.enumerateOrigins()).toContain(TRUSTED);
    api?.destroy();
  });

  it('refresh() rebuilds the cache for newly added bindings', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
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
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
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
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig({
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

  it('still bootstraps when the default console warning sink throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('console unavailable');
    });
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig({
        additionalOrigins: [],
        disableReferrerDetection: true,
        disableLocalhostMatching: true,
      });
    try {
      const { bootstrapInlineRuntime } = await import('@core/runtime');
      const api = bootstrapInlineRuntime();

      expect(api).toBeDefined();
      api?.destroy();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('bootstrapInlineRuntime — non-preview context', () => {
  it('returns undefined when window.top equals window (no iframe, no popener)', async () => {
    Object.defineProperty(window, 'top', { value: window, configurable: true });
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
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
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig({
        debug: true,
      });
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(debug).toHaveBeenCalled();
    api?.destroy();
    debug.mockRestore();
  });

  it('observes a rejected console.debug thenable without aborting bootstrap', async () => {
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async console unavailable'));
      },
    );
    const debug = vi.spyOn(console, 'debug').mockReturnValue({ then } as never);
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig({ debug: true });
    try {
      const { bootstrapInlineRuntime } = await import('@core/runtime');
      const api = bootstrapInlineRuntime();
      await Promise.resolve();
      await Promise.resolve();

      expect(api).toBeDefined();
      expect(then).toHaveBeenCalled();
      api?.destroy();
    } finally {
      debug.mockRestore();
    }
  });
});

declare global {
  interface Window {
    __livePreview?: unknown;
  }
}

describe('bootstrapInlineRuntime — handover (F-36)', () => {
  it('a second bootstrap with the same configuration keeps the instance and rescans', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const first = bootstrapInlineRuntime();
    expect(first?.configSignature).toBeTypeOf('string');
    document.body.insertAdjacentHTML('beforeend', '<p data-payload-field="lede"></p>');
    const second = bootstrapInlineRuntime();
    expect(second).toBe(first);
    expect(window.__livePreview).toBe(first);
    expect(first?.inspect().bindings.elements).toBe(2);
    first?.destroy();
  });

  it('a second bootstrap with a different configuration hands over: new instance live first, old one destroyed', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const global = globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple };
    global.__LIVE_PREVIEW_CONFIG__ = bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const first = bootstrapInlineRuntime();
    const firstSignature = first?.configSignature;

    global.__LIVE_PREVIEW_CONFIG__ = bakeConfig({
      additionalOrigins: [TRUSTED, 'https://other.example'],
    });
    const second = bootstrapInlineRuntime();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(second?.configSignature).not.toBe(firstSignature);
    expect(window.__livePreview).toBe(second);
    expect(second?.inspect().started).toBe(true);
    expect(first?.inspect().started).toBe(false);
    expect(second?.enumerateOrigins()).toContain('https://other.example');

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'after handover' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('after handover');
    second?.destroy();
  });

  it('keeps an instance that predates configuration signatures and asks it to refresh', async () => {
    const refresh = vi.fn();
    const legacy = Object.freeze({
      version: '0.0.0',
      destroy: vi.fn(),
      refresh,
      enumerateOrigins: () => [],
      inspect: () => ({}) as never,
    });
    Object.defineProperty(window, '__livePreview', { value: legacy, configurable: true });
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    expect(bootstrapInlineRuntime()).toBe(legacy);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(legacy.destroy).not.toHaveBeenCalled();
  });
});

describe('bootstrapInlineRuntime — fragments (ADR 0011)', () => {
  it('wires the fragment client when the prelude is present and the wire slot names an endpoint', async () => {
    const { createFragmentStrategy, createRouteStrategy } = await import('@fragment/index');
    vi.stubGlobal('__LIVE_PREVIEW_FRAGMENT__', { createFragmentStrategy, createRouteStrategy });
    document.body.innerHTML =
      '<section data-payload-fragment="hero"><h1 data-payload-field="title">old</h1></section>';
    const tuple = [...bakeConfig(), '/payload/fragment'];
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: unknown }).__LIVE_PREVIEW_CONFIG__ = tuple;
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(api?.inspect().fragments.handler).toBe(true);
    api?.destroy();
    vi.unstubAllGlobals();
  });

  it('has no fragment client without the prelude, whatever the wire slot says', async () => {
    vi.stubGlobal('__LIVE_PREVIEW_FRAGMENT__', undefined);
    document.body.innerHTML = '';
    const tuple = [...bakeConfig(), '/payload/fragment'];
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: unknown }).__LIVE_PREVIEW_CONFIG__ = tuple;
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(api?.inspect().fragments.handler).toBe(false);
    api?.destroy();
    vi.unstubAllGlobals();
  });
});
