import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HYDRATION_WAIT_CAP_MS } from '@core/hydration';
import {
  SVELTEKIT_ANNOUNCER_ID,
  SVELTEKIT_GLOBAL_PREFIX,
  whenSvelteKitMounted,
} from '@core/hydration-sveltekit';

/**
 * The seam the ADR 0015 addendum of 2026-10-01 describes: SvelteKit's start
 * script leaves a global on a page it will hydrate, and its root renders the
 * route announcer once it has mounted. The tests play SvelteKit: they assign
 * the global and append the announcer the way the generated root does, and
 * never import SvelteKit, so what is asserted is those two facts and not a
 * SvelteKit version.
 */

const DEV_GLOBAL = `${SVELTEKIT_GLOBAL_PREFIX}dev`;
const win = window as unknown as Record<string, unknown>;

function announcer(id = SVELTEKIT_ANNOUNCER_ID): void {
  const element = document.createElement('div');
  element.id = id;
  document.getElementById('app')?.append(element);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<div id="app" style="display: contents"><h1 data-payload-field="title">Hello</h1></div>';
  win[DEV_GLOBAL] = { base: '' };
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of Object.keys(win)) {
    if (key.startsWith(SVELTEKIT_GLOBAL_PREFIX)) Reflect.deleteProperty(win, key);
  }
  document.body.innerHTML = '';
});

describe('waiting for the SvelteKit root', () => {
  it('settles when the announcer appears, once, and stops observing', async () => {
    const onSettled = vi.fn();
    expect(whenSvelteKitMounted(document, onSettled)).not.toBeNull();

    announcer('svelte-other');
    await vi.advanceTimersByTimeAsync(0);
    expect(onSettled).not.toHaveBeenCalled();

    announcer();
    await vi.advanceTimersByTimeAsync(0);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith('committed');

    document.getElementById(SVELTEKIT_ANNOUNCER_ID)?.remove();
    announcer();
    await vi.advanceTimersByTimeAsync(HYDRATION_WAIT_CAP_MS);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('reads the production global, named after the app version, as well', async () => {
    Reflect.deleteProperty(win, DEV_GLOBAL);
    win[`${SVELTEKIT_GLOBAL_PREFIX}1x7f9qa`] = { base: '' };
    const onSettled = vi.fn();

    expect(whenSvelteKitMounted(document, onSettled)).not.toBeNull();
    announcer();
    await vi.advanceTimersByTimeAsync(0);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith('committed');
  });

  it('has nothing to wait for on a page without the client (csr = false)', () => {
    Reflect.deleteProperty(win, DEV_GLOBAL);
    const onSettled = vi.fn();

    expect(whenSvelteKitMounted(document, onSettled)).toBeNull();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('has nothing to wait for once the root has mounted (asset delivery, bfcache)', () => {
    announcer();
    const onSettled = vi.fn();

    expect(whenSvelteKitMounted(document, onSettled)).toBeNull();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('looks in the document of a runtime scoped to an element', async () => {
    const root = document.querySelector('h1');
    if (root === null) throw new Error('fixture missing');
    const onSettled = vi.fn();

    whenSvelteKitMounted(root, onSettled);
    announcer();
    await vi.advanceTimersByTimeAsync(0);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith('committed');
  });

  it('times out at the cap and then ignores a late mount', async () => {
    const onSettled = vi.fn();
    whenSvelteKitMounted(document, onSettled, 1000);

    await vi.advanceTimersByTimeAsync(999);
    expect(onSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith('timed-out');

    announcer();
    await vi.advanceTimersByTimeAsync(0);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('a cancel ends both the observer and the cap', async () => {
    const onSettled = vi.fn();
    const cancel = whenSvelteKitMounted(document, onSettled);

    cancel?.();
    announcer();
    await vi.advanceTimersByTimeAsync(HYDRATION_WAIT_CAP_MS);
    expect(onSettled).not.toHaveBeenCalled();
  });
});
