/**
 * The route half of `delivery: 'asset'` for Next.js.
 *
 * ```ts
 * // app/payload-live-preview/[file]/route.ts
 * import { createRuntimeAssetRoute } from 'payload-live-preview/nextjs';
 *
 * export const { GET } = createRuntimeAssetRoute();
 * ```
 *
 * The dynamic segment is what carries the content hash. The handler answers
 * only the file name this package build produces and 404s everything else, so a
 * client holding a year-old `immutable` copy of some other build gets an
 * honest miss rather than different bytes under the same name.
 *
 * No route segment config is exported with it. `dynamic: 'force-static'` would
 * be tempting — the bytes are the same for every request — but on a dynamic
 * segment it asks Next to prerender one arbitrary param at build time. The
 * caching that matters is the response's own `immutable`, which browsers and
 * CDNs honour without Next's help.
 */

import { runtimeAssetResponse } from '@adapters/shared/runtime-asset';
import type { LivePreviewNextOptions } from './adapter';

/** What a route file re-exports. */
export interface RuntimeAssetRoute {
  readonly GET: (request: Request) => Response;
}

/**
 * Takes the adapter's own options so the one object can be passed to both
 * halves: only `assetPath` and `runtime` are read, but those two are exactly
 * what the page and the route have to agree on, and `runtime: LEAN_RUNTIME`
 * means the page asks for that artifact's hash.
 */
export function createRuntimeAssetRoute(options: LivePreviewNextOptions = {}): RuntimeAssetRoute {
  return { GET: (request) => runtimeAssetResponse(request.url, options) };
}
