/**
 * `LivePreviewRuntime` owns the primitives and hands accepted messages to the update pipeline.
 * It never speaks postMessage or walks the DOM during an update. See ADR 0004.
 */

import { createA11y, defaultSendReady } from './runtime-wiring';
import { BindingWriter } from './binding-writer';
import { ElementCache, hasSameBindingIdentity } from './cache';
import { DataMerger } from './data-merger';
import type { DiagnosticCode } from './diagnostic-codes';
import { isolateDiagnostic, noopDiagnostic, safeConsoleWarn } from './diagnostics';
import { resolveUnfaithfulPatchMode } from './fidelity';
import { buildInspection } from './inspection/snapshot';
import type { LivePreviewInspection } from './inspection/types';
import { markNoWriteCallback } from './internal-outcome';
import { isInsideIsland } from './islands';
import { MessageBus } from './message-bus';
import { ObserverManager } from './observers';
import { LifetimeScope } from './lifetime-scope';
import type { ProtocolNegotiation } from './protocol-version';
import type { RuntimeOptions } from './runtime-options';
import { RuntimeState, type RuntimeDeps } from './runtime-state';
import { isDocumentRoot, readDocumentBody, startWhenReady, type StartupHost } from './startup';
import { ConnectionState, HeartbeatTimer } from './state';
import type { CachedElement } from './types';
import { UpdatePipeline } from './update-pipeline';
import { DEFAULT_DEBOUNCE_MS, UpdateScheduler } from './update-scheduler';

export type { RuntimeOptions } from './runtime-options';
export { resolveFieldValue } from './field-value';

/** Re-broadcast `ready` a few times to absorb admin-side init latency. */
const READY_RETRY_DELAYS_MS = [0, 500, 1000, 2000] as const;

export class LivePreviewRuntime {
  private readonly deps: RuntimeDeps;
  private readonly state = new RuntimeState();
  private readonly pipeline: UpdatePipeline;
  private readonly writer: BindingWriter;
  private rootSentinel: MutationObserver | null = null;
  /** The session's resources, released together in reverse order when it ends (ADR 0005, 2.1 note). */
  private scope: LifetimeScope | null = null;
  /** Prevent a cleanup callback from opening a session inside the one being torn down. */
  private closingSession = false;
  private observedRoot: Node | null = null;
  private replayRetainedOnStart = false;

