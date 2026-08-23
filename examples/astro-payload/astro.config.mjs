import { defineConfig } from 'astro/config';
import { livePreview } from 'payload-live-preview/astro';

// The mock-admin page serves both as the integration test target and
// as a hands-on demonstration of the library. The integration is
// configured to trust both the same-origin (so /admin can post to /)
// and the conventional Payload admin URLs.
export default defineConfig({
  output: 'static',
  server: {
    port: 4173,
    host: true,
  },
  integrations: [
    livePreview({
      // Static delivery: the page carries a few hundred bytes that fetch the
      // runtime only inside a preview. `'inline'` would bake ~68 KB into every
      // built page — 70 314 bytes of index.html against 3 151 here.
      //
      // This fixture is also the only browser coverage the loader path has.
      // Astro's inline branch is one `injectScript` call and unit-tested, and
      // the inline *runtime* is still driven end to end by the Next, SvelteKit
      // and Nuxt fixtures, so nothing is left unexercised by the switch.
      mode: 'loader',
      allowedOrigins: ['http://localhost:4173', 'http://127.0.0.1:4173', 'http://localhost:3001'],
      debug: true,
      debounceMs: 25,
    }),
  ],
});
