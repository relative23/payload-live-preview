<script lang="ts">
  /**
   * SvelteKit owns both lifecycle seams: afterNavigate identifies a committed
   * client navigation, while invalidateAll settles after refreshed data renders.
   */
  import { afterNavigate, invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { registerRouteRefresh } from 'payload-live-preview';

  const NAVIGATION_COMMIT_EVENT = 'payload-live-preview:navigation';

  afterNavigate(({ from }) => {
    if (from === null) return;
    document.dispatchEvent(new Event(NAVIGATION_COMMIT_EVENT));
  });

  onMount(() =>
    registerRouteRefresh(async () => {
      await invalidateAll();
      await tick();
    }),
  );
</script>
