/**
 * Nuxt's loading-end hook fires after both Suspense page commits and same-key
 * route updates. Route refreshes wait for async data and one Vue tick before
 * the runtime reapplies a revision.
 */

import { nextTick } from 'vue';
import { registerRouteRefresh } from 'payload-live-preview';

const NAVIGATION_COMMIT_EVENT = 'payload-live-preview:navigation';

export default defineNuxtPlugin((nuxtApp) => {
  let committedRoute = nuxtApp.$router.currentRoute.value.fullPath;
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
  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    removeLoadingEnd();
    removeRefresh();
    window.removeEventListener('pagehide', onPageHide);
  }
  function onPageHide(event: PageTransitionEvent): void {
    // A bfcache page keeps its Nuxt app. Leave the bridge in place so it is
    // still available after `pageshow`; an ordinary unload can release it.
    if (!event.persisted) cleanup();
  }
  window.addEventListener('pagehide', onPageHide);
  import.meta.hot?.dispose(cleanup);
});
