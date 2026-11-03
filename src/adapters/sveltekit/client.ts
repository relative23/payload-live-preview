/**
 * `livePreviewNavigation()` — the SvelteKit glue a preview needed in its own
 * layout before 2.4: it tells the runtime when a client navigation has
 * committed and lends it `invalidateAll()` for route updates. Call it from the
 * script of a layout that stays mounted across the preview routes.
 *
 * SvelteKit's two functions are passed in rather than imported: `$app/*` exists
 * only inside a Kit build, and a package that imports it has to be compiled by
 * the app as a Svelte library, which would change how Vite treats every other
 * import of this package. `svelte` itself is an optional peer.
 */

import { onMount, tick } from 'svelte';
import { NAVIGATION_COMMIT_EVENT } from '@core/navigation-lifecycle';
import { registerRouteRefresh } from '@core/route-refresh';

/** The part of SvelteKit's `AfterNavigate` this reads; Kit 2 has no `shallow`. */
export interface CommittedNavigation {
  readonly from: unknown;
  readonly type?: string;
  readonly shallow?: boolean;
}

/** SvelteKit's own `afterNavigate` and `invalidateAll` from `$app/navigation`. */
export interface SvelteKitNavigation {
  readonly afterNavigate: (callback: (navigation: CommittedNavigation) => void) => void;
  readonly invalidateAll: () => Promise<void>;
}

/**
 * Must run while the component initialises, as `afterNavigate` must.
 *
 * ```svelte
 * <script lang="ts">
 *   import { afterNavigate, invalidateAll } from '$app/navigation';
 *   import { livePreviewNavigation } from 'payload-live-preview/sveltekit/client';
 *
 *   livePreviewNavigation({ afterNavigate, invalidateAll });
 * </script>
 * ```
 */
export function livePreviewNavigation({ afterNavigate, invalidateAll }: SvelteKitNavigation): void {
  afterNavigate((navigation) => {
    // The mount call has no `from`: startup already applies the editor's document.
    if (navigation.from === null) return;
    // A shallow `goto` (SvelteKit 3) keeps the rendered route; it only sets page state.
    if (navigation.shallow === true && navigation.type === 'goto') return;
    document.dispatchEvent(new Event(NAVIGATION_COMMIT_EVENT));
  });
  // `invalidateAll()` settles the route's loads; `tick()` the DOM they render.
  // The returned cleanup gives the registration back when the layout unmounts.
  onMount(() =>
    registerRouteRefresh(async () => {
      await invalidateAll();
      await tick();
    }),
  );
}
