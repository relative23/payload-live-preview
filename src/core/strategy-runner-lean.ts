/**
 * The strategy runner the lean profile gets instead of the real one: it plans
 * nothing, renders nothing, and says so once per feature (LP0104). Its purpose
 * is that the pipeline needs no branch of its own — it holds a runner either
 * way, and the profile decides which.
 *
 * Because this module names the real runner only as a type, the lean build
 * drops that file and everything only it referenced: the morph, the fragment
 * protocol client's server half, and the route refresh.
 */

import { reportOmittedFeature } from './profile';
import type { StrategyRunner } from './strategy-runner';
import { warnFragmentFallback, warnUnsupportedStrategy } from './strategy-warnings';
import type { RuntimeDeps, RuntimeState } from './runtime-state';
import type { CachedElement } from './types';

/** What `UpdatePipeline` calls on a runner; both profiles satisfy it. */
export type StrategyRunnerLike = Pick<
  StrategyRunner,
  | 'planFragments'
  | 'hasUnboundChange'
  | 'hasRouteBinding'
  | 'runFragments'
  | 'refreshRoute'
  | 'warnFragmentFallback'
  | 'warnUnsupportedStrategy'
>;

export function createLeanStrategyRunner(
  deps: RuntimeDeps,
  state: RuntimeState,
): StrategyRunnerLike {
  return {
    planFragments: (): null => null,
    hasUnboundChange: (): boolean => false,
    hasRouteBinding: (): boolean => false,
    runFragments: (): Promise<void> => Promise.resolve(),
    // A page that carries a route prelude anyway (it can be injected by hand)
    // still gets no refresh here: this runtime has no code for one.
    refreshRoute: (): Promise<void> => {
      reportOmittedFeature('route refreshes');
      return Promise.resolve();
    },
    warnFragmentFallback: (target: CachedElement): void => {
      reportOmittedFeature('server-rendered fragments');
      warnFragmentFallback(deps, state, target);
    },
    warnUnsupportedStrategy: (target: CachedElement): void => {
      warnUnsupportedStrategy(deps, state, target);
    },
  };
}
