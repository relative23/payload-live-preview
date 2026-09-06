/**
 * The route half of `delivery: 'asset'` for Nuxt.
 *
 * Nitro hands a route handler an H3 event, so the handler takes the web request
 * the event converts to — the same shape `createFragmentEndpoint()` uses here:
 *
 * ```ts
 * // server/routes/payload-live-preview/[file].get.ts
 * import { createRuntimeAssetRoute } from 'payload-live-preview/nuxt';
 *
 * const asset = createRuntimeAssetRoute(livePreviewOptions);
 * export default defineEventHandler((event) => asset(toWebRequest(event)));
 * ```
 *
 * The dynamic segment carries the content hash; the handler answers the one
 * name this package build produces and 404s the rest, which is what lets the
 * response promise a year of `immutable`. Everything it decides is in
 * `@adapters/shared/runtime-asset` — the same answer the other adapters give.
 */

import { runtimeAssetResponse } from '@adapters/shared/runtime-asset';
import type { LivePreviewNuxtOptions } from './adapter';

/**
 * Takes the adapter's own options so the one object can be passed to both
 * halves: only `assetPath` and `runtime` are read, but those two are exactly
 * what the page and the route have to agree on, and `runtime: LEAN_RUNTIME`
 * means the page asks for that artifact's hash.
 */
export function createRuntimeAssetRoute(
  options: LivePreviewNuxtOptions = {},
): (request: Request) => Response {
  return (request) => runtimeAssetResponse(request.url, options);
}
