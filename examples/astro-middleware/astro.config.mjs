import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { livePreview } from 'payload-live-preview/astro';

// The Astro adapter's *middleware* delivery (mode:'middleware'): the runtime is
// injected into SSR HTML responses at request time by the package's built-in
// middleware entrypoint (addMiddleware), not at build (inline) nor as a
// published asset (loader). SSR-only, so the Node adapter is required.
// astro-hybrid uses a hand-composed middleware for fragments; this exercises
// the integration's own middleware registration.
//
// With PLP_PAYLOAD_SERVER_URL set, a real Payload admin frames the site
// (tests/real-payload, target astro-session): the editor's own session decides
// instead of the token the mock admin mints, only the admin's origin may send
// updates, and the runtime populates a relationship from the admin's REST API.
// The strict default holds in both setups.
const serverURL = process.env['PLP_PAYLOAD_SERVER_URL'] ?? '';
const realAdmin = serverURL === '' ? undefined : { serverURL, origin: new URL(serverURL).origin };

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4183, host: true },
  integrations: [
    livePreview({
      mode: 'middleware',
      // The integration serializes its options into the build, so the hook
      // travels by module reference (ADR 0024) and the strict 2.0 default
      // holds: a preview needs the token the mock admin mints, or against a
      // real admin the editor's session.
      authorizePreviewModule:
        realAdmin === undefined
          ? './src/live-preview/authorize.ts'
          : './src/live-preview/authorize-session.ts',
      revealEditedField: true,
      allowedOrigins:
        realAdmin === undefined
          ? ['http://localhost:4183', 'http://127.0.0.1:4183']
          : [realAdmin.origin],
      ...(realAdmin === undefined ? {} : { serverURL: realAdmin.serverURL, mergeDepth: 1 }),
      debug: true,
      debounceMs: 25,
    }),
  ],
});
