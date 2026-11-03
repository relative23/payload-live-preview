/**
 * The client half of the Nuxt module: what the plugin it registers runs in the
 * browser. It tells the runtime when a client navigation has committed and
 * lends it `refreshNuxtData()` for route updates, the glue a Nuxt preview kept
 * in its own `plugins/` before 2.4.
 *
 * Nuxt's composables are passed in by the generated plugin, which imports them
 * from `#app`; that alias exists only inside a Nuxt build. The app is
 * duck-typed for the same reason the module is: no build-time `nuxt` types.
 */

import { nextTick } from 'vue';
import { NAVIGATION_COMMIT_EVENT } from '@core/navigation-lifecycle';
import { registerRouteRefresh } from '@core/route-refresh';

/** The part of the Nuxt app this reads: its router and one hook. */
export interface NuxtNavigationApp {
  readonly $router: { readonly currentRoute: { readonly value: { readonly fullPath: string } } };
  readonly hook: (name: 'page:loading:end', callback: () => void) => () => void;
}

/**
 * Binds both seams and returns their cleanup. The plugin also hands the cleanup
 * to hot replacement; an ordinary unload runs it, a back/forward-cache entry
 * keeps the bridge for its `pageshow`.
 */
export function bindNuxtNavigation(
  nuxtApp: NuxtNavigationApp,
  refreshNuxtData: () => Promise<unknown>,
): () => void {
  let committedRoute = nuxtApp.$router.currentRoute.value.fullPath;
  // `page:loading:end` follows a page commit and a same-page query update,
  // where Nuxt emits no `page:finish`. Reading the route at once keeps a
  // redirect from letting an earlier completion claim the later route.
  const removeLoadingEnd = nuxtApp.hook('page:loading:end', () => {
    const route = nuxtApp.$router.currentRoute.value.fullPath;
    if (route === committedRoute) return;
    committedRoute = route;
    document.dispatchEvent(new Event(NAVIGATION_COMMIT_EVENT));
  });
  const removeRefresh = registerRouteRefresh(async () => {
    await refreshNuxtData();
    await nextTick();
  });

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    removeLoadingEnd();
    removeRefresh();
    window.removeEventListener('pagehide', onPageHide);
  };
  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) cleanup();
  };
  window.addEventListener('pagehide', onPageHide);
  return cleanup;
}