  constructor(options: RuntimeOptions) {
    const { emitter, renderers } = options;
    const log = options.log === undefined ? noopDiagnostic : isolateDiagnostic(options.log);
    const warn = options.warn === undefined ? safeConsoleWarn : isolateDiagnostic(options.warn);
    const root = options.root ?? (typeof document !== 'undefined' ? document : undefined);
    // Name the missing option here instead of failing at the first DOM read in start().
    if (root === undefined) throw new Error('LivePreviewRuntime: no document; pass options.root');
    // Bindings inside a hydrated island are the island's business (ADR 0008 §4).
    const cache = new ElementCache({ filter: (element) => !isInsideIsland(element) });
    const observers = new ObserverManager(
      {
        onStructuralChange: () => {
          this.rebuildCache();
        },
        onIslandHydrated: (island) => {
          this.pipeline.reapplyNavigationIslands([island], true);
        },
        onVisibilityChange: (element, visible) => {
          if (visible) scheduler.notifyVisible(element);
        },
      },
      options.intersectionRootMargin !== undefined
        ? { intersectionRootMargin: options.intersectionRootMargin }
        : {},
    );
    const scheduler = new UpdateScheduler(
      markNoWriteCallback((update) => this.writer.apply(update)),
      {
        ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
        ...(options.disableVisibilityGate !== undefined
          ? { disableVisibilityGate: options.disableVisibilityGate }
          : {}),
        ...(options.visibilityGateThreshold !== undefined
          ? { visibilityGateThreshold: options.visibilityGateThreshold }
          : {}),
        isVisible: (element) => observers.isVisible(element),
        getCacheSize: () => cache.elementCount,
        onFlush: (stats) => {
          this.pipeline.onFlush(stats);
        },
      },
    );
    const bus = new MessageBus(options.originMatcher, {
      onUpdate: (message, origin, revision) => {
        this.pipeline.handleUpdate(message, origin, revision);
      },
      onReplay: (message, origin, revision) => {
        this.pipeline.handleReplay(message, origin, revision);
      },
      onDocumentEvent: () => {
        this.state.protocol.observe(['document-events'], log);
        void emitter.emit('documentSave', { timestamp: Date.now() });
      },
      onFocusField: (field) => {
        if (this.deps.revealEditedField) this.pipeline.revealField(field);
      },
      onInvalid: (reason, origin) => {
        if (reason === 'token') {
          const error = new Error(`Preview token rejected (origin: ${origin})`);
          void emitter.emit('error', { error, context: 'token', code: 'LP0502' });
        }
        // An unknown shape from a trusted origin is protocol drift, not an attack.
        // Report it here once: without `debug`, no other boundary makes it visible.
        if ((reason === 'shape' || reason === 'type') && !this.state.warnedProtocolShape) {
          this.state.warnedProtocolShape = true;
          warn(
            `[live-preview] LP0503: ${origin} posted a message this runtime does not recognise ` +
              `(${reason === 'type' ? 'unknown message type' : 'unexpected shape'}); it was ` +
              'ignored. A newer Payload or a custom sender: check that the versions match.',
          );
        }
        // This refusal default changed in 2.0. An admin posting from outside the
        // framing or opening window silently stops updates, so report it once.
        if (reason === 'source' && !this.state.warnedForeignSource) {
          this.state.warnedForeignSource = true;
          warn(
            `[live-preview] LP0501: a message from ${origin} was ignored because it did not come ` +
              'from the window that framed or opened this page. `eventSourcePolicy` is ' +
              "'parent-or-opener' by default since 2.0, where 1.x accepted any window on a " +
              "trusted origin. Set `eventSourcePolicy: 'any'` if the admin posts from elsewhere.",
          );
        }
        log('LP0501 message rejected:', reason, origin);
      },
      ...(options.validateToken !== undefined ? { validateToken: options.validateToken } : {}),
      ...(options.eventSourcePolicy !== undefined
        ? { sourcePolicy: options.eventSourcePolicy }
        : {}),
    });
    const merge = options.dataMerge;
    this.deps = {
      emitter,
      cache,
      observers,
      scheduler,
      bus,
      connection: new ConnectionState(),
      heartbeat: new HeartbeatTimer({
        ...(options.heartbeatMs !== undefined ? { timeoutMs: options.heartbeatMs } : {}),
        onTimeout: () => {
          this.onHeartbeatTimeout();
        },
      }),
      renderers,
      resolveRenderer: options.resolveRenderer ?? ((fieldType) => renderers[fieldType]),
      transformValue: options.transformValue,
      renderRichText: options.renderRichText,
      sanitizerPolicy: options.sanitizerPolicy,
      root,
      readyTargets:
        typeof options.readyTargets === 'function'
          ? options.readyTargets
          : (
              (targets) => (): readonly string[] =>
                targets
            )(options.readyTargets),
      sendReady: options.sendReady ?? defaultSendReady,
      onHeartbeatTimeout: options.onHeartbeatTimeout,
      log,
      warn,
      a11y: createA11y(options),
      merger:
        merge === undefined
          ? null
          : new DataMerger({
              serverURL: merge.serverURL,
              ...(merge.apiRoute !== undefined ? { apiRoute: merge.apiRoute } : {}),
              ...(merge.depth !== undefined ? { depth: merge.depth } : {}),
              ...(merge.fetchFn !== undefined ? { fetchFn: merge.fetchFn } : {}),
              log,
            }),
      mergeWindowMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      scopeBindingsByOwner: options.scopeBindingsByOwner === true,
      subfieldCoverage: options.subfieldCoverage ?? 'descendant',
      lockedOrigin: options.lockedOrigin ?? ((): undefined => undefined),
      skipUnchanged: options.skipUnchanged === true,
      dependencies: options.dependencies ?? {},
      strategies: options.strategies ?? {},
      revealEditedField: options.revealEditedField === true,
      onUnfaithfulPatch: resolveUnfaithfulPatchMode(options),
      autoBind: options.autoBind ?? 'off',
      hydration: options.hydration,
    };
    this.writer = new BindingWriter(this.deps, this.state);
    this.pipeline = new UpdatePipeline(this.deps, this.state, () => {
      this.rebuildCache();
    });
  }

