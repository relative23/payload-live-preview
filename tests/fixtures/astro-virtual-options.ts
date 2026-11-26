/**
 * Stands in for `virtual:payload-live-preview/options`, the module Astro's
 * integration provides at build time.
 *
 * Without it `src/adapters/astro/middleware-entry.ts` is unimportable from a
 * test, and an unimportable file is an unmeasured one: the v8 provider fell
 * back to parsing its raw source, choked on `import type {`, and dropped the
 * file from coverage with a warning nobody reads.
 */
import { authorizePreviewRequest } from '@security/preview-authorization';

export default {
  allowedOrigins: ['https://admin.example.com'],
  inject: 'always',
  // The integration writes the hook into the real module from `authorizePreviewModule`;
  // a verifier that authorizes stands in for it.
  authorizePreview: (request: Request) =>
    authorizePreviewRequest(request, { type: 'verifier', verify: () => ({ subject: 'editor' }) }),
} as const;
