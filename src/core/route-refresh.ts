/**
 * The seam between a host framework's own router and the route strategy.
 *
 * The route strategy answers a revision by fetching the route and morphing it
 * into the living page. On a page whose DOM belongs to a reconciler that is
 * working against the framework, and it was seen to break once: `removeChild`
 * on `null` inside React's commit phase, over markup this package had patched.
 * A host that re-renders the route itself does the same job without the morph
 * and without the second HTML request, so it is given the chance to.
 *
 * Why a named slot on `window` and not a reference: the runtime is an inline
 * script that builds its strategy before any application code has hydrated, so
 * there is nothing to hand a component; `window.__livePreview`, the only other
 * public surface, is created later and not at all outside a preview; and the
 * two richer extension points — plugins and events — are reachable only through
 * the programmatic client, which a page using an adapter does not have. One
 * slot, written by whoever mounts and read at the moment of a refresh, is the
 * smallest thing that survives both orders of arrival.
 */

/**
 * A host's own route refresh. It must settle once the fresh markup is
 * committed: the runtime re-applies the revision on top of it, and doing that
 * against the markup being replaced would write into nodes about to be dropped.
 */
export type RouteRefresh = () => void | Promise<void>;

/** Read late, so it does not matter whether the runtime or the component came first. */
const SLOT = '__livePreviewRouteRefresh';

type WindowSlot = Record<string, RouteRefresh | undefined>;

function slot(): WindowSlot | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as WindowSlot);
}

/**
 * Lend the runtime the host's route refresh; the return value undoes it, for a
 * component's cleanup. A later registration wins, and undoing one that has
 * already been replaced does nothing — two components on one page would
 * otherwise take the slot from each other on unmount.
 */
export function registerRouteRefresh(refresh: RouteRefresh): () => void {
  const target = slot();
  if (target === undefined) return () => undefined;
  target[SLOT] = refresh;
  return () => {
    // Cleared rather than deleted: the slot is read through `?.` anyway, and
    // removing the key buys nothing a lint rule would not have to be argued out of.
    if (target[SLOT] === refresh) target[SLOT] = undefined;
  };
}

/** The registered refresh, or `undefined` on a page that registered none. */
export function readRouteRefresh(): RouteRefresh | undefined {
  return slot()?.[SLOT];
}
