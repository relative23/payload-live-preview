/**
 * Runs the fragment and route strategies for a revision. A strategy that
 * throws or rejects is treated as failed, never left to reject the runtime.
 */

import type { PayloadLivePreviewData } from '@/types/payload-protocol';
import { trustedHtml } from '@security/trusted-types';
import { bindingValue } from './field-value';
import { morphElement } from './morph';
import type { RuntimeDeps, RuntimeState, UpdateTransaction } from './runtime-state';
import type { FragmentContext, FragmentStrategy, RouteStrategy } from './strategies';
import { KEY_ATTRIBUTE } from './structural-applier';
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
    const boundaries = strategy.plan(this.deps.root, touched);
    const covered = new Set(boundaries);
    return {
      boundaries,
      strategy,
      covers: (target) =>
        target.fragmentBoundary !== undefined && covered.has(target.fragmentBoundary),
    };
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
    const stats = state.routeStats;
    if (transaction.routeRefreshed) {
      stats.loopStopped += 1;
      deps.log(
        'route',
        'LP0805',
        `revision ${String(transaction.revision.revision)} asked for a second refresh`,
      );
      return;
    }
    transaction.routeRefreshed = true;
    const controller = new AbortController();
    state.routeController = controller;
    const isCurrent = (): boolean => state.isCurrent(transaction) && !controller.signal.aborted;
    let outcome: 'refreshed' | 'failed' | 'superseded';
    try {
      outcome = await strategy.refresh({
        revision: transaction.revision.revision,
        receivedAt: transaction.receivedAt,
        signal: controller.signal,
        isCurrent,
        log: (code, detail) => {
          deps.log('route', code, detail);
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
    if (outcome === 'failed') stats.failed += 1;
    this.host.reapply(transaction, data);
  }

  /** LP0806, once: a fragment boundary with no handler is patched instead. */
  warnFragmentFallback(target: CachedElement): void {
    if (this.state.warnedFragmentFallback) return;
    this.state.warnedFragmentFallback = true;
    this.deps.warn(
      `[live-preview] LP0806: "${target.fieldName}" asks for the fragment strategy but no handler is configured; patching instead`,
    );
  }

  /** LP0407, once per element: an unknown strategy is left alone, not guessed at. */
  warnUnsupportedStrategy(target: CachedElement): void {
    if (this.state.warnedStrategy.has(target.element)) return;
    this.state.warnedStrategy.add(target.element);
    this.deps.warn(
      `[live-preview] LP0407: "${target.fieldName}" asks for strategy "${String(target.strategy)}"; only patch, fragment and route exist`,
    );
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

/** Morph server-rendered HTML into the boundary, keeping focus and visitor state. */
function morphFragment(boundary: Element, html: string): void {
  const template = boundary.ownerDocument.createElement('template');
  template.innerHTML = trustedHtml(html);
  const rendered = boundary.cloneNode(false) as Element;
  rendered.append(template.content);
  morphElement(boundary, rendered, { keyAttributes: [KEY_ATTRIBUTE] });
}
