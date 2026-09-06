/**
 * The route half of `delivery: 'asset'` for SvelteKit.
 *
 * ```ts
 * // src/routes/payload-live-preview/[file]/+server.ts
 * import { createRuntimeAssetRoute } from 'payload-live-preview/sveltekit';
 *
 * export const { GET } = createRuntimeAssetRoute(livePreviewOptions);
 * ```
 *
 * The dynamic segment carries the content hash; the handler answers the one
 * name this package build produces and 404s the rest, which is what lets the
 * response promise a year of `immutable`. Everything it decides is in
 * `@adapters/shared/runtime-asset` — the same answer the other adapters give.
 */

import { runtimeAssetResponse } from '@adapters/shared/runtime-asset';
import type { LivePreviewSvelteKitOptions } from './adapter';

/** What a `+server.ts` re-exports. SvelteKit hands a handler its request event. */
export interface RuntimeAssetRoute {
  readonly GET: (event: { readonly request: Request }) => Response;
}

/**
 * Takes the adapter's own options so the one object can be passed to both
 * halves: only `assetPath` and `runtime` are read, but those two are exactly
 * what the page and the route have to agree on, and `runtime: LEAN_RUNTIME`
 * means the page asks for that artifact's hash.
 */
export function createRuntimeAssetRoute(
  options: LivePreviewSvelteKitOptions = {},
): RuntimeAssetRoute {
  return { GET: ({ request }) => runtimeAssetResponse(request.url, options) };
}
