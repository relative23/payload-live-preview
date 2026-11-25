/**
 * Binds the document lifecycle the runtime cannot see: a back/forward-cache
 * restore re-runs no scripts, so a client that stayed attached comes back
 * bound to a frozen document and quietly stops updating; a soft navigation
 * replaces the content the binding cache describes. Both are silent failures.
 */

/** The part of the client this owner drives. */
export interface NavigationLifecycleTarget {
  suspend(): boolean;
  resume(): boolean;
  /** Re-scan bindings after replacing markup without crossing a navigation boundary. */
  refreshCache(): void;
  /** Re-scan and replay the last accepted document after a committed router navigation. */
  refreshAfterNavigation?(): void;
}

/** Package-owned event dispatched after a framework router commit. @internal */
export const NAVIGATION_COMMIT_EVENT = 'payload-live-preview:navigation';
const ASTRO_INITIAL_PAGE_LOAD_EVENT = 'astro:page-load';
const ASTRO_AFTER_SWAP_EVENT = 'astro:after-swap';

export interface NavigationLifecycleOptions {
  /** Where `pagehide`/`pageshow` fire; they exist only on the window. Defaults to `window`. */
  readonly windowTarget?: EventTarget;
  /** Event target for soft-navigation events. Defaults to `document`. */
  readonly documentTarget?: EventTarget;
  /**
   * Events after which the DOM was replaced and the current editor state must
   * be replayed, e.g. `astro:page-load`. Empty by default: only the host knows
   * which its router fires.
   */
  readonly softNavigationEvents?: readonly string[];
}

/** Returns an unbind function; calling it twice is harmless. */
export function bindNavigationLifecycle(
  target: NavigationLifecycleTarget,
  options: NavigationLifecycleOptions = {},
): () => void {
  const windowTarget = options.windowTarget ?? (globalThis as { window?: EventTarget }).window;
  const documentTarget =
    options.documentTarget ?? (globalThis as { document?: EventTarget }).document;
  const softEvents = [...new Set(options.softNavigationEvents ?? [])];

  const onPageHide = (): void => {
    target.suspend();
  };
  const onPageShow = (event: Event): void => {
    // Only a persisted restore needs reacquiring; an ordinary load already started.
    if ((event as Event & { readonly persisted?: boolean }).persisted === true) {
      target.resume();
    }
  };
  let astroNavigationArmed = false;
  const onAstroAfterSwap = (): void => {
    astroNavigationArmed = true;
  };
  const onSoftNavigation = (event: Event): void => {
    // Astro emits page-load for the initial document too. A client-router
    // commit is the page-load preceded by after-swap, including before the
    // browser's initial `load` when a subresource is slow.
    if (event.type === ASTRO_INITIAL_PAGE_LOAD_EVENT) {
      if (!astroNavigationArmed) return;
      astroNavigationArmed = false;
    }
    if (target.refreshAfterNavigation === undefined) target.refreshCache();
    else target.refreshAfterNavigation();
  };

  let unbound = false;

  windowTarget?.addEventListener('pagehide', onPageHide);
  windowTarget?.addEventListener('pageshow', onPageShow);
  for (const name of softEvents) documentTarget?.addEventListener(name, onSoftNavigation);
  const observesAstro = softEvents.includes(ASTRO_INITIAL_PAGE_LOAD_EVENT);
  if (observesAstro) documentTarget?.addEventListener(ASTRO_AFTER_SWAP_EVENT, onAstroAfterSwap);

  return (): void => {
    if (unbound) return;
    unbound = true;
    windowTarget?.removeEventListener('pagehide', onPageHide);
    windowTarget?.removeEventListener('pageshow', onPageShow);
    for (const name of softEvents) documentTarget?.removeEventListener(name, onSoftNavigation);
    if (observesAstro) {
      documentTarget?.removeEventListener(ASTRO_AFTER_SWAP_EVENT, onAstroAfterSwap);
    }
  };
}
