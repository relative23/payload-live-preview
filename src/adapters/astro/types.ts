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
   * travel: name the hook's module in `authorizePreviewModule` instead, or
   * register `createLivePreviewMiddleware()` in `src/middleware.ts`.
   */
  readonly mode?: 'inline' | 'loader' | 'middleware';
  /**
   * `mode: 'middleware'` only: a server module whose default export is the
   * `authorizePreview` hook, so the strict default holds (ADR 0024). A path
   * beginning with `./` is relative to the project root; a package or alias
   * specifier is passed to Vite unchanged.
   */
  readonly authorizePreviewModule?: string;
}
