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
  // (this Nuxt 3 layout keeps components at the root; Nuxt 4's under `app/`),
  // and keeps each component's CSS out of the server bundle: the page's build
  // delivers it, since the page imports the component (ADR 0029, 0030).
  nitro: {
    rollupConfig: {
      plugins: fragmentComponentPlugins(vue, {
        srcDir: fileURLToPath(new URL('./', import.meta.url)),
      }),
    },
  },
  compatibilityDate: '2026-08-01',
  // Read by the page and, through the fragment route's props, by fragments.
  runtimeConfig: { public: { siteName: 'Nuxt fixture' } },
  devtools: { enabled: false },
  // The mock admin is a static file so it never carries preview intent and
  // therefore never receives the runtime — the same split the other examples
  // use to keep "who gets injected" observable in the E2E suite.
  ssr: true,
});
