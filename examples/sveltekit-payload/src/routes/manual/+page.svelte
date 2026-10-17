<script>
  /**
   * The text is static, so a title or subtitle that changes on this page came from the admin's
   * messages. See `+page.server.ts`.
   */
  export let data;
</script>

<svelte:head>
  <title>A collection with a fixed URL</title>
</svelte:head>

<article {...data.owner} data-testid="document">
  <h1 {...data.title} data-testid="title">Static initial title</h1>
  <p {...data.subtitle} data-testid="subtitle">Static initial subtitle</p>
</article>
