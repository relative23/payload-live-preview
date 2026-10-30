import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { fragmentComponentPlugins } from 'payload-live-preview/nuxt-module';
import { livePreviewOptions } from './lib/live-preview';

export default defineNuxtConfig({
  // The whole setup: the module registers the Nitro plugin and hands it these
  // options. `server/plugins/live-preview.ts` used to do the same by hand.
  // The asset route in `server/routes/` reads the same object.
  modules: ['payload-live-preview/nuxt-module'],
  livePreview: livePreviewOptions,
  // The fragment endpoint renders the project's components inside the Nitro
  // bundle, whose rollup does not know single-file components. The helper adds
  // Vue's plugin, hashing scope ids from the same directory Nuxt's build does
  // (Nuxt 4 keeps components under `app/`; the Nuxt 3 fixture's are at the root),
  // and keeps each component's CSS out of the server bundle: the page's build
  // delivers it, since the page imports the component (ADR 0029, 0030).
  nitro: {
    rollupConfig: {
      plugins: fragmentComponentPlugins(vue, {
        srcDir: fileURLToPath(new URL('./app/', import.meta.url)),
      }),
    },
  },
  compatibilityDate: '2026-08-01',
  // Read by the page and, through the fragment route's props, by fragments.
  // `payloadUrl` is the admin a real-Payload run names (pages/composable.vue).
  runtimeConfig: {
    public: { siteName: 'Nuxt fixture', payloadUrl: process.env['PLP_PAYLOAD_SERVER_URL'] ?? '' },
  },
  // Off, as in the Nuxt 3 fixture, so both serve the suite the same development
  // pages: switched on, Nuxt DevTools 3.4.4 adds a script element of its own to
  // each one (measured 2026-10-30).
  devtools: { enabled: false },
  // The mock admin is a static file so it never carries preview intent and
  // therefore never receives the runtime — the same split the other examples
  // use to keep "who gets injected" observable in the E2E suite.
  ssr: true,
});
