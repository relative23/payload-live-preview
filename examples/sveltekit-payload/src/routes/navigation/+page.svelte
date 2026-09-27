<script>
  /**
   * A hydrated page whose keyed heading is replaced on every query navigation.
   * The bridge is removed on the `off` step so its route-refresh cleanup is observable.
   */
  import NavigationBridge from './NavigationBridge.svelte';

  export let data;
</script>

{#if data.bridge}
  <NavigationBridge />
{/if}

<article class="grid" {...data.bindings.owner}>
  <p data-testid="navigation-generation">{data.generation}</p>
  {#if data.step === 'stream'}
    {#await data.streamedTitle}
      <p data-testid="streamed-title-pending">Waiting for streamed title…</p>
    {:then streamedTitle}
      <h1 {...data.bindings.title}>{streamedTitle}</h1>
    {/await}
  {:else}
    {#key data.generation}
      <h1 {...data.bindings.title}>Server title for {data.step}</h1>
    {/key}
  {/if}
  <nav aria-label="Soft navigation fixture">
    <a data-testid="navigate-two" href={data.links.two}>Navigate to two</a>
    <a data-testid="navigate-slow" href={data.links.slow}>Start slow navigation</a>
    <a data-testid="navigate-stream" href={data.links.stream}>Stream a late binding</a>
    <a data-testid="navigate-final" href={data.links.final}>Navigate to final</a>
    <a data-testid="navigate-off" href={data.links.off}>Unmount bridge</a>
  </nav>
</article>
