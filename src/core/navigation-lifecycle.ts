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
  refreshCache(): void;
}

export interface NavigationLifecycleOptions {
  /** Where `pagehide`/`pageshow` fire; they exist only on the window. Defaults to `window`. */
  readonly windowTarget?: EventTarget;
  /** Event target for soft-navigation events. Defaults to `document`. */
  readonly documentTarget?: EventTarget;
  /**
   * Events after which the DOM was replaced and the cache must be rebuilt, e.g.
   * `astro:page-load`. Empty by default: only the host knows which its router fires.
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
  const softEvents = options.softNavigationEvents ?? [];

  const onPageHide = (): void => {
    target.suspend();
  };
  const onPageShow = (event: Event): void => {
    // Only a persisted restore needs reacquiring; an ordinary load already started.
    if ((event as Event & { readonly persisted?: boolean }).persisted === true) {
      target.resume();
    }
  };
  const onSoftNavigation = (): void => {
    target.refreshCache();
  };

  windowTarget?.addEventListener('pagehide', onPageHide);
  windowTarget?.addEventListener('pageshow', onPageShow);
  for (const name of softEvents) documentTarget?.addEventListener(name, onSoftNavigation);

  let unbound = false;
  return (): void => {
    if (unbound) return;
    unbound = true;
    windowTarget?.removeEventListener('pagehide', onPageHide);
    windowTarget?.removeEventListener('pageshow', onPageShow);
    for (const name of softEvents) documentTarget?.removeEventListener(name, onSoftNavigation);
  };
}
