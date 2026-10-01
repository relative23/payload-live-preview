/**
 * The config half of a Next.js setup, in one call.
 *
 * `withLivePreview` adds what only a config can give a preview: the admin's
 * origin in `allowedDevOrigins`, so the dev server does not refuse its
 * requests, and `private, no-store` on a request that carries preview intent.
 * It writes no CSP — a config rule cannot authorize, and Next replaces a
 * header rather than adding to it, so `frame-ancestors` belongs in the
 * middleware, which merges it into the policy the site already sends.
 * The script itself is rendered by the root layout (app/layout.tsx) — no config
 * hook renders HTML, so a Next.js setup is these two places, not one.
 *
 * @type {import('next').NextConfig}
 */
import { withLivePreview } from 'payload-live-preview/nextjs';
import { BASE_PATH } from './base-path.mjs';
import { PREVIEW_ADMIN_ORIGIN } from './preview-origin.mjs';

export default withLivePreview(
  {
    ...(BASE_PATH === '' ? {} : { basePath: BASE_PATH }),
    // A preview reached through a rewrite: the browser keeps `/alias/reveal`,
    // the server renders `/reveal` (tests/e2e/specs/nextjs-base-path.spec.ts).
    rewrites: async () => [{ source: '/alias/reveal', destination: '/reveal' }],
  },
  {
    // The mock admin is served from this example's own origin (public/admin.html).
    allowedOrigins: [PREVIEW_ADMIN_ORIGIN],
  },
);
