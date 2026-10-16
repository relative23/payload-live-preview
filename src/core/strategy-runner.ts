/**
 * Runs the fragment and route strategies for a revision. A strategy that
 * throws or rejects is treated as failed, never left to reject the runtime.
 */

import type { PayloadLivePreviewData } from '@/types/payload-protocol';
import { trustedHtml } from '@security/trusted-types';
import { isBindingInScope } from './binding-owner';
import { resolveBindingOwner } from './cache';
import { reportUnboundChange } from './fidelity';
import { bindingValue } from './field-value';
import {
  astroIslandsIn,
  isMorphBoundary,
  islandStartBlocker,
  releaseDisconnectedIslands,
  retainIslandBoundary,
} from './islands';
import { morphElement } from './morph';
import type { RuntimeDeps, RuntimeState, UpdateTransaction } from './runtime-state';
import { thrownFragment } from './revision-display';
import {
  liveBoundary,
  type FragmentContext,
  type FragmentStrategy,
  type RouteOutcome,
  type RouteStrategy,
} from './strategies';
import { KEY_ATTRIBUTE } from './structural-applier';
import { warnFragmentFallback, warnUnsupportedStrategy } from './strategy-warnings';
import { declaredSubfields, unboundChangedFields, type OwnerScope } from './unbound-fields';
import type { CachedElement } from './types';

/** What the pipeline lends the runner. */
export interface StrategyHost {
  readonly reapply: (transaction: UpdateTransaction, data: PayloadLivePreviewData) => void;
  readonly transform: (
    target: CachedElement,
    value: unknown,
    allFields: Record<string, unknown>,
    isCurrent: () => boolean,
  ) => unknown;
  readonly rebuildCache: () => void;
  /** A server render — the route, or a fragment boundary — dropped the stamps a guess lives by; look for the baseline's guesses again (ADR 0014). */
  readonly restoreGuesses: (transaction: UpdateTransaction, data: PayloadLivePreviewData) => void;
  /** Scroll to the binding this revision marked, if it has not been revealed yet. */
  readonly revealPending: (transaction: UpdateTransaction) => void;
}

export interface FragmentPlan {
  readonly boundaries: readonly Element[];
  readonly strategy: FragmentStrategy;
  readonly ownerKeys: OwnerScope;
  /** Whether a binding sits inside a boundary the strategy renders this revision. */
  readonly covers: (target: CachedElement) => boolean;
}

export class StrategyRunner {
  constructor(
    private readonly deps: RuntimeDeps,
    private readonly state: RuntimeState,
    private readonly host: StrategyHost,
  ) {}

  /**
   * The boundaries this revision renders: those its diff touches, and those a
   * newer revision cut short before they settled that are still on the page.
   * A debt is settled when a render of its boundary starts, so a late-binding
   * pass, which renders only what streamed in, leaves the rest owed.
   */
  planFragments(touched: ReadonlySet<string>, ownerKeys: OwnerScope): FragmentPlan | null {
    const { deps, state } = this;
    const strategy = deps.strategies.fragment;
    if (strategy === undefined) return null;
    const planned = new Set(strategy.plan(deps.root, touched));
    for (const boundary of state.fragmentsOwed) {
      if (deps.root.contains(boundary)) planned.add(boundary);
      else state.fragmentsOwed.delete(boundary);
    }
    const boundaries = [...planned].filter((boundary) => inOwnerScope(boundary, ownerKeys));
    return planBoundaries(strategy, boundaries, ownerKeys);
  }

