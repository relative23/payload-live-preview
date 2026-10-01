<script lang="ts">
  /**
   * Preview target for the fragment strategy. The boundary is re-rendered by
   * the server on every revision; the footer outside it keeps being patched in
   * place, so one page shows both strategies at once.
   */
  import Hero from '$lib/Hero.svelte';
  // Every component a fragment may render is part of the page, so its scoped
  // CSS is linked before the first unsaved value needs it (ADR 0029).
  import Notice from '$lib/Notice.svelte';

  export let data;
</script>

<svelte:head>
  <title>Hybrid preview</title>
</svelte:head>

<main {...data.bindings.owner}>
  <section {...data.boundary}>
    <Hero {...data.hero} bindings={{ title: data.bindings.title, body: data.bindings.body }} />
  </section>
  <aside {...data.noticeBoundary} data-testid="notice-boundary"><Notice text="" edition={data.edition} /></aside>
  <footer {...data.bindings.footer} data-testid="footer">patched, not rendered</footer>
</main>
