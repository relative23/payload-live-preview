import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Exercise the bootstrap source, not only the artifact built from it.
 *
 * `tests/unit/inline-loader.test.ts` runs the *built* string in a VM, which is
 * what a browser sees and therefore the more faithful test. It cannot measure
 * the TypeScript, though, and an untested branch here is a page that either
 * never loads the runtime or loads it for every visitor — the two failures the
 * whole mode exists to avoid.
 */
function stubTopFrame(inIframe: boolean): void {
  Object.defineProperty(window, 'top', {
    configurable: true,
    value: inIframe ? { nope: true } : window,
  });
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'top', { configurable: true, value: window });
  document.head.querySelectorAll('script').forEach((node) => {
    node.remove();
  });
});

describe('the bootstrap source', () => {
  it('appends nothing when the page is not a preview', async () => {
    stubTopFrame(false);
    vi.stubGlobal('__LP_RUNTIME_SRC__', '/rt.js');
    vi.stubGlobal('__LP_RUNTIME_INTEGRITY__', '');

    await import('@core/loader');

    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('appends the runtime with integrity when the page is a preview', async () => {
    stubTopFrame(true);
    vi.stubGlobal('__LP_RUNTIME_SRC__', '/rt.abc.js');
    vi.stubGlobal('__LP_RUNTIME_INTEGRITY__', 'sha384-xyz');

    await import('@core/loader');

    const script = document.head.querySelector('script');
    expect(script?.getAttribute('src')).toBe('/rt.abc.js');
    // jsdom sets the `integrity` property but never reflects it to an
    // attribute, unlike `crossOrigin`. Assert what the code writes and a
    // browser reads; an attribute assertion here can only ever be vacuous.
    expect(script?.integrity).toBe('sha384-xyz');
    expect(script?.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('leaves integrity off when none was declared', async () => {
    // A same-origin deployment that ships page and asset together may skip the
    // hash; an empty `integrity` attribute would fail the check outright.
    stubTopFrame(true);
    vi.stubGlobal('__LP_RUNTIME_SRC__', '/rt.js');
    vi.stubGlobal('__LP_RUNTIME_INTEGRITY__', '');

    await import('@core/loader');

    const script = document.head.querySelector('script');
    expect(script?.getAttribute('src')).toBe('/rt.js');
    // Property, not attribute: this jsdom does not implement `integrity` as an
    // IDL attribute at all — assigning it creates an expando and nothing is
    // reflected. So "untouched" reads as `undefined`, and `hasAttribute` would
    // report false even if the code had set it.
    expect(script?.integrity).toBeUndefined();
    expect(script?.hasAttribute('crossorigin')).toBe(false);
  });
});
