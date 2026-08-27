<script>
  /**
   * Two documents, one field name. See `+page.server.ts`.
   */
  export let data;
</script>

<svelte:head>
  <title>Two documents, one field name</title>
</svelte:head>

<main>
  <section {...data.a.owner} data-testid="doc-a">
    <h1 {...data.a.title}>Title of A</h1>
  </section>
  <section {...data.b.owner} data-testid="doc-b">
    <h1 {...data.b.title}>Title of B</h1>
  </section>
</main>