  /**
   * Build the cache, attach observers and listeners, broadcast `ready`.
   * Returns `false` when already started. While the document is still
   * parsing the real start waits for `DOMContentLoaded`; on a page that
   * declares hydration it then waits for React's first commit as well
   * (ADR 0015), so the first write lands on markup React keeps.
   */
  start(): boolean {
    const { state } = this;
    if (state.isRunning() || this.closingSession) return false;
    if (state.suspended) this.replayRetainedOnStart = true;
    state.started = true;
    state.suspended = false;
    this.openScope();
    try {
      startWhenReady(this.startupHost());
      return true;
    } catch (error) {
      this.rollbackFailedStart();
      throw error;
    }
  }

  /** The runtime as the startup chain sees it (./startup). */
  private startupHost(): StartupHost {
    const { state, deps } = this;
    return {
      root: deps.root,
      hydration: deps.hydration,
      isRunning: () => state.isRunning(),
      defer: (cancel) => {
        state.deferredStart = cancel;
        this.scope?.own(() => {
          if (state.deferredStart !== cancel) return;
          state.deferredStart = null;
          cancel();
        });
      },
      later: (step) => {
        state.deferredStart = null;
        try {
          step();
        } catch (error) {
          // start() already returned; roll back and report through the error event.
          this.rollbackFailedStart();
          this.reportError(error, 'startup', 'LP0605');
        }
      },
      hydrated: (hydration) => {
        state.hydration = hydration;
      },
      warn: deps.warn,
      startNow: () => {
        this.startNow();
      },
    };
  }

  private startNow(): void {
    const { state, deps } = this;
    if (!state.isRunning()) return;
    const observerRoot: Node | null = isDocumentRoot(deps.root)
      ? readDocumentBody(deps.root)
      : deps.root;
    if (observerRoot === null) throw new Error('LivePreviewRuntime: document.body unavailable');
    deps.observers.start(observerRoot);
    this.observedRoot = observerRoot;
    this.watchRootReplacement();
    // Observers first: the cache scan registers its elements with them.
    this.buildCacheAndObserve();
    if (!state.isRunning()) return;
    deps.bus.attach();
    void deps.emitter.emitWhile('init', { timestamp: Date.now() }, () => state.isRunning());
    if (!state.isRunning()) return;
    const recoverSuspendedSession = this.replayRetainedOnStart;
    this.replayRetainedOnStart = false;
    const suspendedHeartbeatExpired = recoverSuspendedSession && deps.heartbeat.resume();
    if (!state.isRunning()) return;
    if (recoverSuspendedSession && !suspendedHeartbeatExpired) {
      state.forgetOwedWork();
      state.merges.resetRawChanges();
      state.unfaithfulPatches = [];
      state.revealer.reset();
      state.lastAppliedIdentity = new WeakMap();
      state.changes.reset();
      state.navigationReplayPending = true;
      if (!deps.bus.replayLastAccepted()) state.navigationReplayPending = false;
      if (!state.isRunning()) return;
    }
    for (const delay of READY_RETRY_DELAYS_MS) {
      if (!state.isRunning()) return;
      if (delay === 0) {
        deps.sendReady(deps.readyTargets());
      } else {
        state.readyTimers.push(
          setTimeout(() => {
            if (state.isRunning()) this.sendReadyAfterStart();
          }, delay),
        );
      }
    }
  }

  /**
   * Release the message ingress and observers but keep the configuration, so
   * `start()` brings the same instance back — what a back/forward-cache
   * restore needs, since it re-runs no scripts.
   */
  suspend(): boolean {
    if (!this.state.isRunning()) return false;
    const wasConnected = this.release();
    this.state.suspended = true;
    if (wasConnected) {
      void this.deps.emitter.emit('disconnect', { reason: 'unload', timestamp: Date.now() });
    }
    return true;
  }

  destroy(): void {
    const { state, deps } = this;
    if (!state.isRunning() && !state.suspended) return;
    const wasConnected = state.isRunning() ? this.release() : false;
    state.suspended = false;
    this.replayRetainedOnStart = false;
    deps.bus.forgetLastAccepted();
    if (wasConnected) {
      void deps.emitter.emit('disconnect', { reason: 'destroy', timestamp: Date.now() });
    }
    deps.a11y?.detach();
    void deps.emitter.emit('destroy', { timestamp: Date.now() });
  }

