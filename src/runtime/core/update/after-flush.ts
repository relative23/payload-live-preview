/**
 * The end of a flush: finish the revision, reveal the edited field, hand what
 * could not be patched faithfully to a server, and tell the islands and the
 * listeners.
 */

import type { PayloadLivePreviewData } from '@/runtime/types/payload-protocol';
import { revealBinding } from '../bindings/reveal';
import { sameRevision } from '../protocol/message-bus';
import type { RuntimeDeps, RuntimeState, UpdateTransaction } from '../session/runtime-state';
import type { NavigationReplay } from '../strategies/navigation-replay';
import type { StrategyRunner } from '../strategies/strategy-runner';
import { ownerKeysForUpdate } from './update-owner';
import type { FlushStats } from './update-scheduler';

/** Islands hear every revision that carried a change, whether or not a write landed outside them. */
export function notifyIslands(
  deps: RuntimeDeps,
  replay: NavigationReplay,
  transaction: UpdateTransaction,
  data: PayloadLivePreviewData,
): void {
  if (transaction.touched.size === 0) return;
  replay.dispatchIslands(transaction, data, deps.cache.islands);
}

/** The end of a flush, including one that applied nothing. */
export function afterFlush(
  deps: RuntimeDeps,
  state: RuntimeState,
  strategies: StrategyRunner,
  replay: NavigationReplay,
  stats: FlushStats,
): void {
  state.lastFlush = stats;
  if (stats.deferred > 0 && !state.warnedVisibilityGate) {
    state.warnedVisibilityGate = true;
    deps.warn(
      `[live-preview] LP0301: visibility gate held ${String(stats.deferred)} off-screen update(s) until scrolled into view; see visibilityGateThreshold`,
    );
  }
  const { revision, data } = stats;
  if (revision === undefined) return;
  const transaction = state.activeUpdate;
  if (
    transaction === null ||
    !state.isCurrent(transaction) ||
    !sameRevision(transaction.revision, revision)
  ) {
    return;
  }
  state.display.deferred(transaction, stats.deferred);
  if (transaction.pendingFragments === 0) state.complete(transaction);
  const isCurrent = (): boolean =>
    state.isCurrent(transaction) && sameRevision(transaction.revision, revision);
  const renderData = data ?? transaction.renderData;
  // Reveal first: scrolling to a deferred off-screen edit is what replays it.
  revealPending(deps, state, transaction);
  if (!isCurrent()) return;
  // Before the applied check: a flush that applied nothing is where every renderer refused.
  const unfaithful = state.unfaithfulPatches;
  if (unfaithful.length > 0) {
    state.unfaithfulPatches = [];
    if (renderData !== undefined) {
      const scope = ownerKeysForUpdate(deps, state, transaction, renderData.fields);
      strategies.escalateUnfaithful(transaction, renderData, unfaithful, scope);
    }
    if (!isCurrent()) return;
  }
  if (data === undefined) return;
  if (stats.applied > 0) deps.a11y?.announceUpdate(stats.applied);
  if (!isCurrent()) return;
  // An island still needs its event when `skipUnchanged` leaves every outer binding untouched.
  notifyIslands(deps, replay, transaction, data);
  if (!isCurrent() || stats.applied === 0 || deps.emitter.listenerCount('afterUpdate') === 0) {
    return;
  }
  void deps.emitter.emitWhile(
    'afterUpdate',
    {
      data,
      updatedCount: stats.applied,
      durationMs: stats.durationMs,
      revision: revision.revision,
      receivedAt: transaction.receivedAt,
      source: 'patch',
    },
    isCurrent,
  );
}

/**
 * Reveal the binding this revision marked, once. Called from the patch flush
 * and again once fragments land, because only one of the two runs for any
 * given field, and a fragment-rendered element is in place only afterwards.
 */
export function revealPending(
  deps: RuntimeDeps,
  state: RuntimeState,
  transaction: UpdateTransaction,
): void {
  const target = state.revealLedger.commit(transaction);
  if (target === undefined) return;
  try {
    revealBinding(state.revealer, target);
  } catch (error) {
    deps.log('reveal', error);
  }
}
