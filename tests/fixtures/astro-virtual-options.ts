/**
 * Stands in for `virtual:payload-live-preview/options`, the module Astro's
 * integration provides at build time.
 *
 * Without it `src/adapters/astro/middleware-entry.ts` is unimportable from a
 * test, and an unimportable file is an unmeasured one: the v8 provider fell
 * back to parsing its raw source, choked on `import type {`, and dropped the
 * file from coverage with a warning nobody reads.
 */
export default {
  // v1 so the entry builds without an authorizePreview hook (2.0 strict-default
  // would otherwise refuse); the flip itself is covered by the policy suites.
  defaults: 'v1',
  allowedOrigins: ['https://admin.example.com'],
  inject: 'always',
} as const;