  /**
   * Hand the bindings this revision could not patch faithfully to a server:
   * the fragment strategy when a boundary covers every one of them, the route
   * otherwise. All of them or none — a boundary renders its own region, so a
   * finding outside every boundary is only answered by the whole route.
   *
   * A revision that already refreshed the route is left alone: the second
   * request would fetch the bytes the first one just brought.
   */
  escalateUnfaithful(
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    targets: readonly CachedElement[],
    ownerKeys: OwnerScope,
  ): void {
    if (transaction.routeRefreshed) {
      this.kept(transaction, targets);
      return;
    }
    const { fragment, route } = this.deps.strategies;
    const covered = fragment === undefined ? undefined : coveringBoundaries(targets);
    const boundaries =
      covered === undefined || covered.every((boundary) => inOwnerScope(boundary, ownerKeys))
        ? covered
        : undefined;
    if (fragment !== undefined && boundaries !== undefined) {
      this.state.escalatedCount += targets.length;
      transaction.pendingFragments += boundaries.length;
      void this.runFragments(transaction, data, planBoundaries(fragment, boundaries, ownerKeys));
      return;
    }
    if (route === undefined) {
      // Only 'escalate' queues a patch for this method (fidelity.ts), so the
      // page that reaches here with no strategy is the one the line is for.
      this.warnEscalationUnavailable(targets.length);
      this.kept(transaction, targets);
      return;
    }
    this.state.escalatedCount += targets.length;
    void this.refreshRoute(transaction, data, route);
  }

  /** Patches that fell short and stay as they are: the revision does not show those fields. */
  private kept(transaction: UpdateTransaction, targets: readonly CachedElement[]): void {
    for (const target of targets) {
      this.state.display.shortfall(transaction, { kind: 'unfaithful', field: target.fieldName });
    }
  }

  /**
   * The default asks for a server render and this page has nothing to ask.
   * Said once, with the count that brought it up: a page that keeps producing
   * findings is the page that needs the line, not one line per finding.
   */
  private warnEscalationUnavailable(count: number): void {
    const { deps, state } = this;
    if (state.warnedEscalationUnavailable) return;
    state.warnedEscalationUnavailable = true;
    deps.warn(
      `[live-preview] LP0808: onUnfaithfulPatch: 'escalate' has nowhere to go: ${String(count)} field(s) fell short ` +
        'and no route or fragment strategy is configured. Set routeStrategy: true or fragments: { endpoint }, ' +
        "or onUnfaithfulPatch: 'warn' to keep the patch and say so.",
    );
  }

  /**
   * Whether this revision changed a field the page cannot patch — one with no
   * anchor anywhere, which is also how a section the template renders only
   * under a condition looks from here. The whole route is then the only honest
   * answer.
   *
   * Asked of every revision rather than only where a refresh could follow it,
   * because the finding is the same one under every mode and on a page with no
   * strategy — and that page is what `inspect().fidelity` is read on. What the
   * mode still decides is what is *done*: `'warn'` adds no line of its own
   * (LP0201 already names the field) and `'ignore'` keeps the stale value,
   * exactly as before; only the ledger sees them now.
   *
   * The baseline message is skipped, because there every field counts as
   * changed and the page has just been rendered from them anyway — and so is
   * the re-apply after a refresh, which would otherwise report it all twice.
   */
  hasUnboundChange(transaction: UpdateTransaction, ownerKeys: OwnerScope): boolean {
    const { deps, state } = this;
    if (transaction.baseline || transaction.routeRefreshed) return false;
    const unbound = unboundChangedFields(
      deps.cache,
      transaction.touched,
      transaction.locale,
      ownerKeys,
      declaredSubfields(
        deps.subfieldCoverage,
        state.changes.previousFields,
        transaction.renderData?.fields,
      ),
      deps.strategies,
    );
    let answered = 0;
    for (const fieldName of unbound) if (reportUnboundChange(state, fieldName)) answered += 1;
    const [first] = unbound;
    if (first === undefined) return false;
    if (deps.onUnfaithfulPatch !== 'escalate' || deps.strategies.route === undefined) {
      if (deps.onUnfaithfulPatch === 'escalate') this.warnEscalationUnavailable(unbound.length);
      for (const field of unbound) state.display.shortfall(transaction, { kind: 'unbound', field });
      return false;
    }
    deps.log('route', 'LP0807', `field "${first}" has no binding; refreshing the route`);
    state.escalatedCount += answered;
    return true;
  }

