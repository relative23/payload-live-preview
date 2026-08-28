import { defineConfig } from 'astro/config';
import { livePreview } from 'payload-live-preview/astro';

// The Astro adapter's *inline* delivery: injectScript('head-inline') bakes the
// runtime into every built page. astro-payload covers the 'loader' branch end
// to end; this fixture is the browser coverage for the 'inline' branch, which
// was otherwise only unit-tested. Same runtime, different injection point.
export default defineConfig({
  output: 'static',
  server: { port: 4182, host: true },
  integrations: [
    livePreview({
      mode: 'inline',
      revealEditedField: true,
      allowedOrigins: ['http://localhost:4182', 'http://127.0.0.1:4182'],
      debug: true,
      debounceMs: 25,
    }),
  ],
});
