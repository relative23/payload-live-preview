<script lang="ts">
  /**
   * Preview target for the fragment strategy. The boundary is re-rendered by
   * the server on every revision; the footer outside it keeps being patched in
   * place, so one page shows both strategies at once.
   */
  import Hero from '$lib/Hero.svelte';

  export let data;
</script>

<svelte:head>
  <title>Hybrid preview</title>
</svelte:head>

<main {...data.bindings.owner}>
  <section {...data.boundary}>
    <Hero {...data.hero} bindings={{ title: data.bindings.title, body: data.bindings.body }} />
  </section>
  <footer {...data.bindings.footer} data-testid="footer">patched, not rendered</footer>
</main>
