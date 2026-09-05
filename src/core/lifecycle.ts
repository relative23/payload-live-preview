/**
 * `LivePreviewRuntime` builds the primitives, owns their lifecycle and hands
 * accepted messages to the update pipeline. It never speaks postMessage
 * itself and never walks the DOM during an update. See ADR 0004.
 */

import { A11yAnnouncer } from './a11y';
import { BindingWriter } from './binding-writer';
import { ElementCache } from './cache';
import { DataMerger } from './data-merger';
import type { DiagnosticCode } from './diagnostic-codes';
import { isolateDiagnostic, noopDiagnostic, safeConsoleWarn } from './diagnostics';
import { buildInspection } from './inspection/snapshot';
import type { LivePreviewInspection } from './inspection/types';
import { markNoWriteCallback } from './internal-outcome';
import { isInsideIsland } from './islands';
import { MessageBus } from './message-bus';
import { ObserverManager } from './observers';
import type { ProtocolNegotiation } from './protocol-version';
import type { RuntimeOptions } from './runtime-options';
import { RuntimeState, type RuntimeDeps } from './runtime-state';
import { ConnectionState, HeartbeatTimer } from './state';
import type { CachedElement } from './types';
import { UpdatePipeline } from './update-pipeline';
import { UpdateScheduler } from './update-scheduler';

export type { RuntimeOptions } from './runtime-options';
export { resolveFieldValue } from './field-value';

/** Re-broadcast `ready` a few times to absorb admin-side init latency. */
const READY_RETRY_DELAYS_MS = [0, 500, 1000, 2000] as const;

export class LivePreviewRuntime {
  private readonly deps: RuntimeDeps;
  private readonly state = new RuntimeState();
  private readonly pipeline: UpdatePipeline;
  private readonly writer: BindingWriter;
  /** Watches `<html>` for a swapped `<body>` so the observers follow it. */
  private rootSentinel: MutationObserver | null = null;
  private observedRoot: Node | null = null;

