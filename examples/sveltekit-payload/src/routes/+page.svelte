<script>
  /**
   * Preview target page. Mounted by the mock admin (and by tests) inside
   * an iframe. Every binding here comes from `createPreviewBindings` in
   * `+page.server.ts`, keyed on the hook's authorization verdict: on a
   * public response the spreads contribute nothing, and the markup carries
   * no `data-payload-*` attribute at all.
   *
   * In a real SvelteKit project the initial values would come from Payload
   * via `fetchPreviewDocument({ authorization })`; for the example they are
   * hard-coded.
   *
   * The markup mirrors `examples/astro-payload/src/pages/index.astro`
   * one-to-one (same field names, same attributes) so both example apps
   * exercise the exact same runtime surface.
   */
  export let data;
  const initial = {
    title: 'Hello from the demo',
    subtitle: 'Type in the admin panel to see live updates.',
    hero: {
      url: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200',
      alt: 'Mountains at dusk',
    },
    count: 12,
    publishedAt: '2025-04-12T08:30:00.000Z',
    tags: ['sveltekit', 'payload', 'live-preview'],
    ctaLabel: 'Visit Payload',
    ctaUrl: 'https://payloadcms.com',
  };
  const b = data.bindings;
</script>

<svelte:head>
  <title>Live Preview Demo</title>
</svelte:head>

<article class="grid" {...b.owner}>
  <header class="grid">
    <h1 {...b.title}>{initial.title}</h1>
    <p {...b.subtitle}>{initial.subtitle}</p>
  </header>
  <img {...b.hero} src={initial.hero.url} alt={initial.hero.alt} />
  <div {...b.body}>
    <h2>Rich text from Lexical</h2>
    <p>Mix of <strong>bold</strong>, <em>italic</em>, and <a href="https://example.com">links</a>.</p>
  </div>
  <p>
    Count: <span {...b.count}>{initial.count}</span>
  </p>
  <p>
    Published:
    <time {...b.publishedAt} datetime={initial.publishedAt}>{initial.publishedAt}</time>
  </p>
  <ul class="tags" {...b.tags}>
    {#each initial.tags as tag (tag)}
      <li>{tag}</li>
    {/each}
  </ul>
  <p>
    <a {...b.ctaLabel} href={initial.ctaUrl} target="_blank" rel="noopener noreferrer"
      >{initial.ctaLabel}</a
    >
  </p>
</article>

<style>
  /* Everything is `:global(...)`: the array renderer replaces the tag
     <li> nodes at runtime, and freshly inserted nodes would not carry
     Svelte's scoping class — unscoped selectors keep them styled. */
  :global(:root) {
    color-scheme: light dark;
    font-family:
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
  }
  :global(body) {
    margin: 0;
    padding: 2rem;
    max-width: 720px;
    margin-inline: auto;
  }
  :global([data-payload-field]) {
    transition: background-color 0.3s ease;
  }
  :global(img) {
    max-width: 100%;
    border-radius: 8px;
  }
  :global(ul.tags) {
    list-style: none;
    padding: 0;
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  :global(ul.tags li) {
    background: rgba(0, 102, 204, 0.1);
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    font-size: 0.85rem;
  }
  :global(time) {
    color: rgba(0, 0, 0, 0.6);
    font-size: 0.9rem;
  }
  :global(.grid) {
    display: grid;
    gap: 1rem;
  }
</style>