  /** Whether a touched field is bound to an element the route owns. */
  /**
   * Whether the route is asked for, by the strategy's planner or by a route
   * binding of a touched field, each only inside the update's owner scope: a
   * marker another document owns is that document's business (PHD-02).
   */
  plansRoute(route: RouteStrategy, touched: ReadonlySet<string>, ownerKeys: OwnerScope): boolean {
    const owned = (owner: string | undefined): boolean =>
      ownerKeys === false || isBindingInScope(owner, ownerKeys);
    const inScope = (element: Element): boolean => owned(resolveBindingOwner(element));
    if (route.plan(this.deps.root, touched, { inScope })) return true;
    for (const [fieldName, bindings] of this.deps.cache.entries()) {
      if (!touched.has(fieldName)) continue;
      if (bindings.some((target) => target.strategyKind === 'route' && owned(target.owner))) {
        return true;
      }
    }
    return false;
  }

  async runFragments(
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    plan: FragmentPlan,
  ): Promise<void> {
    const { deps, state } = this;
    const controller = new AbortController();
    const unsettled = new Set(plan.boundaries);
    for (const boundary of unsettled) state.fragmentsOwed.delete(boundary);
    state.fragmentControllers.set(controller, unsettled);
    const settle = (boundary: Element): void => {
      if (unsettled.delete(boundary)) transaction.pendingFragments -= 1;
    };
    const isCurrent = (): boolean => state.isCurrent(transaction) && !controller.signal.aborted;
    const live = (boundary: Element): Element | undefined =>
      liveBoundary(deps.root, boundary, (candidate) => inOwnerScope(candidate, plan.ownerKeys));
    const { emitter } = deps;
    const { message } = transaction;
    const revision = transaction.revision.revision;
    const receivedAt = transaction.receivedAt;
    const context: FragmentContext = {
      root: deps.root,
      revision,
      receivedAt,
      fields: data.fields,
      locale: transaction.locale,
      collectionSlug:
        typeof message.collectionSlug === 'string' ? message.collectionSlug : undefined,
      globalSlug: typeof message.globalSlug === 'string' ? message.globalSlug : undefined,
      signal: controller.signal,
      isCurrent,
      log: (code, detail) => {
        deps.log('fragment', code, detail);
      },
      morph: (boundary, html) => {
        const target = isCurrent() ? live(boundary) : undefined;
        if (target === undefined) return;
        morphFragment(target, html, (island, blocker) => {
          this.warnIslandStart(island, blocker);
        });
      },
      patch: (boundary) => {
        const target = live(boundary);
        if (target === undefined) return;
        // A copy's bindings reach the cache only after the structural debounce.
        if (target !== boundary) this.host.rebuildCache();
        this.patchFallback(transaction, data, target, plan.ownerKeys, isCurrent);
      },
      rendered: (planned, id, key) => {
        settle(planned);
        const element = live(planned) ?? planned;
        void emitter.emitWhile(
          'fragmentRender',
          { element, id, key, status: 'rendered', revision, receivedAt },
          isCurrent,
        );
      },
      failed: (planned, id, key, code, reason) => {
        settle(planned);
        const element = live(planned) ?? planned;
        state.display.shortfall(transaction, { kind: 'fragment', id, key, code });
        const detail = `fragment "${id}" fell back to patch: ${reason}`;
        // Logged where the failure is, not where an exception would have been:
        // the supplied strategy answers a timeout or a refusal with an outcome
        // and never throws, so the `catch` around `render()` below is not on
        // this path and its LP0801 reached no log sink at all.
        deps.log('fragment', code, detail);
        void emitter.emitWhile(
          'error',
          { error: new Error(detail), context: 'fragment', code },
          isCurrent,
        );
        void emitter.emitWhile(
          'fragmentRender',
          { element, id, key, status: 'failed', code, revision, receivedAt },
          isCurrent,
        );
      },
    };
    let report = { rendered: 0, failed: 0, superseded: 0 };
    try {
      report = await plan.strategy.render(context, plan.boundaries);
    } catch (error) {
      deps.log('fragment', 'LP0801', error);
      if (isCurrent()) {
        for (const boundary of plan.boundaries) {
          context.patch(boundary);
          state.display.shortfall(transaction, thrownFragment(boundary));
        }
        report = { rendered: 0, failed: plan.boundaries.length, superseded: 0 };
      }
    }
    state.fragmentStats.rendered += report.rendered;
    state.fragmentStats.failed += report.failed;
    state.fragmentStats.superseded += report.superseded;
    state.fragmentControllers.delete(controller);
    for (const boundary of unsettled) settle(boundary);
    if (!isCurrent()) return;
    // A rendered boundary holds the server's markup, which carries no stamp: the
    // guesses in it go back on, as after a refresh, before the revision counts
    // as complete. Without this a guess in a boundary did not outlive the first
    // message, which renders the boundary as well.
    if (report.rendered > 0) this.host.restoreGuesses(transaction, data);
    if (transaction.pendingFragments === 0 && deps.scheduler.pendingCount === 0) {
      state.complete(transaction);
    }
    // The edited field may be one the server just rendered: its element is only
    // in place now, so this is the earliest point it can be scrolled to.
    this.host.revealPending(transaction);
    if (!isCurrent()) return;
    if (report.rendered === 0 || emitter.listenerCount('afterUpdate') === 0) return;
    void emitter.emitWhile(
      'afterUpdate',
      {
        data,
        updatedCount: report.rendered,
        durationMs: Date.now() - receivedAt,
        revision,
        receivedAt,
        source: 'fragment',
      },
      isCurrent,
    );
  }