  constructor(options: RuntimeOptions) {
    const { emitter, renderers } = options;
    const log = options.log === undefined ? noopDiagnostic : isolateDiagnostic(options.log);
    const warn = options.warn === undefined ? safeConsoleWarn : isolateDiagnostic(options.warn);
    const root = options.root ?? (typeof document !== 'undefined' ? document : undefined);
    // Without a document there is nothing to bind. Failing here names the
    // option; the alternative is a TypeError from the first DOM read in start().
    if (root === undefined) throw new Error('LivePreviewRuntime: no document; pass options.root');
    // Bindings inside a hydrated island are the island's business (ADR 0008 §4).
    const cache = new ElementCache({ filter: (element) => !isInsideIsland(element) });
    const observers = new ObserverManager(
      {
        onStructuralChange: () => {
          this.rebuildCache();
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
      scopeBindingsByOwner: options.scopeBindingsByOwner === true,
      lockedOrigin: options.lockedOrigin ?? ((): undefined => undefined),
      skipUnchanged: options.skipUnchanged === true,
      dependencies: options.dependencies ?? {},
      strategies: options.strategies ?? {},
      revealEditedField: options.revealEditedField === true,
    };
    this.writer = new BindingWriter(this.deps, this.state);
    this.pipeline = new UpdatePipeline(this.deps, this.state, () => {
      this.rebuildCache();
    });
  }

  /**
   * Build the cache, attach observers and listeners, broadcast `ready`.
   * Returns `false` when already started. While the document is still
   * parsing the real start waits for `DOMContentLoaded`.
   */
  start(): boolean {
    const { state, deps } = this;
    if (state.isRunning()) return false;
    state.started = true;
    state.suspended = false;
    if (isDocumentRoot(deps.root) && deps.root.readyState === 'loading') {
      const onReady = (): void => {
        if (!state.isRunning()) return;
        state.deferredStart = null;
        try {
          this.startNow();
        } catch (error) {
          // start() already returned; roll back and report through the error event.
          this.rollbackFailedStart();
          this.reportError(error, 'startup', 'LP0605');
        }
      };
      state.deferredStart = onReady;
      try {
        deps.root.addEventListener('DOMContentLoaded', onReady, { once: true });
      } catch (error) {
        this.rollbackFailedStart();
        throw error;
      }
      return true;
    }
    try {
      this.startNow();
      return true;
    } catch (error) {
      this.rollbackFailedStart();
      throw error;
    }
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
    if (wasConnected) {
      void deps.emitter.emit('disconnect', { reason: 'destroy', timestamp: Date.now() });
    }
    deps.a11y?.detach();
    void deps.emitter.emit('destroy', { timestamp: Date.now() });
  }

  /** Invalidate first, then release everything startup may have acquired. */
  private release(): boolean {
    const { state, deps } = this;
    state.activeUpdate = null;
    state.started = false;
    const deferredStart = state.deferredStart;
    state.deferredStart = null;
    if (deferredStart !== null && isDocumentRoot(deps.root)) {
      this.runCleanup(() => {
        deps.root.removeEventListener('DOMContentLoaded', deferredStart);
      });
    }
    for (const handle of state.readyTimers) {
      this.runCleanup(() => {
        clearTimeout(handle);
      });
    }
    state.readyTimers.length = 0;
    this.runCleanup(() => {
      deps.heartbeat.stop();
    });
    this.runCleanup(() => {
      deps.bus.detach();
    });
    state.abortStrategies();
    this.runCleanup(() => {
      this.rootSentinel?.disconnect();
      this.rootSentinel = null;
      this.observedRoot = null;
    });
    this.runCleanup(() => {
      deps.observers.stop();
    });
    this.runCleanup(() => {
      deps.scheduler.destroy();
    });
    this.runCleanup(() => {
      deps.merger?.destroy();
    });
    deps.cache.clear();
    return deps.connection.markDisconnected();
  }

  private rollbackFailedStart(): void {
    this.release();
    this.runCleanup(() => {
      this.deps.a11y?.detach();
    });
  }

  private runCleanup(cleanup: () => void): void {
    try {
      cleanup();
    } catch (error) {
      this.deps.log('cleanup failed:', error);
    }
  }

  /** Re-scan the DOM and re-register every binding. */
  refreshCache(): void {
    if (!this.state.isRunning()) return;
    this.state.revealer.reset();
    if (!this.followReplacedRoot()) this.rebuildCache();
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
    for (const entry of deps.cache.values()) {
      previous.set(entry.element, entry);
      deps.observers.unobserveElement(entry.element);
    }
    this.buildCacheAndObserve();
    if (!state.isRunning()) return;
    // Buffered work survives only while the same element is bound to the same field.
    for (const entry of deps.cache.values()) {
      const before = previous.get(entry.element);
      if (before?.fieldName === entry.fieldName) deps.scheduler.retarget(entry);
      else deps.scheduler.forget(entry.element);
      previous.delete(entry.element);
    }
    for (const removed of previous.values()) deps.scheduler.forget(removed.element);
  }

  private onHeartbeatTimeout(): void {
    const { state, deps } = this;
    if (!state.isRunning()) return;
    deps.bus.advanceGeneration();
    const active = state.activeUpdate;
    state.activeUpdate = null;
    if (active !== null) deps.scheduler.cancelRevision(active.revision);
    deps.merger?.destroy();
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

function createA11y(options: RuntimeOptions): A11yAnnouncer | null {
  if (options.enableA11y === false) return null;
  const root = options.root;
  const targetDocument =
    root === undefined ? undefined : isDocumentRoot(root) ? root : root.ownerDocument;
  return new A11yAnnouncer(options.a11yLocale, targetDocument);
}

/** Node types are stable across realms; global constructors are not. */
function isDocumentRoot(root: Document | Element): root is Document {
  return root.nodeType === 9;
}

/** lib.dom types body as present; a head-time document has none yet. */
function readDocumentBody(root: Document): HTMLElement | null {
  return root.body;
}

function defaultSendReady(origins: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const targets: Window[] = [];
  if (window.parent !== window) targets.push(window.parent);
  if (window.opener instanceof Window) targets.push(window.opener);
  MessageBus.sendReady(targets, origins);
}
