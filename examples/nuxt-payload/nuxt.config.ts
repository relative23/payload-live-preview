import vue from '@vitejs/plugin-vue';

export default defineNuxtConfig({
  // The fragment endpoint renders a component inside the Nitro bundle, and
  // Nitro's rollup has no idea what a single-file component is. One plugin
  // teaches it; without this the server build fails on the first `.vue` import
  // from `server/`. (See docs/nuxt.md — the alternative is a `defineComponent`
  // in a .ts file, which Nitro can already read.)
  nitro: { rollupConfig: { plugins: [vue()] } },
  compatibilityDate: '2026-08-01',
  devtools: { enabled: false },
  // The mock admin is a static file so it never carries preview intent and
  // therefore never receives the runtime — the same split the other examples
  // use to keep "who gets injected" observable in the E2E suite.
  ssr: true,
});
