<script>
  /**
   * Two documents, one server-rendered panel and one island each. See
   * `+page.server.ts`.
   */
  import OwnedPanel from '$lib/OwnedPanel.svelte';

  export let data;
</script>

<svelte:head>
  <title>Two documents, two boundaries</title>
</svelte:head>

<main>
  {#each [data.a, data.b] as side (side.name)}
    <section {...side.owner} data-testid={`doc-${side.name}`}>
      <div {...side.boundary}>
        <OwnedPanel {...side.panel} bindings={side.bindings} />
      </div>
      <div data-payload-island data-testid={`island-${side.name}`}></div>
    </section>
  {/each}
</main>
