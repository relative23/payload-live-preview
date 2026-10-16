import { describe, expect, it, vi } from 'vitest';
import { bindNavigationLifecycle } from '@core/navigation-lifecycle';

function target() {
  return {
    suspend: vi.fn(() => true),
    resume: vi.fn(() => true),
    refreshCache: vi.fn(),
  };
}

describe('bindNavigationLifecycle', () => {
  it('suspends on pagehide and resumes only for a persisted restore', () => {
    const windowTarget = new EventTarget();
    const client = target();
    const unbind = bindNavigationLifecycle(client, { windowTarget });

    windowTarget.dispatchEvent(new Event('pagehide'));
    expect(client.suspend).toHaveBeenCalledOnce();

    // An ordinary load already re-ran the module scripts; resuming there would
    // rebuild a cache that startup just built.
    windowTarget.dispatchEvent(new Event('pageshow'));
    expect(client.resume).not.toHaveBeenCalled();

    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    windowTarget.dispatchEvent(restored);
    expect(client.resume).toHaveBeenCalledOnce();

    unbind();
  });

  it('rebuilds the cache on the soft-navigation events it was given, and no others', () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const client = target();
    const unbind = bindNavigationLifecycle(client, {
      windowTarget,
      documentTarget,
      softNavigationEvents: ['framework:navigated'],
    });

    documentTarget.dispatchEvent(new Event('framework:navigated'));
    expect(client.refreshCache).toHaveBeenCalledOnce();

    // Nothing is bound by default: the package cannot know which framework is
    // present, and guessing would fire on the wrong event or miss the right one.
    documentTarget.dispatchEvent(new Event('turbo:load'));
    expect(client.refreshCache).toHaveBeenCalledOnce();

    unbind();
  });

  it('uses the navigation-specific handoff without also running the compatibility fallback', () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const client = { ...target(), refreshAfterNavigation: vi.fn() };
    const unbind = bindNavigationLifecycle(client, {
      windowTarget,
      documentTarget,
      softNavigationEvents: ['payload-live-preview:navigation'],
    });

    documentTarget.dispatchEvent(new Event('payload-live-preview:navigation'));

    expect(client.refreshAfterNavigation).toHaveBeenCalledOnce();
    expect(client.refreshCache).not.toHaveBeenCalled();
    unbind();
  });

  it('does not delay an explicit router commit while the initial page is still loading', () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    Object.defineProperty(documentTarget, 'readyState', {
      configurable: true,
      value: 'loading',
    });
    const client = { ...target(), refreshAfterNavigation: vi.fn() };
    const unbind = bindNavigationLifecycle(client, {
      windowTarget,
      documentTarget,
      softNavigationEvents: ['payload-live-preview:navigation'],
    });

    documentTarget.dispatchEvent(new Event('payload-live-preview:navigation'));

    expect(client.refreshAfterNavigation).toHaveBeenCalledOnce();
    unbind();
  });

  it('ignores Astro initial page-load but accepts a pre-load client-router commit', () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    Object.defineProperty(documentTarget, 'readyState', {
      configurable: true,
      value: 'loading',
    });
    const client = target();
    const unbind = bindNavigationLifecycle(client, {
      windowTarget,
      documentTarget,
      softNavigationEvents: ['astro:page-load'],
    });
    documentTarget.dispatchEvent(new Event('astro:page-load'));
    expect(client.refreshCache).not.toHaveBeenCalled();

    documentTarget.dispatchEvent(new Event('astro:after-swap'));
    documentTarget.dispatchEvent(new Event('astro:page-load'));
    expect(client.refreshCache).toHaveBeenCalledOnce();
    unbind();
  });

  it('guards only the initial Astro signal in a mixed event list', () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    Object.defineProperty(documentTarget, 'readyState', {
      configurable: true,
      value: 'loading',
    });
    const client = { ...target(), refreshAfterNavigation: vi.fn() };
    const unbind = bindNavigationLifecycle(client, {
      windowTarget,
      documentTarget,
      softNavigationEvents: ['astro:page-load', 'payload-live-preview:navigation'],
    });

    documentTarget.dispatchEvent(new Event('payload-live-preview:navigation'));
    documentTarget.dispatchEvent(new Event('astro:page-load'));
    expect(client.refreshAfterNavigation).toHaveBeenCalledOnce();

    documentTarget.dispatchEvent(new Event('astro:after-swap'));
    documentTarget.dispatchEvent(new Event('astro:page-load'));
    expect(client.refreshAfterNavigation).toHaveBeenCalledTimes(2);
    unbind();
  });

  it('removes Astro arm and commit listeners on teardown', () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const client = target();
    const unbind = bindNavigationLifecycle(client, {
      windowTarget,
      documentTarget,
      softNavigationEvents: ['astro:page-load'],
    });

    unbind();
    documentTarget.dispatchEvent(new Event('astro:after-swap'));
    documentTarget.dispatchEvent(new Event('astro:page-load'));

    expect(client.refreshCache).not.toHaveBeenCalled();
  });

  it('binds nothing implicitly when no soft-navigation event is declared', () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const client = target();
    const unbind = bindNavigationLifecycle(client, { windowTarget, documentTarget });

    documentTarget.dispatchEvent(new Event('astro:page-load'));
    expect(client.refreshCache).not.toHaveBeenCalled();

    unbind();
  });

  it('unbinds every listener, and unbinding twice is harmless', () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const client = target();
    const unbind = bindNavigationLifecycle(client, {
      windowTarget,
      documentTarget,
      softNavigationEvents: ['astro:page-load'],
    });

    unbind();
    unbind();

    windowTarget.dispatchEvent(new Event('pagehide'));
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    windowTarget.dispatchEvent(restored);
    documentTarget.dispatchEvent(new Event('astro:page-load'));

    expect(client.suspend).not.toHaveBeenCalled();
    expect(client.resume).not.toHaveBeenCalled();
    expect(client.refreshCache).not.toHaveBeenCalled();
  });
});
