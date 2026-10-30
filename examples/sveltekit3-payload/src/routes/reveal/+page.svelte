<script>
  /**
   * Reveal-edited-field target. `footer` sits below a 2,200px spacer,
   * off-screen on load; editing it must scroll it into view. Unlike `/`,
   * this route keeps client-side rendering on, so the row also measures what
   * Svelte's hydration does to a value the runtime wrote before it.
   */
  export let data;
  const b = data.bindings;
</script>

<svelte:head>
  <title>Reveal fixture</title>
</svelte:head>

<main style="margin:0;font:16px/1.5 system-ui,sans-serif">
  <h1 {...b.owner} {...b.heroTitle} data-testid="hero">Top</h1>
  <div style="height:2200px">scroll down for the footer</div>
  <p {...b.owner} {...b.footer} data-testid="footer">old footer</p>
</main>
