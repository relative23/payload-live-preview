<script setup lang="ts">
/**
 * Preview target for the fragment strategy. The boundary is re-rendered by the
 * server on every revision; the footer outside it keeps being patched in place,
 * so one page shows both strategies at once.
 */
import Hero from '../components/Hero.vue';
// Rendered empty here and filled only by fragments, but imported by the page
// so its scoped style is on the page before the first notice needs it.
import Notice from '../components/Notice.vue';
import { heroProps } from '../lib/hero';

const hero = heroProps({});
// What the fragment's props read on the server, read here for the first render.
const edition = useRequestEvent()?.context.edition ?? '';
const site = useRuntimeConfig().public.siteName;
useHead({ title: 'Hybrid preview' });

onMounted(() => {
  // Vue owns this markup until it has hydrated, and a boundary the server
  // re-rendered before that moment is reset by hydration (docs/nuxt.md,
  // "Caveats"). The marker lets the E2E wait for the settled page, so it
  // measures the fragment strategy rather than that race.
  document.documentElement.dataset['hydrated'] = 'true';
});
</script>

<template>
  <main>
    <section data-payload-fragment="hero" data-payload-depends="title,subtitle,body">
      <Hero v-bind="hero" />
    </section>
    <aside data-payload-fragment="notice" data-payload-depends="notice" data-testid="notice-boundary">
      <Notice text="" :edition="edition" :site="site" />
    </aside>
    <footer data-payload-field="footer" data-testid="footer">patched, not rendered</footer>
  </main>
</template>
