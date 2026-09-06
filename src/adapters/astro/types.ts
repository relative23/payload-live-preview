/** Public types for the Astro adapter. */

import type { PreviewAdapterOptions } from '@adapters/shared/options';

export interface LivePreviewAstroOptions extends PreviewAdapterOptions {
  /**
   * How the integration registers. `'inline'` (default) bakes the runtime into
   * every page and `'loader'` publishes it as a hashed asset and injects a
   * bootstrap — Astro emits and serves that asset itself, through a Vite
   * plugin, which is why this is a mode here and the `delivery` option
   * elsewhere: there is no route to mount.
   *
   * `'middleware'` registers the request-time middleware. It serializes its
   * options into the build, so `authorizePreview` and `shouldInject` cannot
   * travel and the strict default refuses it — register
   * `createLivePreviewMiddleware()` in `src/middleware.ts` instead, or pass
   * `strict: false` for intent-only delivery.
   */
  readonly mode?: 'inline' | 'loader' | 'middleware';
}
