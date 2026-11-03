<script lang="ts">
  /**
   * The package's navigation bridge, handed SvelteKit's own two functions:
   * afterNavigate names a committed client navigation, invalidateAll settles
   * a route refresh after the refreshed data renders.
   */
  import { afterNavigate, invalidateAll } from '$app/navigation';
  import { livePreviewNavigation } from 'payload-live-preview/sveltekit/client';

  livePreviewNavigation({ afterNavigate, invalidateAll });
</script>
