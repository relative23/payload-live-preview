/** Public types for the Astro adapter. */

import type { PreviewAdapterOptions } from '@adapters/shared/options';

export interface LivePreviewAstroOptions extends PreviewAdapterOptions {
  /**
   * How the integration delivers the runtime: `'inline'` (default) bakes it
   * into every page, `'loader'` injects a bootstrap that fetches it as a
   * hashed SRI-verified asset, `'middleware'` registers the request-time
   * middleware. Middleware mode serializes its options into the build, so
   * `authorizePreview` and `shouldInject` cannot travel and the strict
   * default refuses it — register `createLivePreviewMiddleware()` in
   * `src/middleware.ts` instead, or pass `strict: false` for intent-only
   * delivery.
   */
  readonly mode?: 'inline' | 'loader' | 'middleware';
  /** Same-origin path of the route exporting `createFragmentEndpoint()`; the runtime then renders every boundary through it (ADR 0011). */
  readonly fragments?: { readonly endpoint: string };
}
