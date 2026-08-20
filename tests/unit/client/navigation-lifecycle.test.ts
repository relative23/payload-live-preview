import { describe, expect, it, vi } from 'vitest';
import { bindNavigationLifecycle } from '@client/navigation-lifecycle';

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
      softNavigationEvents: ['astro:page-load'],
    });

    documentTarget.dispatchEvent(new Event('astro:page-load'));
    expect(client.refreshCache).toHaveBeenCalledOnce();

    // Nothing is bound by default: the package cannot know which framework is
    // present, and guessing would fire on the wrong event or miss the right one.
    documentTarget.dispatchEvent(new Event('turbo:load'));
    expect(client.refreshCache).toHaveBeenCalledOnce();

    unbind();
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
