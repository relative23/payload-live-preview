/**
 * From an accepted message to scheduled writes: merge, diff, plan the
 * strategies, schedule each binding, and finish the revision on flush.
 */

import type { PayloadLivePreviewData, PayloadLivePreviewMessage } from '@/types/payload-protocol';
import { buildSchemaIndex } from '@schema/index';
import { isBindingInScope, messageOwnerKeys, readDocumentId } from './binding-owner';
import { mergeDependencyMaps } from './dependencies';
import { resolveFieldValue } from './field-value';
import { dispatchIslandUpdate } from './islands';
import type { MessageRevision } from './message-bus';
import { diagnoseOrphanFields } from './orphan-diagnostics';
import { detectProtocolProfile } from './protocol-profile';
import { observeCapabilities } from './protocol-version';
import type { RevealWindow } from './reveal';
import {
  sameRevision,
  type RuntimeDeps,
  type RuntimeState,
  type UpdateTransaction,
} from './runtime-state';
import { resolveStrategy } from './strategies';
import { StrategyRunner } from './strategy-runner';
import { observeThenableResult } from './thenable';
import type { CachedElement } from './types';
import type { FlushStats, ScheduledUpdate } from './update-scheduler';
import { valueIdentity } from './value-identity';

export class UpdatePipeline {
  private readonly strategies: StrategyRunner;

  constructor(
    private readonly deps: RuntimeDeps,
    private readonly state: RuntimeState,
    rebuildCache: () => void,
  ) {
    this.strategies = new StrategyRunner(deps, state, {
      reapply: (transaction, data) => {
        this.scheduleAllFields(transaction, data);
      },
      transform: (target, value, allFields, isCurrent) =>
        this.transformForBinding(target, value, allFields, isCurrent),
      rebuildCache,
      revealPending: (transaction) => {
        this.revealPending(transaction);
      },
    });
  }

  /** Message-bus callback for every shape-valid update. */
  handleUpdate(
    message: PayloadLivePreviewMessage,
    origin: string,
    identity: MessageRevision | undefined,
  ): void {
    const { deps, state } = this;
    deps.heartbeat.kick();
    state.protocol.observe(observeCapabilities(message), deps.log);
    if (message.data === undefined) {
      if (message.protocolVersion !== undefined) {
        state.protocol.applyVersion(message.protocolVersion, deps.log);
      }
      return;
    }
    if (identity === undefined) return;
    const relationship = message.externallyUpdatedRelationship;
    const relationshipEdited = typeof relationship === 'object' && relationship !== null;
    if (relationshipEdited) {
      void deps.emitter.emit('relationshipUpdate', { detail: relationship, timestamp: Date.now() });
    }
    if (typeof message.locale === 'string') state.locale = message.locale;
    if (Array.isArray(message.fieldSchemaJSON)) {
      state.schema = message.fieldSchemaJSON;
      state.schemaIndex = buildSchemaIndex(message.fieldSchemaJSON);
    }
    const transaction: UpdateTransaction = {
      identity,
      message,
      locale: state.locale,
      schema: state.schema,
      schemaIndex: state.schemaIndex,
      receivedAt: Date.now(),
      forceRender: relationshipEdited,
      touched: new Set(),
      invalidated: new Set(),
      revealTarget: undefined,
      pendingFragments: 0,
      routeRefreshed: false,
      cancelled: false,
      completed: false,
    };
    // Acceptance is the single supersession point. Only a revision that never
    // reached its terminal state counts as superseded.
    const previous = state.activeUpdate;
    state.abortStrategies();
    if (previous !== null && !previous.completed) state.supersededCount += 1;
    state.activeUpdate = transaction;
    deps.scheduler.acceptRevision(identity);
    state.updateCount += 1;
    if (message.protocolVersion !== undefined) {
      state.protocol.applyVersion(message.protocolVersion, deps.log);
      if (!state.isCurrent(transaction)) return;
    }
    if (deps.connection.markConnected()) {
      deps.a11y?.announceConnected();
      void deps.emitter.emit('connect', { origin, timestamp: Date.now() });
      if (!state.isCurrent(transaction)) return;
      deps.log('connection', 'disconnected', '→', 'connected');
      if (!state.isCurrent(transaction)) return;
    }
    // Nothing awaits this, so an unexpected throw would leave the page as an
    // unhandled rejection — a console error the host cannot attribute, and a
    // process exit under `--unhandled-rejections=strict`.
    void this.processUpdate(transaction).catch((error: unknown) => {
      deps.log('update failed:', error);
    });
  }

