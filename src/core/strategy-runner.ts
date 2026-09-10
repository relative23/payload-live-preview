/**
 * Runs the fragment and route strategies for a revision. A strategy that
 * throws or rejects is treated as failed, never left to reject the runtime.
 */

import type { PayloadLivePreviewData } from '@/types/payload-protocol';
import { trustedHtml } from '@security/trusted-types';
import { bindingValue } from './field-value';
import { morphElement } from './morph';
import type { RuntimeDeps, RuntimeState, UpdateTransaction } from './runtime-state';
import type { FragmentContext, FragmentStrategy, RouteOutcome, RouteStrategy } from './strategies';
import { KEY_ATTRIBUTE } from './structural-applier';
import { warnFragmentFallback, warnUnsupportedStrategy } from './strategy-warnings';
import { createFieldAddressability, SYSTEM_FIELD_NAMES, type OwnerScope } from './unbound-fields';
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
  /** Scroll to the binding this revision marked, if it has not been revealed yet. */
  readonly revealPending: (transaction: UpdateTransaction) => void;
}

export interface FragmentPlan {
  readonly boundaries: readonly Element[];
  readonly strategy: FragmentStrategy;
  /** Whether a binding sits inside a boundary the strategy renders this revision. */
  readonly covers: (target: CachedElement) => boolean;
}

export class StrategyRunner {
  constructor(
    private readonly deps: RuntimeDeps,
    private readonly state: RuntimeState,
    private readonly host: StrategyHost,
  ) {}

  planFragments(touched: ReadonlySet<string>): FragmentPlan | null {
    const strategy = this.deps.strategies.fragment;
    if (strategy === undefined) return null;
    return planBoundaries(strategy, strategy.plan(this.deps.root, touched));
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
  ): void {
    if (transaction.routeRefreshed) return;
    const { fragment, route } = this.deps.strategies;
    const boundaries = fragment === undefined ? undefined : coveringBoundaries(targets);
    if (fragment !== undefined && boundaries !== undefined) {
      transaction.pendingFragments += boundaries.length;
      void this.runFragments(transaction, data, planBoundaries(fragment, boundaries));
      return;
    }
    if (route !== undefined) void this.refreshRoute(transaction, data, route);
  }

  /**
   * Whether this revision changed a field the page cannot patch — one with no
   * anchor anywhere, which is also how a section the template renders only
   * under a condition looks from here. The whole route is then the only honest
   * answer, and `'warn'` needs nothing extra: LP0201 already names the field.
   *
   * The baseline message is skipped, because there every field counts as
   * changed and the page has just been rendered from them anyway.
   */
  hasUnboundChange(transaction: UpdateTransaction, ownerKeys: OwnerScope): boolean {
    const { deps } = this;
    if (deps.onUnfaithfulPatch !== 'escalate' || transaction.baseline) return false;
    const isAddressable = createFieldAddressability(deps.cache, transaction.locale, ownerKeys);
    for (const fieldName of transaction.touched) {
      if (SYSTEM_FIELD_NAMES.has(fieldName) || isAddressable(fieldName)) continue;
      deps.log('route', 'LP0807', `field "${fieldName}" has no binding; refreshing the route`);
      return true;
    }
    return false;
  }

  /** Whether a touched field is bound to an element the route owns. */
  hasRouteBinding(touched: ReadonlySet<string>): boolean {
    for (const [fieldName, bindings] of this.deps.cache.entries()) {
      if (!touched.has(fieldName)) continue;
      if (bindings.some((target) => target.strategyKind === 'route')) return true;
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
    state.fragmentController = controller;
    const isCurrent = (): boolean => state.isCurrent(transaction) && !controller.signal.aborted;
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
        morphFragment(boundary, html);
      },
      patch: (boundary) => {
        this.patchFallback(transaction, data, boundary);
      },
      rendered: (element, id, key) => {
        transaction.pendingFragments -= 1;
        void emitter.emitWhile(
          'fragmentRender',
          { element, id, key, status: 'rendered', revision, receivedAt },
          isCurrent,
        );
      },
      failed: (element, id, key, code, reason) => {
        transaction.pendingFragments -= 1;
        void emitter.emitWhile(
          'error',
          {
            error: new Error(`fragment "${id}" fell back to patch: ${reason}`),
            context: 'fragment',
            code,
          },
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
        for (const boundary of plan.boundaries) this.patchFallback(transaction, data, boundary);
        report = { rendered: 0, failed: plan.boundaries.length, superseded: 0 };
      }
    }
    state.fragmentStats.rendered += report.rendered;
    state.fragmentStats.failed += report.failed;
    state.fragmentStats.superseded += report.superseded;
    if (!isCurrent()) return;
    if (state.fragmentController === controller) state.fragmentController = null;
    transaction.pendingFragments = 0;
    if (deps.scheduler.pendingCount === 0) state.complete(transaction);
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
    await this.runRoute(transaction, data, strategy);
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
      void this.runRoute(transaction, data, strategy);
    }, delayMs);
  }

  /** One trip through the strategy, whether the revision asked for it or the window did. */
  private async runRoute(
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    strategy: RouteStrategy,
  ): Promise<void> {
    const { deps, state } = this;
    const stats = state.routeStats;
    const controller = new AbortController();
    state.routeController = controller;
    const isCurrent = (): boolean => state.isCurrent(transaction) && !controller.signal.aborted;
    let outcome: RouteOutcome;
    try {
      outcome = await strategy.refresh({
        revision: transaction.revision.revision,
        receivedAt: transaction.receivedAt,
        signal: controller.signal,
        isCurrent,
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
    if (!isCurrent()) return;
    if (state.routeController === controller) state.routeController = null;
    if (outcome === 'refreshed') {
      stats.refreshes += 1;
      // The route rendered the saved document; nothing on the page is "last applied" any more.
      state.lastAppliedIdentity = new WeakMap();
      this.host.rebuildCache();
      if (!isCurrent()) return;
      this.host.reapply(transaction, data);
      if (deps.emitter.listenerCount('afterUpdate') > 0) {
        void deps.emitter.emitWhile(
          'afterUpdate',
          {
            data,
            // The server re-rendered the whole route, so every binding now on
            // the page carries fresh markup; the unsaved fields scheduled just
            // above report themselves in their own `patch` batch.
            updatedCount: deps.cache.elementCount,
            durationMs: Date.now() - transaction.receivedAt,
            revision: transaction.revision.revision,
            receivedAt: transaction.receivedAt,
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
    this.host.reapply(transaction, data);
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
  ): void {
    for (const [fieldName, bindings] of this.deps.cache.entries()) {
      for (const target of bindings) {
        if (target.fragmentBoundary !== boundary) continue;
        const value = bindingValue(data.fields, target, fieldName, transaction.locale);
        if (value === undefined) continue;
        this.deps.scheduler.schedule({
          target,
          value: this.host.transform(target, value, data.fields, () => true),
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
function planBoundaries(strategy: FragmentStrategy, boundaries: readonly Element[]): FragmentPlan {
  const covered = new Set(boundaries);
  return {
    boundaries,
    strategy,
    covers: (target) =>
      target.fragmentBoundary !== undefined && covered.has(target.fragmentBoundary),
  };
}

/** Morph server-rendered HTML into the boundary, keeping focus and visitor state. */
function morphFragment(boundary: Element, html: string): void {
  const template = boundary.ownerDocument.createElement('template');
  template.innerHTML = trustedHtml(html);
  const rendered = boundary.cloneNode(false) as Element;
  rendered.append(template.content);
  morphElement(boundary, rendered, { keyAttributes: [KEY_ATTRIBUTE] });
}