  /** Refresh the route once per revision, then re-apply the revision onto the fresh markup. */
  async refreshRoute(
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    strategy: RouteStrategy,
  ): Promise<void> {
    const { deps, state } = this;
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
    await this.runRoute(transaction, data, strategy).catch((error: unknown) => {
      this.routeFailed(error);
    });
  }

  /**
   * Nothing awaits a refresh, so an unexpected throw after it returned, while
   * the page is re-applied onto the fresh markup, would otherwise escape as an
   * unhandled rejection. The strategy's own throw is an outcome (LP0801).
   */
  private routeFailed(error: unknown): void {
    this.deps.log('route refresh failed:', error);
  }

  /**
   * The trailing run of a refused refresh: the strategy's window closes and the
   * request it held back runs, once. It cannot loop — a refresh re-renders the
   * page from the server and produces no message, so nothing asks again.
   */
  private armRouteRetry(
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    strategy: RouteStrategy,
    delayMs: number,
  ): void {
    const { state } = this;
    if (state.routeRetry !== null) clearTimeout(state.routeRetry);
    state.routeRetry = setTimeout(() => {
      state.routeRetry = null;
      if (!state.isCurrent(transaction)) return;
      this.runRoute(transaction, data, strategy).catch((error: unknown) => {
        this.routeFailed(error);
      });
    }, delayMs);
  }

  /**
   * One trip through the strategy, whether the revision asked for it or the
   * window did. It replaces a refresh still in flight, and it lands for the
   * revision that is current when it returns, which need not be the one that
   * asked (ADR 0004 §4d).
   */
  private async runRoute(
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    strategy: RouteStrategy,
  ): Promise<void> {
    const { deps, state } = this;
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
          this.armRouteRetry(transaction, data, strategy, delayMs);
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
      // Route markup has no local application identities; every prior stamp is stale.
      state.lastAppliedIdentity = new WeakMap();
      // The fresh markup carries no stamp: the guesses go back on before the
      // cache is rebuilt from it, or the rebuild would not know them.
      if (currentData !== undefined) this.host.restoreGuesses(current, currentData);
      this.host.rebuildCache();
      if (currentData === undefined || !isCurrent()) return;
      this.host.reapply(current, currentData);
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
    if (currentData !== undefined) this.host.reapply(current, currentData);
  }

