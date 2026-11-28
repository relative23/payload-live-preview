/**
 * The route half of the strategies: one refresh per revision, the refresh
 * after a save and the trailing run of a refused one. A strategy that throws
 * or rejects is an outcome, never a rejection of the runtime.
 */

import type { PayloadLivePreviewData } from '@/runtime/types/payload-protocol';
import type { RuntimeDeps, RuntimeState, UpdateTransaction } from '../session/runtime-state';
import type { RouteOutcome, RouteStrategy } from './strategies';
import type { StrategyHost } from './strategy-runner';

/** What a refresh works on: the runner's three collaborators. */
export interface RouteRun {
  readonly deps: RuntimeDeps;
  readonly state: RuntimeState;
  readonly host: StrategyHost;
}

/** Refresh the route once per revision, then re-apply the revision onto the fresh markup. */
export async function refreshRoute(
  run: RouteRun,
  transaction: UpdateTransaction,
  data: PayloadLivePreviewData,
  strategy: RouteStrategy,
): Promise<void> {
  const { deps, state } = run;
  if (transaction.routeRefreshed) {
    state.routeStats.loopStopped += 1;
    deps.log(
      'route',
      'LP0805',
      `revision ${String(transaction.revision.revision)} asked for a second refresh`,
    );
    return;
  }
  // A refusal counts as asked as well: the trailing run below is this
  // revision's one refresh, and nothing else may start a second.
  transaction.routeRefreshed = true;
  await runRoute(run, transaction, data, strategy, false).catch((error: unknown) => {
    routeFailed(run, error);
  });
}

/**
 * Payload saved the document, and the route was last rendered from the older
 * save (`routeAwaitsSave`): render it again, now that the server has the edits.
 * Payload posts the event once the save landed, so no delay is guessed at.
 */
export function refreshAfterSave(run: RouteRun): void {
  const { deps, state } = run;
  const { route } = deps.strategies;
  const current = state.activeUpdate;
  // A stopped runtime has no active update, so this also refuses after stop().
  if (!state.routeAwaitsSave || route === undefined || current?.renderData === undefined) return;
  deps.log('route', 'document saved; refreshing the route');
  runRoute(run, current, current.renderData, route, true).catch((error: unknown) => {
    routeFailed(run, error);
  });
}

/**
 * Nothing awaits a refresh, so an unexpected throw after it returned, while
 * the page is re-applied onto the fresh markup, would otherwise escape as an
 * unhandled rejection. The strategy's own throw is an outcome (LP0801).
 */
function routeFailed(run: RouteRun, error: unknown): void {
  run.deps.log('route refresh failed:', error);
}

/**
 * The trailing run of a refused refresh: the strategy's window closes and the
 * request it held back runs, once. It cannot loop — a refresh re-renders the
 * page from the server and produces no message, so nothing asks again.
 */
function armRouteRetry(
  run: RouteRun,
  transaction: UpdateTransaction,
  data: PayloadLivePreviewData,
  strategy: RouteStrategy,
  delayMs: number,
  forSave: boolean,
): void {
  const { state } = run;
  if (state.routeRetry !== null) clearTimeout(state.routeRetry);
  state.routeRetry = setTimeout(() => {
    state.routeRetry = null;
    if (!state.isCurrent(transaction)) return;
    runRoute(run, transaction, data, strategy, forSave).catch((error: unknown) => {
      routeFailed(run, error);
    });
  }, delayMs);
}

/**
 * One trip through the strategy, whether the revision asked for it or the
 * window did. It replaces a refresh still in flight, and it lands for the
 * revision that is current when it returns, which need not be the one that
 * asked (ADR 0004 §4d).
 */
async function runRoute(
  run: RouteRun,
  transaction: UpdateTransaction,
  data: PayloadLivePreviewData,
  strategy: RouteStrategy,
  forSave: boolean,
): Promise<void> {
  const { deps, state } = run;
  if (deps.routeAfterSave && !forSave) {
    state.routeAwaitsSave = true;
    state.display.shortfall(transaction, { kind: 'route-saved' });
    return;
  }
  const stats = state.routeStats;
  const controller = new AbortController();
  state.routeController?.abort();
  state.routeController = controller;
  // A stop aborts it too, so the signal alone says whether it may still land.
  const lands = (): boolean => !controller.signal.aborted;
  let outcome: RouteOutcome;
  try {
    outcome = await strategy.refresh({
      revision: transaction.revision.revision,
      receivedAt: transaction.receivedAt,
      signal: controller.signal,
      isCurrent: lands,
      log: (code, detail) => {
        deps.log('route', code, detail);
      },
      retryAfter: (delayMs) => {
        armRouteRetry(run, transaction, data, strategy, delayMs, forSave);
      },
    });
  } catch (error) {
    deps.log('route', 'LP0801', error);
    outcome = 'failed';
  }
  if (!lands()) return;
  // Whatever replaces this refresh, ends the route or stops the session
  // aborts it first, so it is still the one in flight and a revision is
  // current; the null check only narrows the type.
  state.routeController = null;
  const current = state.activeUpdate;
  if (current === null) return;
  // The current revision's latest data, which a merge may have refined since
  // the refresh started. One still resolving its fields has none yet: it
  // applies itself onto whatever the route shows when it gets there.
  const currentData = current.renderData;
  const isCurrent = (): boolean => state.isCurrent(current);
  if (outcome === 'partial') state.display.shortfall(current, { kind: 'route-saved' });
  // A refusal with its trailing run armed is not an outcome yet: that run is.
  else if (
    outcome === 'failed' ||
    outcome === 'superseded' ||
    (outcome === 'refused' && state.routeRetry === null)
  ) {
    state.display.shortfall(current, { kind: 'route-failed', outcome });
  }
  if (outcome === 'refreshed' || outcome === 'partial') {
    stats.refreshes += 1;
    if (outcome === 'partial') stats.partial += 1;
    state.routeAwaitsSave = outcome === 'partial' && !forSave;
    // Route markup has no local application identities; every prior stamp is stale.
    state.lastAppliedIdentity = new WeakMap();
    // The fresh markup carries no stamp: the guesses go back on before the
    // cache is rebuilt from it, or the rebuild would not know them.
    if (currentData !== undefined) run.host.restoreGuesses(current, currentData);
    run.host.rebuildCache();
    if (currentData === undefined || !isCurrent()) return;
    run.host.reapply(current, currentData);
    if (deps.emitter.listenerCount('afterUpdate') > 0) {
      void deps.emitter.emitWhile(
        'afterUpdate',
        {
          data: currentData,
          // The strategy replaced the whole route, so every binding now on
          // the page carries new markup; the unsaved fields scheduled just
          // above report themselves in their own `patch` batch.
          updatedCount: deps.cache.elementCount,
          durationMs: Date.now() - current.receivedAt,
          revision: current.revision.revision,
          receivedAt: current.receivedAt,
          source: 'route',
        },
        isCurrent,
      );
    }
    return;
  }
  // A refusal is a pause, not a breakage; counting the two together is how
  // `failed: 3` came to stand in an inspection where nothing was wrong.
  if (outcome === 'failed') stats.failed += 1;
  else if (outcome === 'refused') stats.refused += 1;
  // Either way the page shows what it can now: the window holds back the
  // server, not the bindings this revision could already have written.
  if (currentData !== undefined) run.host.reapply(current, currentData);
}
