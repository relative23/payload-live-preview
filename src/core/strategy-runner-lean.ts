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

import { reportUnboundChange } from './fidelity';
import { reportOmittedFeature } from './profile';
import type { StrategyRunner } from './strategy-runner';
import { warnFragmentFallback, warnUnsupportedStrategy } from './strategy-warnings';
import type { RuntimeDeps, RuntimeState, UpdateTransaction } from './runtime-state';
import { unboundChangedFields, type OwnerScope } from './unbound-fields';
import type { CachedElement } from './types';

/** What `UpdatePipeline` calls on a runner; both profiles satisfy it. */
export type StrategyRunnerLike = Pick<
  StrategyRunner,
  | 'planFragments'
  | 'escalateUnfaithful'
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
    // Nothing to escalate to. The pipeline still drains its queue, so a page
    // that keeps producing findings does not keep producing entries.
    escalateUnfaithful: (): void => undefined,
    // Nothing here to escalate to, and the finding is still worth recording:
    // a page that changes a field it does not bind is the page
    // `inspect().fidelity` is read on, and `escalated` staying 0 beside it is
    // the truth about this profile rather than silence about the change.
    hasUnboundChange: (transaction: UpdateTransaction, ownerKeys: OwnerScope): boolean => {
      if (transaction.baseline) return false;
      const unbound = unboundChangedFields(
        deps.cache,
        transaction.touched,
        transaction.locale,
        ownerKeys,
      );
      for (const fieldName of unbound) reportUnboundChange(state, fieldName);
      return false;
    },
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
