/**
 * Document-lifecycle owner for the live-preview client.
 *
 * The runtime learns about messages, not about navigation. Two browser
 * behaviours make that gap visible, and both are silent:
 *
 *   - A **back/forward-cache restore** does not re-run module scripts. A client
 *     that stays attached across `pagehide` comes back bound to a document the
 *     browser froze and thawed, and simply stops updating.
 *   - A **soft navigation** replaces page content without a new document. The
 *     bindings the cache holds are gone, and nothing tells the runtime.
 *
 * This binds both to `suspend()`/`resume()`/`refreshCache()` in one place, so a
 * consumer that uses no framework adapter can own the lifecycle with one call
 * instead of re-deriving it — which is what every integration has had to do so
 * far.
 *
 * @module @client/navigation-lifecycle
 */

/** The part of the client this owner drives. */
export interface NavigationLifecycleTarget {
  suspend(): boolean;
  resume(): boolean;
  refreshCache(): void;
}

export interface NavigationLifecycleOptions {
  /**
   * Event target for `pagehide`/`pageshow`. Defaults to `window`.
   *
   * These fire on the window, not the document, and only there — binding them
   * anywhere else silently never fires.
   */
  readonly windowTarget?: EventTarget;
  /**
   * Event target for soft-navigation events. Defaults to `document`.
   */
  readonly documentTarget?: EventTarget;
  /**
   * Soft-navigation events after which the DOM has been replaced and the
   * binding cache has to be rebuilt — for example `astro:page-load`.
   *
   * Empty by default: the package cannot know which framework is present, and
   * guessing would either miss the event or rebuild on an unrelated one.
   */
  readonly softNavigationEvents?: readonly string[];
}

/**
 * Bind the document lifecycle. Returns an unbind function; calling it twice is
 * harmless.
 */
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
    // Only a *persisted* restore needs reacquiring. An ordinary load already
    // ran the module scripts, and resuming there would rebuild a cache the
    // startup just built.
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