  private async processUpdate(transaction: UpdateTransaction): Promise<void> {
    const { deps, state } = this;
    const fields = await this.resolveIncomingFields(transaction);
    if (fields === null || !state.isCurrent(transaction)) return;
    const { message } = transaction;
    const data: PayloadLivePreviewData = {
      fields,
      ...(transaction.schema !== undefined ? { schema: transaction.schema } : {}),
      ...(typeof message.globalSlug === 'string' ? { globalSlug: message.globalSlug } : {}),
      ...(typeof message.collectionSlug === 'string'
        ? { collectionSlug: message.collectionSlug }
        : {}),
      ...(transaction.locale !== undefined ? { locale: transaction.locale } : {}),
    };
    if (deps.emitter.listenerCount('beforeUpdate') > 0) {
      const completed = await deps.emitter.emitWhile(
        'beforeUpdate',
        {
          data,
          revision: transaction.identity.revision,
          receivedAt: transaction.receivedAt,
          source: 'patch',
          cancel: (): void => {
            transaction.cancelled = true;
            deps.scheduler.cancelRevision(transaction.identity);
          },
        },
        () => !transaction.cancelled && state.isCurrent(transaction),
      );
      if (!completed || transaction.cancelled || !state.isCurrent(transaction)) return;
    }
    const dependencies = mergeDependencyMaps(deps.dependencies, deps.cache.dependencyMap());
    const changes = state.changes.diff(fields, dependencies);
    transaction.invalidated = changes.invalidated;
    transaction.touched = new Set([...changes.changed, ...changes.invalidated]);
    this.scheduleAllFields(transaction, data);
  }

  /** The merged document when a `DataMerger` is configured, else the raw form values; `null` when superseded. */
  private async resolveIncomingFields(
    transaction: UpdateTransaction,
  ): Promise<Record<string, unknown> | null> {
    const { deps, state } = this;
    const raw = transaction.message.data ?? {};
    if (deps.merger === null) return raw;
    // A Payload 2.x admin posts populated relationships itself.
    if (detectProtocolProfile(state.protocol.observed).populatesRelationships === 'admin') {
      return raw;
    }
    const { message } = transaction;
    const result = await deps.merger.merge({
      collectionSlug: message.collectionSlug,
      globalSlug: message.globalSlug,
      data: raw,
      locale: transaction.locale,
    });
    if (!state.isCurrent(transaction)) return null;
    if (result.status === 'merged') return result.doc;
    if (result.status === 'superseded') return null;
    return raw;
  }

  scheduleAllFields(transaction: UpdateTransaction, data: PayloadLivePreviewData): void {
    const { deps, state } = this;
    if (!state.isCurrent(transaction)) return;
    const isCurrent = (): boolean => state.isCurrent(transaction);
    const ownerKeys = this.ownerKeysForUpdate(transaction, data.fields);
    const { touched } = transaction;
    // A revision that touches the route refreshes it first; the re-apply lands on the fresh markup.
    const route = deps.strategies.route;
    if (
      route !== undefined &&
      !transaction.routeRefreshed &&
      (route.plan(deps.root, touched) || this.strategies.hasRouteBinding(touched))
    ) {
      void this.strategies.refreshRoute(transaction, data, route);
      return;
    }
    const plan = this.strategies.planFragments(touched);
    // Only `skipUnchanged` needs it now; the reveal keeps its own ledger.
    const trackIdentity = deps.skipUnchanged;
    let scheduled = 0;
    for (const [fieldName, bindings] of deps.cache.entries()) {
      if (!isCurrent()) return;
      for (const target of bindings) {
        if (ownerKeys !== false && !isBindingInScope(target.owner, ownerKeys)) continue;
        // A binding inside a boundary the server renders is patched only as the
        // fallback — but it can still be the field being edited, so the reveal
        // has to notice it here, before the boundary is re-rendered.
        if (plan?.covers(target) === true) {
          // Resolving the value is only worth it when something reveals.
          if (deps.revealEditedField) {
            this.noteRevealCandidate(transaction, target, this.rawValue(transaction, target, data));
          }
          continue;
        }
        const kind = target.strategyKind ?? resolveStrategy(target.element) ?? 'unknown';
        if (kind === 'unknown') {
          this.strategies.warnUnsupportedStrategy(target);
          continue;
        }
        if (kind === 'fragment' && plan === null) this.strategies.warnFragmentFallback(target);
        const value = resolveFieldValue(
          data.fields,
          fieldName,
          target.locale ?? transaction.locale,
          target.locale !== undefined,
        );
        if (value === undefined) {
          state.absentFields.add(fieldName);
          continue;
        }
        if (!isCurrent()) return;
        const transformed = this.transformForBinding(target, value, data.fields, isCurrent);
        if (!isCurrent()) return;
        // A binding renders its own value *and* the sibling fields bound to
        // href/src/alt, so its identity must cover them: otherwise an edit to
        // the sibling alone looks unchanged and the link or image stays stale.
        const identity = trackIdentity
          ? bindingIdentity(target, transformed, data.fields, transaction.locale)
          : undefined;
        const last = state.lastAppliedIdentity.get(target.element);
        if (
          !transaction.forceRender &&
          deps.skipUnchanged &&
          identity !== undefined &&
          last === identity &&
          !transaction.invalidated.has(fieldName)
        ) {
          state.skippedUnchangedCount += 1;
          continue;
        }
        this.noteRevealCandidate(transaction, target, value);
        const update: ScheduledUpdate = {
          target,
          value: transformed,
          allFields: data.fields,
          identity: transaction.identity,
          data,
          valueIdentity: identity,
        };
        deps.scheduler.schedule(update);
        scheduled += 1;
      }
    }
    diagnoseOrphanFields(
      { cache: deps.cache, warned: state.warnedOrphanFields, warn: deps.warn },
      data.fields,
      transaction.locale,
      ownerKeys,
    );
    if (plan !== null && plan.boundaries.length > 0) {
      transaction.pendingFragments = plan.boundaries.length;
      void this.strategies.runFragments(transaction, data, plan);
    }
    // Nothing to flush is still this revision reaching its end.
    if (scheduled === 0 && transaction.pendingFragments === 0) state.complete(transaction);
  }

