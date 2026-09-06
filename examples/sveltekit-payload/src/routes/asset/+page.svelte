<script>
  /**
   * The bootstrap half of the fixture. `hooks.server.ts` gives this route
   * `delivery: 'asset'`, so the page carries a few hundred bytes and the
   * runtime arrives from `/payload-live-preview/runtime.<hash>.js`. Small on
   * purpose: what it demonstrates is the delivery, not the binding vocabulary.
   */
  export let data;
  const initial = {
    title: 'Hello from the demo',
    subtitle: 'Type in the admin panel to see live updates.',
    count: 12,
  };
  const b = data.bindings;
</script>

<svelte:head>
  <title>Live Preview Demo — asset delivery</title>
</svelte:head>

<article class="grid" {...b.owner}>
  <h1 {...b.title}>{initial.title}</h1>
  <p {...b.subtitle}>{initial.subtitle}</p>
  <p>Count: <span {...b.count}>{initial.count}</span></p>
</article>
