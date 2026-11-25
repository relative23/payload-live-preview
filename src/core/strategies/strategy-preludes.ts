/**
 * How the runtime picks up a strategy prelude.
 *
 * The generator may place one IIFE ahead of the runtime, and it leaves one
 * global: `__LIVE_PREVIEW_FRAGMENT__` carries the fragment client together
 * with the route strategy (ADR 0011), `__LIVE_PREVIEW_ROUTE__` the route
 * strategy alone. Never both — a page that configures a fragment endpoint
 * already has the route strategy inside the larger prelude.
 *
 * Both are read through `typeof`, so a page that carries neither holds no
 * reference to that code and bundlers drop it.
 */

import type { FragmentStrategy, RouteStrategy, StrategyHandlers } from './strategies';

/** Left by `src/fragment/inline.ts`. */
declare const __LIVE_PREVIEW_FRAGMENT__:
  | {
      createFragmentStrategy: (options: { endpoint: string }) => FragmentStrategy;
      createRouteStrategy: () => RouteStrategy;
    }
  | undefined;

/** Left by `src/fragment/route-inline.ts`. */
declare const __LIVE_PREVIEW_ROUTE__:
  | {
      createRouteStrategy: () => RouteStrategy;
    }
  | undefined;

/**
 * The strategies this page can run, or `undefined` for a page that only
 * patches. The route strategy comes from whichever prelude is present, because
 * both carry it; the fragment strategy needs its own prelude *and* an endpoint
 * to post to.
 */
export function resolveStrategyPreludes(
  fragmentEndpoint: string | undefined,
): StrategyHandlers | undefined {
  const fragmentPrelude =
    typeof __LIVE_PREVIEW_FRAGMENT__ !== 'undefined' ? __LIVE_PREVIEW_FRAGMENT__ : undefined;
  const routePrelude =
    typeof __LIVE_PREVIEW_ROUTE__ !== 'undefined' ? __LIVE_PREVIEW_ROUTE__ : undefined;

  const prelude = fragmentPrelude ?? routePrelude;
  if (prelude === undefined) return undefined;

  const route = prelude.createRouteStrategy();
  if (fragmentPrelude === undefined || fragmentEndpoint === undefined || fragmentEndpoint === '') {
    return { route };
  }
  return {
    fragment: fragmentPrelude.createFragmentStrategy({ endpoint: fragmentEndpoint }),
    route,
  };
}