  private rawValue(
    transaction: UpdateTransaction,
    target: CachedElement,
    data: PayloadLivePreviewData,
  ): unknown {
    return resolveFieldValue(
      data.fields,
      target.fieldName,
      target.locale ?? transaction.locale,
      target.locale !== undefined,
    );
  }

  /**
   * Record what this binding's value looks like now and, for the first binding
   * whose value moved, mark it as the one to reveal.
   *
   * The first message is a baseline and a binding new to the page is not an
   * edit, so an unseen key only records. A value too large or cyclic to compare
   * cannot claim to have changed either, or it would take the reveal from a
   * field that did. The ledger is keyed by document, locale and field rather
   * than by element: the element a fragment renders does not survive its own
   * re-render, but the field it shows is the same field.
   */
  private noteRevealCandidate(
    transaction: UpdateTransaction,
    target: CachedElement,
    value: unknown,
  ): void {
    const { deps, state } = this;
    if (!deps.revealEditedField) return;
    const identity = valueIdentity(value);
    if (identity === undefined) return;
    const key = `${target.owner ?? ''}\u0000${target.locale ?? ''}\u0000${target.fieldName}`;
    const seen = state.seenFieldIdentity.get(key);
    state.seenFieldIdentity.set(key, identity);
    if (seen === undefined || seen === identity || transaction.revealTarget !== undefined) return;
    transaction.revealTarget = target;
  }

  /** Owner keys this update may address; `false` when scoping is off, `null` when the message names no document. */
  private ownerKeysForUpdate(
    transaction: UpdateTransaction,
    fields: Record<string, unknown>,
  ): readonly string[] | null | false {
    const { deps, state } = this;
    if (!deps.scopeBindingsByOwner) return false;
    const { message } = transaction;
    const keys = messageOwnerKeys({
      globalSlug: typeof message.globalSlug === 'string' ? message.globalSlug : undefined,
      collectionSlug:
        typeof message.collectionSlug === 'string' ? message.collectionSlug : undefined,
      documentId: readDocumentId(fields),
    });
    if (keys === null && !state.warnedUnattributableMessage) {
      state.warnedUnattributableMessage = true;
      deps.warn(
        '[live-preview] LP0202: scopeBindingsByOwner: update names no document; nothing applied',
      );
    }
    return keys;
  }