  /** LP0809, once: fragment scripts never run, so the page must already start Astro islands. */
  private warnIslandStart(island: Element, blocker: 'element' | 'directive'): void {
    if (this.state.warnedIslandStart) return;
    this.state.warnedIslandStart = true;
    const missing =
      blocker === 'element' ? '<astro-island>' : `client:${island.getAttribute('client') ?? ''}`;
    this.deps.warn(
      `[live-preview] LP0809: a fragment island cannot start: this page never loaded ${missing}; render one on the page`,
    );
  }

  /** LP0806, once: a fragment boundary with no handler is patched instead. */
  warnFragmentFallback(target: CachedElement): void {
    warnFragmentFallback(this.deps, this.state, target);
  }

  /** LP0407, once per element: an unknown strategy is left alone, not guessed at. */
  warnUnsupportedStrategy(target: CachedElement): void {
    warnUnsupportedStrategy(this.deps, this.state, target);
  }

  /** The deterministic fallback: patch the boundary's own bindings from the same revision. */
  private patchFallback(
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    boundary: Element,
    ownerKeys: OwnerScope,
    isCurrent: () => boolean,
  ): void {
    if (!isCurrent()) return;
    for (const [fieldName, bindings] of this.deps.cache.entries()) {
      for (const target of bindings) {
        if (target.fragmentBoundary !== boundary) continue;
        if (ownerKeys !== false && !isBindingInScope(target.owner, ownerKeys)) continue;
        const value = bindingValue(data.fields, target, fieldName, transaction.locale);
        if (value === undefined || !isCurrent()) continue;
        this.deps.scheduler.schedule({
          target,
          value: this.host.transform(target, value, data.fields, isCurrent),
          allFields: data.fields,
          revision: transaction.revision,
          data,
        });
      }
    }
  }
}

/** The distinct boundaries around `targets`, or `undefined` when one sits outside them all. */
function coveringBoundaries(targets: readonly CachedElement[]): Element[] | undefined {
  const boundaries: Element[] = [];
  for (const target of targets) {
    const boundary = target.fragmentBoundary;
    if (boundary === undefined) return undefined;
    if (!boundaries.includes(boundary)) boundaries.push(boundary);
  }
  return boundaries;
}

/** A plan over boundaries already chosen, whichever question chose them. */
function planBoundaries(
  strategy: FragmentStrategy,
  boundaries: readonly Element[],
  ownerKeys: OwnerScope,
): FragmentPlan {
  const covered = new Set(boundaries);
  return {
    boundaries,
    strategy,
    ownerKeys,
    covers: (target) =>
      target.fragmentBoundary !== undefined && covered.has(target.fragmentBoundary),
  };
}

/** Whether the document that owns `element` is inside the update's owner scope. */
function inOwnerScope(element: Element, ownerKeys: OwnerScope): boolean {
  return ownerKeys === false || isBindingInScope(resolveBindingOwner(element), ownerKeys);
}

/**
 * Morph server-rendered HTML into the boundary; compatible retained nodes keep
 * live state. Islands follow ADR 0021: removed ones are released, and an
 * inserted one the page cannot start is reported rather than scripted.
 */
function morphFragment(
  boundary: Element,
  html: string,
  blocked: (island: Element, blocker: 'element' | 'directive') => void,
): void {
  const template = boundary.ownerDocument.createElement('template');
  template.innerHTML = trustedHtml(html);
  const rendered = boundary.cloneNode(false) as Element;
  rendered.append(template.content);
  const before = astroIslandsIn(boundary);
  morphElement(boundary, rendered, {
    keyAttributes: [KEY_ATTRIBUTE],
    boundary: isMorphBoundary,
    retainBoundary: retainIslandBoundary,
  });
  releaseDisconnectedIslands(before);
  const known = new Set(before);
  for (const island of astroIslandsIn(boundary)) {
    const blocker = known.has(island) ? undefined : islandStartBlocker(island);
    if (blocker !== undefined) blocked(island, blocker);
  }
}