  /**
   * One scope per session, opened by `start()`. What it holds is the
   * teardown in reverse order, so `destroy()`, `suspend()` and failed starts
   * all invalidate the session, abort in-flight work and close the same scope.
   */
  private openScope(): void {
    const { state, deps } = this;
    const scope = new LifetimeScope(deps.log);
    scope.own(() => {
      deps.merger?.destroy();
      state.merges.destroy();
    });
    scope.own(() => {
      deps.scheduler.destroy();
    });
    scope.own(() => {
      deps.observers.stop();
    });
    scope.own(() => {
      this.rootSentinel?.disconnect();
      this.rootSentinel = null;
      this.observedRoot = null;
    });
    scope.own(() => {
      state.abortStrategies();
    });
    scope.own(() => {
      deps.bus.detach();
    });
    scope.own(() => {
      deps.heartbeat.stop();
    });
    scope.own(() => {
      for (const handle of state.readyTimers) clearTimeout(handle);
      state.readyTimers.length = 0;
    });
    this.scope = scope;
  }

  private release(): boolean {
    const { state, deps } = this;
    state.activeUpdate = null;
    state.navigationBindingReplay = false;
    state.started = false;
    const closingScope = this.scope;
    this.scope = null;
    this.closingSession = true;
    try {
      closingScope?.close();
    } finally {
      this.closingSession = false;
    }
    deps.cache.clear();
    return deps.connection.markDisconnected();
  }

  private rollbackFailedStart(): void {
    this.release();
    try {
      this.deps.a11y?.detach();
    } catch (error) {
      this.deps.log('runtime cleanup failed:', error);
    }
  }

  /** Re-scan the DOM and re-register every binding. */
  refreshCache(): void {
    if (!this.state.isRunning()) return;
    this.state.revealer.reset();
    if (!this.followReplacedRoot()) this.rebuildCache();
  }

  /**
   * Supersede work owned by the route being left, then rescan and locally
   * replay the last accepted snapshot. The ordinary public refresh keeps
   * buffered work; only a confirmed router commit crosses this boundary.
   * @internal
   */
  navigationCommit(): void {
    const { state, deps } = this;
    // Before startup owns the bus/cache, its parse/hydration wait scans and sends the handshake.
    if (!state.isRunning() || state.deferredStart !== null) return;
    // Finish destructive cleanup before opening the next ingress generation.
    // Abort/fetch listeners may synchronously post a newer document; the second
    // cancellation retains it instead of letting this older cleanup tear it down.
    this.cancelActiveUpdate(true);
    deps.merger?.destroy();
    state.merges.destroy();
    state.abortStrategies();
    this.cancelActiveUpdate(true);
    state.forgetOwedWork();
    state.merges.resetRawChanges();
    state.unfaithfulPatches = [];
    state.revealer.reset();
    // A retained element's previous value identity says nothing about the new route's DOM.
    state.lastAppliedIdentity = new WeakMap();
    state.changes.reset();
    if (!state.isRunning()) return;
    deps.bus.advanceGeneration();
    state.navigationReplayPending = true;
    if (!this.followReplacedRoot()) this.rebuildCache();
    if (!state.isRunning()) return;
    deps.bus.replayLastAccepted();
    if (state.isRunning()) this.sendReadyAfterStart();
  }

  /** Some routers swap `document.body` on navigation, leaving observers on a detached node. */
  private watchRootReplacement(): void {
    const { root } = this.deps;
    if (!isDocumentRoot(root) || typeof MutationObserver === 'undefined') return;
    this.rootSentinel?.disconnect();
    this.rootSentinel = new MutationObserver(() => {
      this.followReplacedRoot();
    });
    this.rootSentinel.observe(root.documentElement, { childList: true });
  }

  /** Rebind observers and cache to a replaced body; returns whether it did. */
  private followReplacedRoot(): boolean {
    const { root } = this.deps;
    if (!this.state.isRunning() || !isDocumentRoot(root)) return false;
    const body = readDocumentBody(root);
    if (body === null || body === this.observedRoot) return false;
    this.observedRoot = body;
    this.deps.observers.start(body);
    this.rebuildCache();
    return true;
  }

  get status(): 'disconnected' | 'connecting' | 'connected' {
    return this.deps.connection.status;
  }

  get cache(): ElementCache {
    return this.deps.cache;
  }

  get updateCount(): number {
    return this.state.updateCount;
  }

  /** Negotiated protocol view, `min(library, remote)`. */
  get protocol(): ProtocolNegotiation {
    return this.state.protocol.negotiation;
  }

  /** Point-in-time read of runtime state for diagnosing a preview that is not updating. */
  inspect(): LivePreviewInspection {
    return buildInspection(this.deps, this.state);
  }