  /** Transforms are plugin code: frozen into the scheduler entry, errors reported, never awaited. */
  private transformForBinding(
    target: CachedElement,
    originalValue: unknown,
    allFields: Record<string, unknown>,
    isCurrent: () => boolean,
  ): unknown {
    const transform = this.deps.transformValue;
    if (transform === undefined) return originalValue;
    try {
      const transformed = transform(
        target.fieldName,
        originalValue,
        { element: target.element, allFields },
        isCurrent,
      );
      const returnedThenable = observeThenableResult(transformed);
      if (!isCurrent()) return originalValue;
      if (returnedThenable) {
        throw new TypeError(
          `Transform for "${target.fieldName}" returned a thenable; transforms must be synchronous`,
        );
      }
      return transformed;
    } catch (err) {
      if (!isCurrent()) return originalValue;
      const error = err instanceof Error ? err : new Error(String(err));
      void this.deps.emitter.emit('error', { error, context: 'transform', code: 'LP0602' });
      return originalValue;
    }
  }

  /** Scheduler callback after every flush, including one that applied nothing. */
  onFlush(stats: FlushStats): void {
    const { deps, state } = this;
    state.lastFlush = stats;
    if (stats.deferred > 0 && !state.warnedVisibilityGate) {
      state.warnedVisibilityGate = true;
      deps.warn(
        `[live-preview] LP0301: visibility gate held ${String(stats.deferred)} off-screen update(s) until scrolled into view; see visibilityGateThreshold`,
      );
    }
    const { identity, data } = stats;
    if (identity === undefined) return;
    const transaction = state.activeUpdate;
    if (
      transaction === null ||
      !state.isCurrent(transaction) ||
      !sameRevision(transaction.identity, identity)
    ) {
      return;
    }
    if (transaction.pendingFragments === 0) state.complete(transaction);
    const isCurrent = (): boolean =>
      state.isCurrent(transaction) && sameRevision(transaction.identity, identity);
    // Reveal before the applied check: the edited element may be exactly the
    // off-screen one the visibility gate deferred, and scrolling to it is what replays it.
    this.revealPending(transaction);
    if (!isCurrent()) return;
    if (stats.applied === 0 || data === undefined) return;
    deps.a11y?.announceUpdate(stats.applied);
    if (!isCurrent()) return;
    dispatchIslandUpdate(deps.cache.islands, {
      fields: data.fields,
      revision: identity.revision,
      receivedAt: transaction.receivedAt,
      locale: transaction.locale,
    });
    if (!isCurrent() || deps.emitter.listenerCount('afterUpdate') === 0) return;
    void deps.emitter.emitWhile(
      'afterUpdate',
      {
        data,
        updatedCount: stats.applied,
        durationMs: stats.durationMs,
        revision: identity.revision,
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
  revealPending(transaction: UpdateTransaction): void {
    const target = transaction.revealTarget;
    if (target === undefined) return;
    transaction.revealTarget = undefined;
    try {
      this.revealBinding(target);
    } catch (error) {
      this.deps.log('reveal', error);
    }
  }

  /**
   * Scroll one field's bound element into view; the admin-focus path (tier 2)
   * names a field, so it takes the first binding — a focus message carries no
   * document identity to choose between several.
   */
  revealField(fieldName: string): 'revealed' | 'already-visible' | 'skipped-same' | 'no-element' {
    const target = this.deps.cache.get(fieldName)?.[0];
    if (target === undefined) return 'no-element';
    return this.revealBinding(target);
  }

  private revealBinding(
    target: CachedElement,
  ): 'revealed' | 'already-visible' | 'skipped-same' | 'no-element' {
    const { element } = target;
    const win = element.ownerDocument.defaultView as RevealWindow | null;
    if (win === null) return 'no-element';
    // Keyed by document as well as field: two documents on one page have their
    // own `title`, and revealing one must not count as revealing the other.
    const key = `${target.owner ?? ''} ${target.fieldName}`;
    return this.state.revealer.reveal(key, element, win);
  }
}

/** Identity of everything a binding renders: its value plus any sibling href/src/alt fields. */
function bindingIdentity(
  target: CachedElement,
  value: unknown,
  fields: Record<string, unknown>,
  locale: string | undefined,
): string | undefined {
  const own = valueIdentity(value);
  if (own === undefined) return undefined;
  const siblings = [target.hrefField, target.srcField, target.altField];
  let combined = own;
  for (const sibling of siblings) {
    if (sibling === undefined || sibling.length === 0) continue;
    const resolved = resolveFieldValue(
      fields,
      sibling,
      target.locale ?? locale,
      target.locale !== undefined,
    );
    const identity = valueIdentity(resolved);
    if (identity === undefined) return undefined;
    combined += `|${sibling}=${identity}`;
  }
  return combined;
}
