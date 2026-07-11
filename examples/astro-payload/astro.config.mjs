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
      allowedOrigins: [
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'http://localhost:3001',
      ],
      debug: true,
      debounceMs: 25,
    }),
  ],
});
