/**
 * Keeps a locally retained navigation document aligned with DOM that arrives
 * after the router's commit. It scopes late work to newly discovered targets
 * and never treats the replay as fresh editor traffic.
 */

import type { PayloadLivePreviewData } from '@/types/payload-protocol';
import { isBindingInScope } from './binding-owner';
import {
  DEPENDS_ATTRIBUTE,
  FIELD_ATTRIBUTE,
  resolveBindingOwner,
  STRATEGY_ATTRIBUTE,
} from './cache';
import { parseDependencyList } from './dependencies';
import { bindingValue } from './field-value';
import { dispatchIslandUpdate, isAwaitingIslandHydration } from './islands';
import type { RuntimeDeps, RuntimeState, UpdateTransaction } from './runtime-state';
import { resolveStrategy } from './strategies';
import type { FragmentPlan } from './strategy-runner';
import type { OwnerScope } from './unbound-fields';
import { ownerKeysForUpdate } from './update-owner';

interface NavigationReplayHost {
  readonly schedule: (
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    elements: ReadonlySet<Element>,
  ) => void;
}

export class NavigationReplay {
  private readonly awaitingHydration = new WeakSet<Element>();
  /** A fallback flush may carry the same snapshot after the no-patch handoff. */
  private readonly delivered = new WeakMap<PayloadLivePreviewData, WeakSet<Element>>();
  /** Each island confirms a revision once, however often it is handed it (ADR 0023). */
  private readonly confirmations = new WeakMap<
    Element,
    { readonly transaction: UpdateTransaction; readonly displayed: () => void }
  >();

  constructor(
    private readonly deps: RuntimeDeps,
    private readonly state: RuntimeState,
    private readonly host: NavigationReplayHost,
  ) {}

  reapplyBindings(elements: ReadonlySet<Element>): void {
    const transaction = this.currentTransaction();
    if (transaction?.renderData === undefined) return;
    this.host.schedule(transaction, transaction.renderData, elements);
  }

  reapplyIslands(islands: readonly Element[], hydrationCompleted = false): void {
    const replay = hydrationCompleted
      ? islands.filter((island) => this.awaitingHydration.delete(island))
      : islands;
    const active = this.state.activeUpdate;
    const transaction =
      hydrationCompleted && active !== null && this.state.isCurrent(active)
        ? active
        : this.currentTransaction();
    if (transaction?.renderData === undefined) return;
    this.dispatchIslands(transaction, transaction.renderData, replay);
  }

  dispatchIslands(
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    islands: readonly Element[],
  ): void {
    const ownerKeys = ownerKeysForUpdate(this.deps, this.state, transaction, data.fields);
    const isCurrent = (): boolean => !transaction.cancelled && this.state.isCurrent(transaction);
    if (!isCurrent()) return;
    let delivered = this.delivered.get(data);
    if (delivered === undefined) {
      delivered = new WeakSet();
      this.delivered.set(data, delivered);
    }
    for (const island of islands) {
      const owner = resolveBindingOwner(island);
      if (!isCurrent()) return;
      if (ownerKeys !== false && !isBindingInScope(owner, ownerKeys)) {
        this.awaitingHydration.delete(island);
        continue;
      }
      // Counted while it hydrates too: it owes the revision a render.
      const displayed = this.confirmation(island, transaction);
      if (isAwaitingIslandHydration(island)) {
        this.awaitingHydration.add(island);
      } else {
        this.awaitingHydration.delete(island);
        if (delivered.has(island)) continue;
        // Claim before calling application code: it can re-enter this fanout.
        delivered.add(island);
        dispatchSnapshotToIslands(transaction, data, [island], isCurrent, displayed);
      }
    }
  }

  hasLateRouteBinding(
    elements: ReadonlySet<Element>,
    ownerKeys: OwnerScope,
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
  ): boolean {
    for (const element of elements) {
      if (
        (element.getAttribute(FIELD_ATTRIBUTE) ?? '').length > 0 ||
        element.getAttribute(STRATEGY_ATTRIBUTE) !== 'route'
      ) {
        continue;
      }
      if (ownerKeys !== false && !isBindingInScope(resolveBindingOwner(element), ownerKeys)) {
        continue;
      }
      const dependsOn = parseDependencyList(element.getAttribute(DEPENDS_ATTRIBUTE));
      if (dependsOn.length === 0 || dependsOn.some((field) => transaction.touched.has(field))) {
        return true;
      }
    }
    for (const [fieldName, bindings] of this.deps.cache.entries()) {
      for (const target of bindings) {
        if (!elements.has(target.element)) continue;
        if (ownerKeys !== false && !isBindingInScope(target.owner, ownerKeys)) continue;
        const kind = target.strategyKind ?? resolveStrategy(target.element) ?? 'unknown';
        if (kind !== 'route') continue;
        const value = bindingValue(data.fields, target, fieldName, transaction.locale);
        if (!this.state.isCurrent(transaction)) return false;
        if (value !== undefined) return true;
      }
    }
    return false;
  }

  fieldsForElements(
    elements: ReadonlySet<Element>,
    touched: ReadonlySet<string>,
  ): ReadonlySet<string> {
    const fields = new Set(touched);
    for (const [fieldName, bindings] of this.deps.cache.entries()) {
      if (bindings.some((target) => elements.has(target.element))) fields.add(fieldName);
    }
    return fields;
  }

  unrunFragmentPlan(
    transaction: UpdateTransaction,
    plan: FragmentPlan | null,
    onlyElements: ReadonlySet<Element> | undefined,
  ): FragmentPlan | null {
    if (plan === null) return null;
    const boundaries = plan.boundaries.filter(
      (boundary) =>
        !transaction.fragmentBoundariesRun.has(boundary) &&
        (onlyElements === undefined ||
          [...onlyElements].some((element) => element === boundary || boundary.contains(element))),
    );
    if (boundaries.length === 0) return null;
    const covered = new Set(boundaries);
    return {
      ...plan,
      boundaries,
      covers: (target) =>
        target.fragmentBoundary !== undefined && covered.has(target.fragmentBoundary),
    };
  }

  private confirmation(island: Element, transaction: UpdateTransaction): () => void {
    const held = this.confirmations.get(island);
    if (held?.transaction === transaction) return held.displayed;
    const displayed = this.state.display.handIsland(transaction);
    this.confirmations.set(island, { transaction, displayed });
    return displayed;
  }

  private currentTransaction(): UpdateTransaction | null {
    const transaction = this.state.activeUpdate;
    return this.state.navigationBindingReplay &&
      transaction !== null &&
      this.state.isCurrent(transaction)
      ? transaction
      : null;
  }
}

export function dispatchSnapshotToIslands(
  transaction: UpdateTransaction,
  data: PayloadLivePreviewData,
  islands: readonly Element[],
  isCurrent: () => boolean,
  displayed: () => void,
): void {
  dispatchIslandUpdate(
    islands,
    {
      fields: data.fields,
      revision: transaction.revision.revision,
      receivedAt: transaction.receivedAt,
      locale: transaction.locale,
      displayed,
    },
    isCurrent,
  );
}
