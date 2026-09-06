/**
 * The config half of a Next.js setup, in one call.
 *
 * `withLivePreview` adds two things a preview needs and only a config can give
 * it: `frame-ancestors` for the admin origin on requests that carry preview
 * intent, so the panel may frame the page, and that origin in
 * `allowedDevOrigins`, so the dev server does not refuse the admin's requests.
 * The script itself is rendered by the root layout (app/layout.tsx) — no config
 * hook renders HTML, so a Next.js setup is these two places, not one.
 *
 * @type {import('next').NextConfig}
 */
import { withLivePreview } from 'payload-live-preview/nextjs';

export default withLivePreview(
  {},
  {
    // The mock admin is served from this example's own origin (public/admin.html).
    allowedOrigins: ['http://localhost:4174'],
  },
);
