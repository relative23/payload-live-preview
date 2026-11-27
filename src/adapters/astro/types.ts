/** Public types for the Astro adapter. */

import type { PreviewAdapterOptions } from '@adapters/shared/options';

/**
 * `authorizePreview` and `shouldInject` are not among the integration's options: it decides at
 * build time or serializes what it was given, so a function meant to run per request never would.
 * A JavaScript config that passes one is refused at startup.
 */
export interface LivePreviewAstroOptions extends Omit<
  PreviewAdapterOptions,
  'authorizePreview' | 'shouldInject'
> {
  /**
   * How the integration registers. `'loader'` (default since 3.0) publishes the
   * runtime as a hashed asset and injects a bootstrap that fetches it only in a
   * preview context — Astro emits and serves that asset itself, through a Vite
   * plugin, which is why this is a mode here and the `delivery` option
   * elsewhere: there is no route to mount. `'inline'` bakes the runtime into
   * every page.
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