  private buildCacheAndObserve(): void {
    const { state, deps } = this;
    if (!state.isRunning()) return;
    const stats = deps.cache.buildFromRoot(deps.root);
    deps.log('cache', stats);
    if (!state.isRunning()) return;
    void deps.emitter.emitWhile('cacheRefresh', stats, () => state.isRunning());
    if (!state.isRunning()) return;
    for (const entry of deps.cache.values()) {
      if (!state.isRunning()) return;
      deps.observers.observeElement(entry.element);
    }
  }

  private rebuildCache(): void {
    const { state, deps } = this;
    if (!state.isRunning()) return;
    const previous = new Map<Element, CachedElement>();
    const previousIslandOwners = deps.cache.islandOwners;
    const previousNavigationRoots = new Set(deps.cache.navigationReplayRoots);
    for (const entry of deps.cache.values()) {
      previous.set(entry.element, entry);
      deps.observers.unobserveElement(entry.element);
    }
    this.buildCacheAndObserve();
    if (!state.isRunning()) return;
    const added = new Set<Element>(
      deps.cache.navigationReplayRoots.filter((root) => !previousNavigationRoots.has(root)),
    );
    // Buffered work survives only while the same element is bound to the same field.
    for (const entry of deps.cache.values()) {
      const before = previous.get(entry.element);
      if (before !== undefined && hasSameBindingIdentity(before, entry)) {
        deps.scheduler.retarget(entry);
      } else {
        deps.scheduler.forget(entry.element);
        added.add(entry.element);
      }
      previous.delete(entry.element);
    }
    for (const removed of previous.values()) deps.scheduler.forget(removed.element);
    if (added.size > 0) this.pipeline.reapplyNavigationBindings(added);
    const addedIslands = deps.cache.islands.filter(
      (island) =>
        !previousIslandOwners.has(island) ||
        (deps.scopeBindingsByOwner &&
          previousIslandOwners.get(island) !== deps.cache.islandOwners.get(island)),
    );
    if (addedIslands.length > 0) this.pipeline.reapplyNavigationIslands(addedIslands);
  }

  private onHeartbeatTimeout(): void {
    const { state, deps } = this;
    if (!state.isRunning()) return;
    // Cleanup belongs to the expiring generation; a synchronous abort listener cannot
    // reconnect into the generation this same cleanup is about to destroy.
    this.cancelActiveUpdate(false);
    deps.merger?.destroy();
    state.merges.destroy();
    state.abortStrategies();
    this.cancelActiveUpdate(false);
    if (!state.isRunning()) return;
    deps.bus.advanceGeneration();
    deps.bus.forgetLastAccepted();
    state.navigationBindingReplay = false;
    const wasConnected = deps.connection.markDisconnected();
    // Release the origin lock before the disconnect event: a listener may
    // reconnect from another allow-listed origin synchronously.
    try {
      deps.onHeartbeatTimeout?.();
    } catch (error) {
      deps.log('heartbeat:', error);
    }
    if (!state.isRunning()) return;
    if (wasConnected && this.isIdleDisconnected()) {
      deps.a11y?.announceDisconnected();
      void deps.emitter.emitWhile('disconnect', { reason: 'timeout', timestamp: Date.now() }, () =>
        this.isIdleDisconnected(),
      );
      if (!state.isRunning()) return;
      if (this.isIdleDisconnected()) deps.log('connection', 'connected', '→', 'disconnected');
      if (!state.isRunning()) return;
    }
    this.sendReadyAfterStart();
  }

  /** Cancel whichever revision owns work now; cleanup callbacks may install a newer one. */
  private cancelActiveUpdate(countSuperseded: boolean): void {
    const { state, deps } = this;
    const active = state.activeUpdate;
    state.activeUpdate = null;
    if (active === null) return;
    active.cancelled = true;
    deps.scheduler.cancelRevision(active.revision);
    if (countSuperseded && !active.completed && active.countsAsUpdate) {
      state.supersededCount += 1;
    }
  }

  /** Later handshake retries are best-effort and must not escape timer callbacks. */
  private sendReadyAfterStart(): void {
    try {
      this.deps.sendReady(this.deps.readyTargets());
    } catch (error) {
      this.reportError(error, 'ready', 'LP0606');
    }
  }

  private reportError(cause: unknown, context: string, code: DiagnosticCode): void {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    void this.deps.emitter.emit('error', { error, context, code });
  }

  private isIdleDisconnected(): boolean {
    return (
      this.state.isRunning() &&
      this.deps.connection.status === 'disconnected' &&
      this.state.activeUpdate === null
    );
  }
}
