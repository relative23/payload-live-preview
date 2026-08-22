<script setup lang="ts">
/**
 * Preview target page. Mounted by the mock admin (and by tests) inside an
 * iframe. Every binding here is annotated with `data-payload-field` so the
 * live preview engine picks it up automatically.
 *
 * In a real Nuxt project these initial values would come from Payload via
 * `useAsyncData`; for the example we hard-code them.
 *
 * The markup mirrors `examples/sveltekit-payload/src/routes/+page.svelte`
 * and `examples/astro-payload/src/pages/index.astro` one-to-one (same field
 * names, same attributes) so every example app exercises the exact same
 * runtime surface.
 */
const initial = {
  title: 'Hello from the demo',
  subtitle: 'Type in the admin panel to see live updates.',
  hero: {
    url: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200',
    alt: 'Mountains at dusk',
  },
  count: 12,
  publishedAt: '2025-04-12T08:30:00.000Z',
  tags: ['nuxt', 'payload', 'live-preview'],
  ctaLabel: 'Visit Payload',
  ctaUrl: 'https://payloadcms.com',
};

useHead({ title: 'Live Preview Demo' });
</script>

<template>
  <article class="grid">
    <header class="grid">
      <h1 data-payload-field="title">{{ initial.title }}</h1>
      <p data-payload-field="subtitle">{{ initial.subtitle }}</p>
    </header>

    <img
      data-payload-field="hero"
      data-payload-type="image"
      data-payload-alt="hero.alt"
      :src="initial.hero.url"
      :alt="initial.hero.alt"
    />

    <div data-payload-field="body" data-payload-richtext>
      <h2>Rich text from Lexical</h2>
      <p>
        Mix of <strong>bold</strong>, <em>italic</em>, and
        <a href="https://example.com">links</a>.
      </p>
    </div>

    <p>
      Count:
      <span data-payload-field="count" data-payload-type="number">{{ initial.count }}</span>
    </p>

    <p>
      Published:
      <time data-payload-field="publishedAt" :datetime="initial.publishedAt">{{
        initial.publishedAt
      }}</time>
    </p>

    <ul
      class="tags"
      data-payload-field="tags"
      data-payload-type="array"
      :data-payload-array-template="'<li>{{value}}</li>'"
    >
      <li v-for="tag in initial.tags" :key="tag">{{ tag }}</li>
    </ul>

    <p>
      <a
        data-payload-field="ctaLabel"
        data-payload-href="ctaUrl"
        :href="initial.ctaUrl"
        target="_blank"
        rel="noopener noreferrer"
        >{{ initial.ctaLabel }}</a
      >
    </p>
  </article>
</template>

<style>
/* Unscoped on purpose: the array renderer replaces the tag <li> nodes at
   runtime, and freshly inserted nodes would not carry Vue's scoping
   attribute — unscoped selectors keep them styled. */
:root {
  color-scheme: light dark;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}
body {
  margin: 0;
  padding: 2rem;
  max-width: 720px;
  margin-inline: auto;
}
[data-payload-field] {
  transition: background-color 0.3s ease;
}
img {
  max-width: 100%;
  border-radius: 8px;
}
ul.tags {
  list-style: none;
  padding: 0;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
ul.tags li {
  background: rgba(0, 102, 204, 0.1);
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  font-size: 0.85rem;
}
time {
  color: rgba(0, 0, 0, 0.6);
  font-size: 0.9rem;
}
.grid {
  display: grid;
  gap: 1rem;
}
</style>
