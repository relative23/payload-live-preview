/**
 * The route of a page that lends its refresh. Where `routeStrategy: 'router'`
 * asked for it, and on every page a framework hydrates, the route strategy is
 * there while the page lends a refresh and absent while it lends none: nothing
 * is fetched and morphed in the router's place (ADR 0007, rows 40 and 47). Apart
 * from `route-refresh.ts`, which the navigation entries load for its slot alone.
 */

import { readRouteRefresh } from './route-refresh';
import type { RouteStrategy, StrategyHandlers } from './strategies';

/**
 * Whether the route is refreshed through a lent refresh alone: where
 * `routeStrategy: 'router'` asked for it, and on every page a framework
 * hydrates. That framework's reconciler owns the DOM and its router renders the
 * route, so the strategy's own fetch and morph has no place there, whichever
 * option asked for a route (ADR 0007, rows 40 and 47). `'manual'` names no
 * framework and keeps what the options say.
 */
export function routeIsLentOnly(
  asked: boolean | undefined,
  hydration: 'react' | 'vue' | 'sveltekit' | 'manual' | undefined,
): boolean {
  return asked === true || (hydration !== undefined && hydration !== 'manual');
}

/**
 * `routeStrategy: 'router'`: the route strategy is there while the page lends a
 * refresh and absent while it lends none, so every place that asks whether a
 * route can be refreshed gets the answer of that moment, and nothing is fetched
 * and morphed in the router's place. The refresh asks once more: a trailing run
 * may come after the page took its refresh back.
 */
export function onlyWhileLent(strategies: StrategyHandlers, lentOnly: boolean): StrategyHandlers {
  const { route } = strategies;
  if (!lentOnly || route === undefined) return strategies;
  const lent: RouteStrategy = {
    plan: route.plan,
    refresh: (context) =>
      readRouteRefresh() === undefined ? Promise.resolve('failed') : route.refresh(context),
  };
  // Read at every use, so the answer is the one of that moment.
  return {
    ...strategies,
    get route() {
      return readRouteRefresh() === undefined ? undefined : lent;
    },
  } as StrategyHandlers;
}
