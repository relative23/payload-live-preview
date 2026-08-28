/**
 * Live preview runtime — the orchestrator that wires every primitive
 * into a single, manageable lifecycle.
 *
 * This module is the *seam* between the inline IIFE (Phase 6) and the
 * high-level client (Phase 12). Both import from here and add their
 * own glue:
 *
 *   - The inline runtime instantiates `LivePreviewRuntime` with the
 *     minimum required configuration and exposes a small global API.
 *   - The high-level client instantiates the same runtime but layers
 *     events, plugins, and configurable callbacks on top.
 *
 * The runtime never speaks postMessage directly — it relies on
 * `MessageBus`. It never queries the DOM during updates — it relies
 * on `ElementCache`. The separation keeps each module testable in
 * isolation while letting this file express the high-level flow.
 *
 * @module @core/lifecycle
 */

import type {
  PayloadFieldSchema,
  PayloadLivePreviewData,
  PayloadLivePreviewMessage,
} from '@/types/payload-protocol';
import type { EventEmitter } from '@events/emitter';
import type { MessageRevision, OriginMatcher } from './message-bus';
import type {
  CachedElement,
  FieldRenderer,
  RenderContext,
  RendererKey,
  RichTextRenderer,
} from './types';
import { ElementCache } from './cache';
import { isBindingInScope, messageOwnerKeys, readDocumentId } from './binding-owner';
import { ObserverManager } from './observers';
import { MessageBus } from './message-bus';
import { ConnectionState, HeartbeatTimer } from './state';
import { DataMerger } from './data-merger';
import { detectProtocolProfile } from './protocol-profile';
import { morphElement } from './morph';
import { KEY_ATTRIBUTE as MORPH_KEY_ATTRIBUTE } from './structural-applier';
import { trustedHtml } from '@security/trusted-types';
import {
  enclosingFragment,
  resolveStrategy,
  type FragmentContext,
  type FragmentStrategy,
  type RouteStrategy,
  type StrategyHandlers,
} from './strategies';
import { applyAttributeBinding } from './attribute-binding';
import { UpdateScheduler, type FlushStats, type ScheduledUpdate } from './update-scheduler';
import type { LivePreviewInspection } from './inspection/types';
import type { DiagnosticCode } from './diagnostic-codes';
import { VERSION } from '../version';
import { observeThenableResult } from './thenable';
import { resolveFieldValue } from './field-value';
import { valueIdentity } from './value-identity';
import { FieldRevealer, type RevealWindow } from './reveal';
import { mergeDependencyMaps } from './dependencies';
import { dispatchIslandUpdate, isInsideIsland } from './islands';
import { A11yAnnouncer } from './a11y';
import { isolateDiagnostic, noopDiagnostic, safeConsoleWarn } from './diagnostics';
import { markNoWriteCallback, rendererUsesNoWriteOutcome } from './internal-outcome';
import {
  buildSchemaIndex,
  lookupSchema,
  payloadTypeToRenderer,
  type SchemaIndex,
} from '@schema/index';
import {
  LIBRARY_PROTOCOL_VERSION,
  negotiateProtocol,
  observeCapabilities,
  type ProtocolCapability,
  type ProtocolNegotiation,
} from './protocol-version';

const READY_RETRY_DELAYS_MS = [0, 500, 1000, 2000] as const;

export interface RuntimeOptions {
  /** Document root containing the bindings. Defaults to `document`. */
  readonly root?: Document | Element;
  /** Map from field type to renderer. */
  readonly renderers: Readonly<Record<string, FieldRenderer>>;
  /** Resolve the currently active renderer layer for a field type. */
  readonly resolveRenderer?: (
    fieldType: RendererKey,
    target: CachedElement,
  ) => FieldRenderer | undefined;
  /** Project rich-text renderer handed to the `richText` renderer through its context. */
  readonly renderRichText?: RichTextRenderer;
  /**
   * Transform a merged field value while preparing its per-binding scheduler
   * entry. The result is frozen for debounce/replay, then passes through all
   * downstream attribute or renderer security validation. `allFields` remains
   * the untransformed revision snapshot.
   */
  readonly transformValue?: (
    fieldName: string,
    value: unknown,
    context: {
      readonly element: Element;
      readonly allFields: Record<string, unknown>;
    },
    /** Stops a transform chain if synchronous re-entry supersedes this revision. */
    isCurrent?: () => boolean,
  ) => unknown;
  /** Origin matcher for incoming messages. */
  readonly originMatcher: OriginMatcher;
  /**
   * Reads the origin the host has locked onto, for the inspection snapshot.
   * The lock lives in the `OriginDetector` the caller owns, not in the
   * runtime, so the runtime has to be told how to read it.
   */
  readonly lockedOrigin?: () => string | undefined;
  /**
   * Skip a binding whose value is structurally identical to the one it last
   * applied. Every message carries the whole document, so on a page with many
   * bindings almost every value in a keystroke is unchanged; rendering it
   * again costs a Lexical pass and a sanitizer pass for nothing.
   *
   * Off by default in 1.x, because it is observable: renderers and
   * `elementUpdate` listeners stop seeing repeats. A binding is still applied
   * when a field it depends on changed (see `dependencies`), when its element
   * is new to the cache, or when the value cannot be given an identity.
   */
  readonly skipUnchanged?: boolean;
  /** Scroll the preview to the field being edited when its value changes. */
  readonly revealEditedField?: boolean;
  /**
   * Fields whose change must re-apply other bindings even when those
   * bindings' own values did not change: `{ price: ['priceLabel'] }` says a
   * change to `price` invalidates `priceLabel`. Consulted only with
   * `skipUnchanged`. Empty until markup can declare it (`data-payload-depends`
   * is planned); the shape exists now so that declaration lands here instead
   * of reopening this option.
   */
  readonly dependencies?: Readonly<Record<string, readonly string[]>>;
  /**
   * Strategy handlers beyond the runtime's own patching. `fragment` renders a
   * `data-payload-fragment` boundary on the server for each revision that
   * touches it (`payload-live-preview/fragment` provides one). Without a
   * handler such a boundary is patched like any other markup.
   */
  readonly strategies?: StrategyHandlers;
  /** Origins to broadcast `ready` to during the handshake. */
  readonly readyTargets: readonly string[];
  /** Event emitter (per-instance). */
  readonly emitter: EventEmitter;
  /** Debounce window in ms. */
  readonly debounceMs?: number;
  /** Heartbeat timeout. */
  readonly heartbeatMs?: number;
  /** Optional rootMargin for the IntersectionObserver. */
  readonly intersectionRootMargin?: string;
  /**
   * Restrict every update to the bindings owned by the document the message
   * describes, resolved from the nearest `data-payload-owner` ancestor.
   *
   * Off by default: a 1.x page whose bindings carry no owner keeps matching on
   * the field name alone. Once enabled, an unowned binding and a binding owned
   * by another document are both out of scope, so a page that previews several
   * documents stops sharing a field name between them.
   */
  readonly scopeBindingsByOwner?: boolean;
  /**
   * Which windows may post updates: `'any'` that passes the origin check
   * (default, 1.x), or `'parent-or-opener'` — the admin frames or opens the
   * page, so its window is the only legitimate sender. ADR 0007, row
   * "messages must come from parent/opener"; `defaults: 'v2'` sets it.
   */
  readonly eventSourcePolicy?: 'any' | 'parent-or-opener';
  /** When true, every update applies regardless of visibility. */
  readonly disableVisibilityGate?: boolean;
  /** Cache-size threshold above which off-screen updates are queued for replay. Default 50. */
  readonly visibilityGateThreshold?: number;
  /**
   * Mount an `aria-live` region and announce connections, applied updates,
   * and heartbeat-timeout disconnects while the runtime remains mounted.
   * Destroy releases the region synchronously and does not promise a final
   * audible announcement. Default `true`. Set `false` for runtimes that
   * already provide their own screen-reader announcements.
   */
  readonly enableA11y?: boolean;
  /**
   * Locale used to pick announcement strings. Defaults to the value
   * detected from `<html lang>` / `navigator.language` / `'en'`.
   */
  readonly a11yLocale?: string;
  /** Hook called when the runtime decides to (re)send the ready handshake. */
  readonly sendReady?: (origins: readonly string[]) => void;
  /**
   * Hook called when the heartbeat times out. Lets the host release
   * any origin lock so a different allow-listed origin can reconnect.
   * The default `LivePreviewClient` wires this to `OriginDetector.unlockOrigin()`.
   */
  readonly onHeartbeatTimeout?: () => void;
  /**
   * Optional preview-token validator. When provided, every data
   * update message must carry a `previewToken` that this function
   * approves; otherwise the message is dropped.
   *
   * ⚠️ `previewToken` is an extension of this library — the stock
   * Payload admin never sends one. Enable only when a custom admin
   * component attaches the token; otherwise every real update would
   * be dropped.
   */
  readonly validateToken?: (
    token: string | undefined,
    origin: string,
  ) => boolean | Promise<boolean>;
  /**
   * Server-side data merging (Payload 3.x). When configured, every
   * update is re-fetched through the Payload REST API so relationship
   * and upload fields arrive populated instead of as bare IDs — the
   * same strategy the official `@payloadcms/live-preview` client uses.
   * Failures fall back to rendering the raw form values.
   */
  readonly dataMerge?: {
    /** Payload server origin, e.g. `https://cms.example.com`. */
    readonly serverURL: string;
    /** REST API route prefix. Defaults to `/api`. */
    readonly apiRoute?: string;
    /** Population depth. Defaults to `1`. */
    readonly depth?: number;
    /** Injectable fetch implementation (tests). */
    readonly fetchFn?: typeof fetch;
  };
  /** Hook for the inline runtime to log to the console in debug mode. */
  readonly log?: (...args: unknown[]) => void;
  /**
   * Diagnostic warning channel — used by the runtime to surface
   * consumer-side mistakes that would otherwise produce silent
   * confusion (e.g., update arrived for a field that has no
   * `[data-payload-field]` anchor). Defaults to `console.warn`.
   *
   * Distinct from `log` because warnings should reach the editor
   * even when general debug logging is disabled — every warning is
   * deduped per field name so the channel cannot be spammed.
   */
  readonly warn?: (...args: unknown[]) => void;
}

interface UpdateTransaction {
  readonly identity: MessageRevision;
  readonly message: PayloadLivePreviewMessage;
  readonly locale: string | undefined;
  readonly schema: readonly PayloadFieldSchema[] | undefined;
  readonly schemaIndex: SchemaIndex | undefined;
  /** When the message was accepted, Unix milliseconds; surfaced on lifecycle events. */
  readonly receivedAt: number;
  /** Render every bound field even when its value is unchanged (a relationship edit may have changed populated values only). */
  readonly forceRender: boolean;
  /** Fragment renders still in flight for this revision; completion waits for them. */
  pendingFragments: number;
  /** Whether the route was refreshed for this revision; a second request is the loop guard's LP0805. */
  routeRefreshed: boolean;
  cancelled: boolean;
  /**
   * Terminal state: the revision's scheduled writes reached the DOM. A newer
   * message arriving before this counts as a supersession; after it, the
   * previous update simply finished.
   */
  completed: boolean;
}

const enum RuntimeDependencySlot {
  Emitter,
  Cache,
  Observers,
  Scheduler,
  Bus,
  ConnectionState,
  Heartbeat,
  Renderers,
  ResolveRenderer,
  TransformValue,
  Root,
  ReadyTargets,
  SendReady,
  HeartbeatTimeoutHook,
  Log,
  Warn,
  ReadyTimers,
  A11y,
  Merger,
  ScopeBindingsByOwner,
  LockedOrigin,
  SkipUnchanged,
  Dependencies,
  Strategies,
  RevealEditedField,
}

/** Stable object/function references owned for the complete runtime lifetime. */
type RuntimeDependencies = readonly [
  emitter: EventEmitter,
  cache: ElementCache,
  observers: ObserverManager,
  scheduler: UpdateScheduler,
  bus: MessageBus,
  connectionState: ConnectionState,
  heartbeat: HeartbeatTimer,
  renderers: Readonly<Record<string, FieldRenderer>>,
  resolveRenderer: NonNullable<RuntimeOptions['resolveRenderer']>,
  transformValue: RuntimeOptions['transformValue'],
  root: Document | Element,
  readyTargets: readonly string[],
  sendReady: (origins: readonly string[]) => void,
  heartbeatTimeoutHook: RuntimeOptions['onHeartbeatTimeout'],
  log: (...args: unknown[]) => void,
  warn: (...args: unknown[]) => void,
  readyTimers: ReturnType<typeof setTimeout>[],
  a11y: A11yAnnouncer | null,
  merger: DataMerger | null,
  scopeBindingsByOwner: boolean,
  lockedOrigin: () => string | undefined,
  skipUnchanged: boolean,
  dependencies: Readonly<Record<string, readonly string[]>>,
  strategies: StrategyHandlers,
  revealEditedField: boolean,
];

const enum RuntimeLifecycleSlot {
  CurrentLocale,
  CurrentSchema,
  SchemaIndex,
  ProtocolNegotiation,
  Started,
  DeferredStart,
  UpdateCount,
  ActiveUpdate,
  WarnedOrphanFields,
  WarnedUnattributableMessage,
  WarnedVisibilityGate,
  SupersededCount,
  LastFlush,
  AbsentFields,
  LastAppliedIdentity,
  SkippedUnchangedCount,
  PreviousFieldIdentity,
  CompletedCount,
  ObservedCapabilities,
  FragmentController,
  FragmentStats,
  WarnedFragmentFallback,
  RouteStats,
  RouteController,
  Revealer,
  RevealLastValues,
}

/** State that changes as the runtime starts, accepts revisions, and stops. */
type RuntimeLifecycleState = [
  currentLocale: string | undefined,
  currentSchema: readonly PayloadFieldSchema[] | undefined,
  schemaIndex: SchemaIndex | undefined,
  protocolNegotiation: ProtocolNegotiation,
  started: boolean,
  deferredStart: (() => void) | null,
  updateCount: number,
  activeUpdate: UpdateTransaction | null,
  warnedOrphanFields: Set<string>,
  warnedUnattributableMessage: boolean,
  warnedVisibilityGate: boolean,
  supersededCount: number,
  lastFlush: FlushStats | null,
  absentFields: Set<string>,
  lastAppliedIdentity: WeakMap<Element, string>,
  skippedUnchangedCount: number,
  previousFieldIdentity: Map<string, string | undefined> | null,
  completedCount: number,
  observedCapabilities: Set<ProtocolCapability>,
  fragmentController: AbortController | null,
  fragmentStats: { rendered: number; failed: number; superseded: number },
  warnedFragmentFallback: boolean,
  routeStats: { refreshes: number; failed: number; loopStopped: number },
  routeController: AbortController | null,
  revealer: FieldRevealer,
  revealLastValues: Map<string, string | undefined>,
];

export class LivePreviewRuntime {
  /**
   * Consolidating internal storage avoids ES2020 private-field WeakMaps in the
   * inline build. Stable dependencies and mutable lifecycle state stay in
   * separate named tuples so ownership and mutation boundaries remain explicit.
   * This runtime class is not exported by a package entry.
   */
  private readonly d: RuntimeDependencies;
  readonly #renderRichText: RichTextRenderer | undefined;
  readonly #warnedStrategy = new WeakSet<Element>();
  /** Watches `<html>` for a replaced `<body>` so the observers follow it (F-36). */
  #rootSentinel: MutationObserver | null = null;
  #observedRoot: Node | null = null;
  private readonly l: RuntimeLifecycleState;

  constructor(options: RuntimeOptions) {
    const emitter = options.emitter;
    const renderers = options.renderers;
    const resolveRenderer = options.resolveRenderer ?? ((fieldType) => renderers[fieldType]);
    this.#renderRichText = options.renderRichText;
    const transformValue = options.transformValue;
    const root =
      options.root ?? (typeof document !== 'undefined' ? document : (null as unknown as Document));
    const readyTargets = options.readyTargets;
    const sendReady = options.sendReady ?? defaultSendReady;
    const heartbeatTimeoutHook = options.onHeartbeatTimeout;
    const log = options.log === undefined ? noopDiagnostic : isolateDiagnostic(options.log);
    const warn = options.warn === undefined ? safeConsoleWarn : isolateDiagnostic(options.warn);
    const a11y = createA11y(options);
    const merger =
      options.dataMerge !== undefined
        ? new DataMerger({
            serverURL: options.dataMerge.serverURL,
            ...(options.dataMerge.apiRoute !== undefined
              ? { apiRoute: options.dataMerge.apiRoute }
              : {}),
            ...(options.dataMerge.depth !== undefined ? { depth: options.dataMerge.depth } : {}),
            ...(options.dataMerge.fetchFn !== undefined
              ? { fetchFn: options.dataMerge.fetchFn }
              : {}),
            log: (...args) => {
              log(...args);
            },
          })
        : null;

    // Bindings inside a hydrated island are the island's business (ADR 0008 §4);
    // the island receives every update as a DOM event instead.
    const cache = new ElementCache({ filter: (element) => !isInsideIsland(element) });
    const observers = new ObserverManager(
      {
        onStructuralChange: () => {
          this.#rebuildCache();
        },
        onVisibilityChange: (element, visible) => {
          if (visible) {
            this.d[RuntimeDependencySlot.Scheduler].notifyVisible(element);
          }
        },
      },
      {
        ...(options.intersectionRootMargin !== undefined
          ? { intersectionRootMargin: options.intersectionRootMargin }
          : {}),
      },
    );
    const scheduler = new UpdateScheduler(
      markNoWriteCallback((update) => this.#applyUpdate(update)),
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
          this.#onFlush(stats);
        },
      },
    );
    const bus = new MessageBus(options.originMatcher, {
      onUpdate: (msg, origin, identity) => {
        this.#handleUpdate(msg, origin, identity);
      },
      onDocumentEvent: () => {
        this.#observe(['document-events']);
        void emitter.emit('documentSave', { timestamp: Date.now() });
      },
      onFocusField: (field) => {
        if (this.d[RuntimeDependencySlot.RevealEditedField]) this.#revealField(field);
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
    // ConnectionState is deliberately callback-free here. Runtime transitions
    // have trust-boundary ordering requirements (notably timeout unlock before
    // disconnect observers), so arbitrary logging callbacks must not run from
    // inside the atomic state mutation.
    const connectionState = new ConnectionState(() => undefined);
    const heartbeat = new HeartbeatTimer({
      ...(options.heartbeatMs !== undefined ? { timeoutMs: options.heartbeatMs } : {}),
      onTimeout: () => {
        this.#onHeartbeatTimeout();
      },
    });

    this.d = [
      emitter,
      cache,
      observers,
      scheduler,
      bus,
      connectionState,
      heartbeat,
      renderers,
      resolveRenderer,
      transformValue,
      root,
      readyTargets,
      sendReady,
      heartbeatTimeoutHook,
      log,
      warn,
      [],
      a11y,
      merger,
      options.scopeBindingsByOwner === true,
      options.lockedOrigin ?? ((): undefined => undefined),
      options.skipUnchanged === true,
      options.dependencies ?? {},
      options.strategies ?? {},
      options.revealEditedField === true,
    ];
    this.l = [
      undefined,
      undefined,
      undefined,
      negotiateProtocol(undefined),
      false,
      null,
      0,
      null,
      new Set<string>(),
      false,
      false,
      0,
      null,
      new Set<string>(),
      new WeakMap<Element, string>(),
      0,
      null,
      0,
      new Set<ProtocolCapability>(),
      null,
      { rendered: 0, failed: 0, superseded: 0 },
      false,
      { refreshes: 0, failed: 0, loopStopped: 0 },
      null,
      new FieldRevealer(),
      new Map<string, string | undefined>(),
    ];
  }

  /**
   * Start the runtime: build cache, attach observers, listen for
   * messages, broadcast `ready`. Returns `true` when startup is accepted
   * (it refuses a second attempt while one is active).
   *
   * When the script executes while the document is still parsing
   * (e.g. injected via `<script>` in `<head>` — Astro's `head-inline`
   * stage), `document.body` does not exist yet and attaching the
   * MutationObserver would throw. In that case the actual startup is
   * deferred until `DOMContentLoaded`; `start()` still returns `true`
   * and `destroy()` cancels the pending startup.
   */
  start(): boolean {
    if (this.l[RuntimeLifecycleSlot.Started]) return false;
    this.l[RuntimeLifecycleSlot.Started] = true;

    const root = this.d[RuntimeDependencySlot.Root];
    if (isDocumentRoot(root) && root.readyState === 'loading') {
      const onReady = (): void => {
        if (!this.l[RuntimeLifecycleSlot.Started]) return;
        this.l[RuntimeLifecycleSlot.DeferredStart] = null;
        try {
          this.#startNow();
        } catch (error) {
          // The original start() has already returned, so a deferred failure
          // cannot be reported to its caller. Roll back every acquired resource
          // and surface the failure through the established runtime error event.
          this.#rollbackFailedStart();
          this.#reportError(error, 'startup', 'LP0605');
        }
      };
      this.l[RuntimeLifecycleSlot.DeferredStart] = onReady;
      try {
        root.addEventListener('DOMContentLoaded', onReady, { once: true });
      } catch (error) {
        this.#rollbackFailedStart();
        throw error;
      }
      return true;
    }

    try {
      this.#startNow();
      return true;
    } catch (error) {
      this.#rollbackFailedStart();
      throw error;
    }
  }

  #startNow(): void {
    if (!this.l[RuntimeLifecycleSlot.Started]) return;
    const observerRoot: Node | null = isDocumentRoot(this.d[RuntimeDependencySlot.Root])
      ? readDocumentBody(this.d[RuntimeDependencySlot.Root])
      : this.d[RuntimeDependencySlot.Root];
    if (observerRoot === null) {
      throw new Error('LivePreviewRuntime: document.body unavailable');
    }
    this.d[RuntimeDependencySlot.Observers].start(observerRoot);
    this.#observedRoot = observerRoot;
    this.#watchRootReplacement();
    // The observer must exist before the cache scan registers its elements;
    // otherwise initial bindings can be deferred but never become replayable.
    this.#buildCacheAndObserve();
    if (!this.#isRunning()) return;
    this.d[RuntimeDependencySlot.Bus].attach();
    void this.d[RuntimeDependencySlot.Emitter].emitWhile(
      'init',
      { timestamp: Date.now() },
      () => this.l[RuntimeLifecycleSlot.Started],
    );
    if (!this.#isRunning()) return;

    // Re-broadcast ready several times to absorb parent-side init latency.
    for (const delay of READY_RETRY_DELAYS_MS) {
      if (!this.#isRunning()) return;
      if (delay === 0) {
        this.d[RuntimeDependencySlot.SendReady](this.d[RuntimeDependencySlot.ReadyTargets]);
        if (!this.#isRunning()) return;
      } else {
        const handle = setTimeout(() => {
          if (!this.l[RuntimeLifecycleSlot.Started]) return;
          this.#sendReadyAfterStart();
        }, delay);
        this.d[RuntimeDependencySlot.ReadyTimers].push(handle);
      }
    }
  }

  /** Tear down all observers, timers, and listeners. Idempotent. */
  /**
   * Release the message ingress without tearing the instance down.
   *
   * A back/forward-cache restore never re-runs module scripts, so a runtime
   * that keeps its listener across `pagehide` comes back attached to a page the
   * browser froze and thawed: observers bound to nodes that were never
   * re-created, a heartbeat that measured the frozen interval, and pending
   * writes from before the freeze. It does not fail — it goes quiet, which is
   * the hardest symptom to attribute.
   *
   * Unlike `destroy()` this keeps everything the consumer configured: plugins,
   * renderers, transforms and the accessibility announcer all survive, and
   * `start()` brings the same instance back. `DataMerger` and `UpdateScheduler`
   * are reusable across a stop/start cycle by design, which is what makes this
   * a suspension rather than a rebuild.
   *
   * Emits `disconnect` with the existing `'unload'` reason, which the public
   * union has always carried for exactly this producer and nothing has emitted
   * until now.
   */
  suspend(): boolean {
    if (!this.l[RuntimeLifecycleSlot.Started]) return false;
    const wasConnected = this.#releaseRuntimeResources();
    if (wasConnected) {
      void this.d[RuntimeDependencySlot.Emitter].emit('disconnect', {
        reason: 'unload',
        timestamp: Date.now(),
      });
    }
    return true;
  }

  destroy(): void {
    if (!this.l[RuntimeLifecycleSlot.Started]) return;
    const wasConnected = this.#releaseRuntimeResources();
    if (wasConnected) {
      void this.d[RuntimeDependencySlot.Emitter].emit('disconnect', {
        reason: 'destroy',
        timestamp: Date.now(),
      });
    }
    this.d[RuntimeDependencySlot.A11y]?.detach();
    void this.d[RuntimeDependencySlot.Emitter].emit('destroy', {
      timestamp: Date.now(),
    });
  }

  /**
   * Invalidate first, then release every resource that startup may have acquired.
   * The same transaction boundary serves ordinary destroy and failed-start
   * rollback, preventing a partial observer/bus/timer/cache lifecycle.
   */
  #releaseRuntimeResources(): boolean {
    this.l[RuntimeLifecycleSlot.ActiveUpdate] = null;
    this.l[RuntimeLifecycleSlot.Started] = false;

    const deferredStart = this.l[RuntimeLifecycleSlot.DeferredStart];
    this.l[RuntimeLifecycleSlot.DeferredStart] = null;
    if (deferredStart !== null && isDocumentRoot(this.d[RuntimeDependencySlot.Root])) {
      this.#runCleanup(() => {
        this.d[RuntimeDependencySlot.Root].removeEventListener('DOMContentLoaded', deferredStart);
      });
    }

    for (const handle of this.d[RuntimeDependencySlot.ReadyTimers]) {
      this.#runCleanup(() => {
        clearTimeout(handle);
      });
    }
    this.d[RuntimeDependencySlot.ReadyTimers].length = 0;
    this.#runCleanup(() => {
      this.d[RuntimeDependencySlot.Heartbeat].stop();
    });
    this.#runCleanup(() => {
      this.d[RuntimeDependencySlot.Bus].detach();
    });
    this.#abortFragments();
    this.#runCleanup(() => {
      this.#rootSentinel?.disconnect();
      this.#rootSentinel = null;
      this.#observedRoot = null;
    });
    this.#runCleanup(() => {
      this.d[RuntimeDependencySlot.Observers].stop();
    });
    this.#runCleanup(() => {
      this.d[RuntimeDependencySlot.Scheduler].destroy();
    });
    this.#runCleanup(() => {
      this.d[RuntimeDependencySlot.Merger]?.destroy();
    });
    this.d[RuntimeDependencySlot.Cache].clear();
    return this.d[RuntimeDependencySlot.ConnectionState].markDisconnected();
  }

  #rollbackFailedStart(): void {
    this.#releaseRuntimeResources();
    this.#runCleanup(() => {
      this.d[RuntimeDependencySlot.A11y]?.detach();
    });
  }

  #runCleanup(cleanup: () => void): void {
    try {
      cleanup();
    } catch (error) {
      this.d[RuntimeDependencySlot.Log]('cleanup failed:', error);
    }
  }

  /** Re-scan the DOM and re-register every binding. */
  refreshCache(): void {
    if (!this.l[RuntimeLifecycleSlot.Started]) return;
    this.#followReplacedRoot();
    this.#rebuildCache();
  }

  /**
   * A framework that swaps `document.body` (some routers do on navigation)
   * leaves a MutationObserver bound to a detached node: no error, no updates.
   * The sentinel watches `<html>` for that swap and rebinds observers and
   * cache to the new body — the F-36 remainder.
   */
  #watchRootReplacement(): void {
    const root = this.d[RuntimeDependencySlot.Root];
    if (!isDocumentRoot(root) || typeof MutationObserver === 'undefined') return;
    const html = root.documentElement;
    this.#rootSentinel?.disconnect();
    this.#rootSentinel = new MutationObserver(() => {
      this.#followReplacedRoot();
    });
    this.#rootSentinel.observe(html, { childList: true });
  }

  /** Rebind observers and cache when the observed body is no longer the document's body. */
  #followReplacedRoot(): void {
    const root = this.d[RuntimeDependencySlot.Root];
    if (!this.#isRunning() || !isDocumentRoot(root)) return;
    const body = readDocumentBody(root);
    if (body === null || body === this.#observedRoot) return;
    this.#observedRoot = body;
    this.d[RuntimeDependencySlot.Observers].start(body);
    this.#rebuildCache();
  }

  /** Current connection status, exposed for the high-level client. */
  get status(): 'disconnected' | 'connecting' | 'connected' {
    return this.d[RuntimeDependencySlot.ConnectionState].status;
  }

  /** Read-only view of the element cache. */
  get cache(): ElementCache {
    return this.d[RuntimeDependencySlot.Cache];
  }

  /** Read-only view of how many updates have been received. */
  get updateCount(): number {
    return this.l[RuntimeLifecycleSlot.UpdateCount];
  }

  /**
   * Negotiated protocol view — `min(library, remote)`. Useful for
   * consumers that want to branch on protocol capabilities without
   * hard-coding version numbers. Updates lazily as the remote party's
   * version arrives on incoming messages.
   */
  get protocol(): ProtocolNegotiation {
    return this.l[RuntimeLifecycleSlot.ProtocolNegotiation];
  }

  /**
   * Point-in-time read of runtime state for diagnosing a preview that is not
   * updating. Performs no I/O and sends nothing anywhere; see
   * `@core/inspection` for why this is not gated to development builds.
   *
   * Assembled inline rather than delegated to a helper because the inline
   * runtime pays for every byte of indirection, and because the values live
   * in private state no helper could reach without being handed all of it.
   */
  inspect(): LivePreviewInspection {
    const cache = this.d[RuntimeDependencySlot.Cache];
    const scheduler = this.d[RuntimeDependencySlot.Scheduler];
    const negotiation = this.l[RuntimeLifecycleSlot.ProtocolNegotiation];
    const active = this.l[RuntimeLifecycleSlot.ActiveUpdate];
    const flush = this.l[RuntimeLifecycleSlot.LastFlush];
    const fieldNames: string[] = [];
    const owners = new Set<string>();
    for (const [fieldName, bindings] of cache.entries()) {
      fieldNames.push(fieldName);
      for (const binding of bindings) {
        if (binding.owner !== undefined) owners.add(binding.owner);
      }
    }
    return {
      version: VERSION,
      started: this.l[RuntimeLifecycleSlot.Started],
      status: this.d[RuntimeDependencySlot.ConnectionState].status,
      origins: {
        trusted: [...this.d[RuntimeDependencySlot.ReadyTargets]],
        locked: this.d[RuntimeDependencySlot.LockedOrigin](),
      },
      protocol: {
        ours: negotiation.ours,
        theirs: negotiation.theirs,
        negotiated: negotiation.negotiated,
        capabilities: [...negotiation.capabilities].sort(),
        observed: [...negotiation.observed].sort(),
        profile: detectProtocolProfile(negotiation.observed).name,
      },
      revisions: {
        accepted: this.l[RuntimeLifecycleSlot.UpdateCount],
        superseded: this.l[RuntimeLifecycleSlot.SupersededCount],
        completed: this.l[RuntimeLifecycleSlot.CompletedCount],
        skippedUnchanged: this.l[RuntimeLifecycleSlot.SkippedUnchangedCount],
        active: active === null ? undefined : active.identity.revision,
      },
      bindings: {
        elements: cache.elementCount,
        fields: cache.fieldCount,
        fieldNames: fieldNames.sort(),
        absentFields: [...this.l[RuntimeLifecycleSlot.AbsentFields]].sort(),
        orphanFields: [...this.l[RuntimeLifecycleSlot.WarnedOrphanFields]].sort(),
        ownerScoped: this.d[RuntimeDependencySlot.ScopeBindingsByOwner],
        owners: [...owners].sort(),
      },
      route: {
        handler: this.d[RuntimeDependencySlot.Strategies].route !== undefined,
        ...this.l[RuntimeLifecycleSlot.RouteStats],
      },
      fragments: {
        handler: this.d[RuntimeDependencySlot.Strategies].fragment !== undefined,
        inFlight: this.l[RuntimeLifecycleSlot.ActiveUpdate]?.pendingFragments ?? 0,
        ...this.l[RuntimeLifecycleSlot.FragmentStats],
      },
      scheduler: {
        pending: scheduler.pendingCount,
        deferred: scheduler.replayCount,
        visibilityGateThreshold: scheduler.gateThreshold,
        visibilityGateActive: scheduler.gateActive,
        lastFlush:
          flush === null
            ? undefined
            : {
                applied: flush.applied,
                appliedFields: flush.appliedFields,
                deferred: flush.deferred,
                durationMs: flush.durationMs,
              },
      },
      plugins: [],
      renderers: Object.keys(this.d[RuntimeDependencySlot.Renderers]).sort(),
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────────

  #buildCacheAndObserve(): void {
    if (!this.l[RuntimeLifecycleSlot.Started]) return;
    const stats = this.d[RuntimeDependencySlot.Cache].buildFromRoot(
      this.d[RuntimeDependencySlot.Root],
    );
    this.d[RuntimeDependencySlot.Log]('cache', stats);
    if (!this.#isRunning()) return;
    void this.d[RuntimeDependencySlot.Emitter].emitWhile(
      'cacheRefresh',
      stats,
      () => this.l[RuntimeLifecycleSlot.Started],
    );
    if (!this.#isRunning()) return;
    for (const entry of this.d[RuntimeDependencySlot.Cache].values()) {
      if (!this.#isRunning()) return;
      this.d[RuntimeDependencySlot.Observers].observeElement(entry.element);
    }
  }

  #rebuildCache(): void {
    if (!this.l[RuntimeLifecycleSlot.Started]) return;
    const previousBindings = new Map<Element, CachedElement>();
    for (const entry of this.d[RuntimeDependencySlot.Cache].values()) {
      previousBindings.set(entry.element, entry);
      this.d[RuntimeDependencySlot.Observers].unobserveElement(entry.element);
    }
    this.#buildCacheAndObserve();
    if (!this.#isRunning()) return;

    // Rebuilding replaces every CachedElement snapshot. Buffered work may
    // survive only while the same DOM element is still bound to the same
    // field; retarget it so later flush/replay observes the rebuilt metadata.
    // Removed or rebound elements must never receive their former field's data.
    for (const entry of this.d[RuntimeDependencySlot.Cache].values()) {
      const previous = previousBindings.get(entry.element);
      if (previous?.fieldName === entry.fieldName) {
        this.d[RuntimeDependencySlot.Scheduler].retarget(entry);
      } else this.d[RuntimeDependencySlot.Scheduler].forget(entry.element);
      previousBindings.delete(entry.element);
    }
    for (const removed of previousBindings.values()) {
      this.d[RuntimeDependencySlot.Scheduler].forget(removed.element);
    }
  }

  /**
   * Record capabilities a message demonstrated and renegotiate when one is
   * new. The stock admin announces no version, so this is how its
   * capabilities become known; a version-granted capability is unaffected.
   */
  #observe(capabilities: readonly ProtocolCapability[]): void {
    const observed = this.l[RuntimeLifecycleSlot.ObservedCapabilities];
    const fresh = capabilities.filter((capability) => !observed.has(capability));
    if (fresh.length === 0) return;
    for (const capability of fresh) observed.add(capability);
    const current = this.l[RuntimeLifecycleSlot.ProtocolNegotiation];
    this.l[RuntimeLifecycleSlot.ProtocolNegotiation] = negotiateProtocol(current.theirs, observed);
    this.d[RuntimeDependencySlot.Log]('protocol', `observed=${fresh.join(',')}`);
  }

  #applyNegotiation(remoteVersion: number): void {
    const current = this.l[RuntimeLifecycleSlot.ProtocolNegotiation];
    // Every data message repeats the version, so the common case is that
    // nothing changed and there is nothing to record or say.
    if (current.theirs === remoteVersion) return;
    const next = negotiateProtocol(
      remoteVersion,
      this.l[RuntimeLifecycleSlot.ObservedCapabilities],
    );
    this.l[RuntimeLifecycleSlot.ProtocolNegotiation] = next;
    // Record the announcement even when it does not move the negotiated
    // version — `theirs` is public, and comparing only `negotiated` left a
    // remote announcing version 1 indistinguishable from one that never
    // announced at all. Log only a real negotiation change.
    if (next.negotiated === current.negotiated) return;
    this.d[RuntimeDependencySlot.Log](
      'protocol',
      `ours=${LIBRARY_PROTOCOL_VERSION}`,
      `theirs=${remoteVersion}`,
      `negotiated=${next.negotiated}`,
    );
  }

  /* eslint-disable @typescript-eslint/no-unnecessary-condition -- Each explicit
   * transaction check follows an arbitrary consumer/DOM callback that can
   * synchronously replace the active-update slot or destroy the runtime. TypeScript's
   * local control-flow narrowing cannot observe that re-entrancy. */
  #handleUpdate(
    message: PayloadLivePreviewMessage,
    origin: string,
    identity: MessageRevision | undefined,
  ): void {
    this.d[RuntimeDependencySlot.Heartbeat].kick();
    this.#observe(observeCapabilities(message));
    if (message.data === undefined) {
      if (message.protocolVersion !== undefined) {
        this.#applyNegotiation(message.protocolVersion);
      }
      return;
    }
    // MessageBus supplies an identity for every shape-valid data update.
    // Refuse identity-less work defensively so no alternate host path can
    // bypass the revision model.
    if (identity === undefined) return;
    const relationship = message.externallyUpdatedRelationship;
    const relationshipEdited = typeof relationship === 'object' && relationship !== null;
    if (relationshipEdited) {
      void this.d[RuntimeDependencySlot.Emitter].emit('relationshipUpdate', {
        detail: relationship,
        timestamp: Date.now(),
      });
    }
    if (typeof message.locale === 'string') {
      this.l[RuntimeLifecycleSlot.CurrentLocale] = message.locale;
    }
    if (Array.isArray(message.fieldSchemaJSON)) {
      this.l[RuntimeLifecycleSlot.CurrentSchema] = message.fieldSchemaJSON;
      this.l[RuntimeLifecycleSlot.SchemaIndex] = buildSchemaIndex(message.fieldSchemaJSON);
    }

    const transaction: UpdateTransaction = {
      identity,
      message,
      locale: this.l[RuntimeLifecycleSlot.CurrentLocale],
      schema: this.l[RuntimeLifecycleSlot.CurrentSchema],
      schemaIndex: this.l[RuntimeLifecycleSlot.SchemaIndex],
      receivedAt: Date.now(),
      forceRender: relationshipEdited,
      pendingFragments: 0,
      routeRefreshed: false,
      cancelled: false,
      completed: false,
    };

    // Acceptance is the single supersession point. It clears old pending and
    // replay work even if this revision is later cancelled or has no bindings.
    // Only a transaction that never reached its terminal state was abandoned;
    // one whose writes already landed simply finished, and counting it would
    // make `superseded` track `accepted` on every fast keystroke.
    const previous = this.l[RuntimeLifecycleSlot.ActiveUpdate];
    this.#abortFragments();
    if (previous !== null && !previous.completed) {
      this.l[RuntimeLifecycleSlot.SupersededCount] += 1;
    }
    this.l[RuntimeLifecycleSlot.ActiveUpdate] = transaction;
    this.d[RuntimeDependencySlot.Scheduler].acceptRevision(identity);
    this.l[RuntimeLifecycleSlot.UpdateCount] += 1;

    // User-provided log and event handlers are reentrant. They may dispatch a
    // newer update synchronously, so the transaction must already be accepted
    // and every continuation below must re-check its identity.
    if (message.protocolVersion !== undefined) {
      this.#applyNegotiation(message.protocolVersion);
      if (!(
        this.l[RuntimeLifecycleSlot.Started] &&
        this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
      )) {
        return;
      }
    }
    if (this.d[RuntimeDependencySlot.ConnectionState].markConnected()) {
      this.d[RuntimeDependencySlot.A11y]?.announceConnected();
      void this.d[RuntimeDependencySlot.Emitter].emit('connect', {
        origin,
        timestamp: Date.now(),
      });
      if (!(
        this.l[RuntimeLifecycleSlot.Started] &&
        this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
      )) {
        return;
      }
      this.d[RuntimeDependencySlot.Log]('connection', 'disconnected', '→', 'connected');
      if (!(
        this.l[RuntimeLifecycleSlot.Started] &&
        this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
      )) {
        return;
      }
    }
    void this.#processUpdate(transaction);
  }

  async #processUpdate(transaction: UpdateTransaction): Promise<void> {
    const fields = await this.#resolveIncomingFields(transaction);
    if (
      fields === null ||
      !(
        this.l[RuntimeLifecycleSlot.Started] &&
        this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
      )
    ) {
      return;
    }

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

    if (this.d[RuntimeDependencySlot.Emitter].listenerCount('beforeUpdate') > 0) {
      const completed = await this.d[RuntimeDependencySlot.Emitter].emitWhile(
        'beforeUpdate',
        {
          data,
          revision: transaction.identity.revision,
          receivedAt: transaction.receivedAt,
          source: 'patch',
          cancel: (): void => {
            transaction.cancelled = true;
            this.d[RuntimeDependencySlot.Scheduler].cancelRevision(transaction.identity);
          },
        },
        () =>
          !transaction.cancelled &&
          this.l[RuntimeLifecycleSlot.Started] &&
          this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction,
      );
      if (
        !completed ||
        transaction.cancelled ||
        !(
          this.l[RuntimeLifecycleSlot.Started] &&
          this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
        )
      ) {
        return;
      }
    }
    if (!(
      this.l[RuntimeLifecycleSlot.Started] &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
    )) {
      return;
    }
    this.#scheduleAllFields(transaction, data);
  }

  /**
   * Resolve the field values to render for an incoming update. With a
   * configured `DataMerger` the raw form values are exchanged for the
   * server-populated document; without one (or on failure) the raw
   * values pass through unchanged. Returns `null` when a newer update
   * superseded this one mid-flight.
   */
  async #resolveIncomingFields(
    transaction: UpdateTransaction,
  ): Promise<Record<string, unknown> | null> {
    const { message } = transaction;
    // #handleUpdate has already returned when `data` is undefined.
    const raw = message.data ?? {};
    if (this.d[RuntimeDependencySlot.Merger] === null) return raw;
    // A Payload 2.x admin posts populated relationships itself; asking the
    // REST API again would only replace them with a depth-limited copy.
    const profile = detectProtocolProfile(this.l[RuntimeLifecycleSlot.ObservedCapabilities]);
    if (profile.populatesRelationships === 'admin') return raw;
    const result = await this.d[RuntimeDependencySlot.Merger].merge({
      collectionSlug: message.collectionSlug,
      globalSlug: message.globalSlug,
      data: raw,
      locale: transaction.locale,
    });
    if (!(
      this.l[RuntimeLifecycleSlot.Started] &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
    )) {
      return null;
    }
    if (result.status === 'merged') return result.doc;
    if (result.status === 'superseded') return null;
    return raw;
  }

  #scheduleAllFields(transaction: UpdateTransaction, data: PayloadLivePreviewData): void {
    if (!(
      this.l[RuntimeLifecycleSlot.Started] &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
    )) {
      return;
    }
    const isCurrent = (): boolean =>
      this.l[RuntimeLifecycleSlot.Started] &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction;
    const ownerKeys = this.#ownerKeysForUpdate(transaction, data.fields);
    let scheduled = 0;
    // `#invalidatedDependents` advances per-update state, so compute it once
    // and share it with the field loop below.
    const invalidatedSet = this.#invalidatedDependents(data.fields);
    // The fields this update touches, plus what the dependency registry says
    // they invalidate, so a boundary depending on a derived field re-renders.
    const touched = new Set([...Object.keys(data.fields), ...invalidatedSet]);
    // A revision that touches the route refreshes it first; patches and
    // fragments are applied once, on the fresh markup, by the re-apply.
    const route = this.d[RuntimeDependencySlot.Strategies].route;
    if (
      route !== undefined &&
      !transaction.routeRefreshed &&
      (route.plan(this.d[RuntimeDependencySlot.Root], touched) || this.#hasRouteBinding(touched))
    ) {
      void this.#refreshRoute(transaction, data, route);
      return;
    }
    const plan = this.#planFragments(touched);
    // Computed once per update and only when skipping is on: the fields whose
    // change forces dependents to re-apply this time round.
    const invalidated = (): ReadonlySet<string> => invalidatedSet;
    for (const [fieldName, bindings] of this.d[RuntimeDependencySlot.Cache].entries()) {
      if (!(
        this.l[RuntimeLifecycleSlot.Started] &&
        this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
      )) {
        return;
      }
      for (const target of bindings) {
        if (ownerKeys !== false && !isBindingInScope(target.owner, ownerKeys)) continue;
        // A binding inside a boundary the server will render is the
        // boundary's business; it is patched only as the fallback.
        if (plan?.covers(target.element) === true) continue;
        const resolved = resolveStrategy(target.element);
        if (resolved === undefined) {
          this.#warnUnsupportedStrategy(target);
          continue;
        }
        if (resolved === 'fragment' && plan === null) this.#warnFragmentFallback(target);
        const value = resolveFieldValue(
          data.fields,
          fieldName,
          target.locale ?? transaction.locale,
          target.locale !== undefined,
        );
        if (value === undefined) {
          // Ein gebundenes Feld, fuer das die Nachricht keinen Wert traegt,
          // wird hier uebersprungen. Das ist der Gegenfall zu orphanFields (ein
          // Wert ohne Anker) und war von aussen unsichtbar: die Bindung bleibt
          // auf ihrem alten Text stehen, ohne jede Spur.
          this.l[RuntimeLifecycleSlot.AbsentFields].add(fieldName);
          continue;
        }
        // Transforms are arbitrary plugin code and may synchronously dispatch a
        // newer message. Stop the obsolete revision at that callback boundary
        // before invoking another transform or scheduling any of its result.
        if (!(
          this.l[RuntimeLifecycleSlot.Started] &&
          this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
        )) {
          return;
        }
        const transformedValue = this.#transformForBinding(target, value, data.fields, isCurrent);
        if (!(
          this.l[RuntimeLifecycleSlot.Started] &&
          this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
        )) {
          return;
        }
        if (
          !transaction.forceRender &&
          this.#isUnchangedForElement(target, fieldName, transformedValue, invalidated())
        ) {
          this.l[RuntimeLifecycleSlot.SkippedUnchangedCount] += 1;
          continue;
        }
        const update: ScheduledUpdate = {
          target,
          value: transformedValue,
          allFields: data.fields,
          identity: transaction.identity,
          data,
        };
        if (!(
          this.l[RuntimeLifecycleSlot.Started] &&
          this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
        )) {
          return;
        }
        this.d[RuntimeDependencySlot.Scheduler].schedule(update);
        scheduled += 1;
      }
    }
    this.#diagnoseOrphanFields(data.fields, transaction.locale, ownerKeys);
    if (plan !== null && plan.boundaries.length > 0) {
      transaction.pendingFragments = plan.boundaries.length;
      void this.#runFragments(transaction, data, plan.boundaries, plan.strategy);
    }
    // Nothing to flush — every field unbound, out of scope, or unchanged — is
    // still this update reaching its end. Without the mark here the next
    // message would count a finished update as abandoned.
    if (scheduled === 0 && transaction.pendingFragments === 0 && !transaction.completed) {
      transaction.completed = true;
      this.l[RuntimeLifecycleSlot.CompletedCount] += 1;
    }
  }

  /**
   * Whether `value` is what this element last applied and nothing forces a
   * re-apply. Never true with `skipUnchanged` off, for a fresh element, for a
   * value without an identity, or for a dependent of a field that changed.
   */
  #isUnchangedForElement(
    target: CachedElement,
    fieldName: string,
    value: unknown,
    invalidated: ReadonlySet<string>,
  ): boolean {
    if (!this.d[RuntimeDependencySlot.SkipUnchanged]) return false;
    if (invalidated.has(fieldName)) return false;
    const identity = valueIdentity(value);
    if (identity === undefined) return false;
    return this.l[RuntimeLifecycleSlot.LastAppliedIdentity].get(target.element) === identity;
  }

  /**
   * Dependents of every top-level field whose identity differs from the
   * previous update's. The previous snapshot is replaced here, so the
   * comparison is always against the last message, not the last applied one:
   * a dependent must re-apply when its source *changed*, whether or not that
   * source has a binding of its own.
   */
  #invalidatedDependents(fields: Record<string, unknown>): ReadonlySet<string> {
    // The option map plus what the markup declares with `data-payload-depends`.
    const dependencies = mergeDependencyMaps(
      this.d[RuntimeDependencySlot.Dependencies],
      this.d[RuntimeDependencySlot.Cache].dependencyMap(),
    );
    const previous = this.l[RuntimeLifecycleSlot.PreviousFieldIdentity];
    const next = new Map<string, string | undefined>();
    const invalidated = new Set<string>();
    // Entries, not keys: indexing a Record by its own key still types as
    // possibly undefined, and the `?? []` that needed was a branch nothing
    // could reach — the mutation baseline reported it as uncovered.
    for (const [source, dependents] of Object.entries(dependencies)) {
      const identity = valueIdentity(fields[source]);
      next.set(source, identity);
      const changed =
        previous === null || identity === undefined || previous.get(source) !== identity;
      if (!changed) continue;
      for (const dependent of dependents) invalidated.add(dependent);
    }
    this.l[RuntimeLifecycleSlot.PreviousFieldIdentity] = next;
    return invalidated;
  }

  /**
   * Owner keys this update may address, or `false` when scoping is disabled.
   *
   * `false` and `null` are deliberately different: the first means "ownership
   * is not in play, match on field name as 1.x always has", the second means
   * "scoping is active but this message names no document", which is
   * fail-closed. Warned once, because a silent no-op is the hardest possible
   * symptom to diagnose.
   */
  /** LP0407, once per element: a strategy this release does not have is left alone, not guessed at. */
  /** The boundaries the fragment strategy owns for this update, or `null` without one. */
  #planFragments(touched: ReadonlySet<string>): {
    readonly boundaries: readonly Element[];
    readonly covers: (element: Element) => boolean;
    readonly strategy: FragmentStrategy;
  } | null {
    const strategy = this.d[RuntimeDependencySlot.Strategies].fragment;
    if (strategy === undefined) return null;
    const boundaries = strategy.plan(this.d[RuntimeDependencySlot.Root], touched);
    const covered = new Set(boundaries);
    return {
      boundaries,
      strategy,
      covers: (element) => {
        const boundary = enclosingFragment(element);
        return boundary !== null && covered.has(boundary);
      },
    };
  }

  /**
   * Hand the planned boundaries to the strategy with the capabilities it may
   * use. A newer revision aborts the signal; the strategy reports what it
   * rendered, failed (and patched) or dropped as superseded.
   */
  async #runFragments(
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    boundaries: readonly Element[],
    strategy: FragmentStrategy,
  ): Promise<void> {
    const controller = new AbortController();
    this.l[RuntimeLifecycleSlot.FragmentController] = controller;
    const { message } = transaction;
    const isCurrent = (): boolean =>
      this.l[RuntimeLifecycleSlot.Started] &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction &&
      !controller.signal.aborted;
    const emitter = this.d[RuntimeDependencySlot.Emitter];
    const revision = transaction.identity.revision;
    const receivedAt = transaction.receivedAt;
    const context: FragmentContext = {
      root: this.d[RuntimeDependencySlot.Root],
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
        this.d[RuntimeDependencySlot.Log]('fragment', code, detail);
      },
      morph: (boundary, html) => {
        this.#morphFragment(boundary, html);
      },
      patch: (boundary) => {
        this.#patchFragmentFallback(transaction, data, boundary);
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
    const report = await strategy.render(context, boundaries);
    const stats = this.l[RuntimeLifecycleSlot.FragmentStats];
    stats.rendered += report.rendered;
    stats.failed += report.failed;
    stats.superseded += report.superseded;
    if (!isCurrent()) return;
    if (this.l[RuntimeLifecycleSlot.FragmentController] === controller) {
      this.l[RuntimeLifecycleSlot.FragmentController] = null;
    }
    transaction.pendingFragments = 0;
    if (!transaction.completed && this.d[RuntimeDependencySlot.Scheduler].pendingCount === 0) {
      transaction.completed = true;
      this.l[RuntimeLifecycleSlot.CompletedCount] += 1;
    }
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

  /** Whether a touched field is bound to an element the resolver assigns to the route. */
  #hasRouteBinding(touched: ReadonlySet<string>): boolean {
    for (const [fieldName, bindings] of this.d[RuntimeDependencySlot.Cache].entries()) {
      if (!touched.has(fieldName)) continue;
      if (bindings.some((target) => resolveStrategy(target.element) === 'route')) return true;
    }
    return false;
  }

  /**
   * Refresh the whole route for this revision, then rescan and re-apply the
   * revision so the unsaved state lands on the fresh markup. One refresh per
   * revision: a second request is LP0805 and is refused.
   */
  async #refreshRoute(
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    strategy: RouteStrategy,
  ): Promise<void> {
    const stats = this.l[RuntimeLifecycleSlot.RouteStats];
    if (transaction.routeRefreshed) {
      stats.loopStopped += 1;
      this.d[RuntimeDependencySlot.Log](
        'route',
        'LP0805',
        `revision ${String(transaction.identity.revision)} asked for a second route refresh`,
      );
      return;
    }
    transaction.routeRefreshed = true;
    const controller = new AbortController();
    this.l[RuntimeLifecycleSlot.RouteController] = controller;
    const isCurrent = (): boolean =>
      this.l[RuntimeLifecycleSlot.Started] &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction &&
      !controller.signal.aborted;
    const outcome = await strategy.refresh({
      revision: transaction.identity.revision,
      receivedAt: transaction.receivedAt,
      signal: controller.signal,
      isCurrent,
      log: (code, detail) => {
        this.d[RuntimeDependencySlot.Log]('route', code, detail);
      },
    });
    if (!isCurrent()) return;
    if (outcome === 'refreshed') {
      stats.refreshes += 1;
      this.#rebuildCache();
      if (!isCurrent()) return;
      // Re-apply this revision onto the fresh markup: the route was rendered
      // from the saved document, the editor's unsaved state goes back on top.
      this.#scheduleAllFields(transaction, data);
      if (this.d[RuntimeDependencySlot.Emitter].listenerCount('afterUpdate') > 0) {
        void this.d[RuntimeDependencySlot.Emitter].emitWhile(
          'afterUpdate',
          {
            data,
            updatedCount: 1,
            durationMs: Date.now() - transaction.receivedAt,
            revision: transaction.identity.revision,
            receivedAt: transaction.receivedAt,
            source: 'route',
          },
          isCurrent,
        );
      }
      return;
    }
    if (outcome === 'failed') stats.failed += 1;
    // Fall back to patching the route-bound elements from the same revision.
    this.#scheduleAllFields(transaction, data);
  }

  /** Morph server-rendered HTML into the boundary, keeping focus and visitor state. */
  #morphFragment(boundary: Element, html: string): void {
    const template = boundary.ownerDocument.createElement('template');
    template.innerHTML = trustedHtml(html);
    const rendered = boundary.cloneNode(false) as Element;
    rendered.append(template.content);
    morphElement(boundary, rendered, { keyAttributes: [MORPH_KEY_ATTRIBUTE] });
  }

  /** The deterministic fallback: patch the boundary's own bindings from the same revision. */
  #patchFragmentFallback(
    transaction: UpdateTransaction,
    data: PayloadLivePreviewData,
    boundary: Element,
  ): void {
    for (const [fieldName, bindings] of this.d[RuntimeDependencySlot.Cache].entries()) {
      for (const target of bindings) {
        if (enclosingFragment(target.element) !== boundary) continue;
        const value = resolveFieldValue(
          data.fields,
          fieldName,
          target.locale ?? transaction.locale,
          target.locale !== undefined,
        );
        if (value === undefined) continue;
        this.d[RuntimeDependencySlot.Scheduler].schedule({
          target,
          value: this.#transformForBinding(target, value, data.fields, () => true),
          allFields: data.fields,
          identity: transaction.identity,
          data,
        });
      }
    }
  }

  /** A newer revision (or stop) aborts the previous one's fragments and route refresh alike. */
  #abortFragments(): void {
    for (const slot of [
      RuntimeLifecycleSlot.FragmentController,
      RuntimeLifecycleSlot.RouteController,
    ] as const) {
      const controller = this.l[slot];
      if (controller === null) continue;
      this.l[slot] = null;
      controller.abort();
    }
  }

  /** LP0806, once: a fragment boundary with no handler is patched instead. */
  #warnFragmentFallback(target: CachedElement): void {
    if (this.l[RuntimeLifecycleSlot.WarnedFragmentFallback]) return;
    this.l[RuntimeLifecycleSlot.WarnedFragmentFallback] = true;
    this.d[RuntimeDependencySlot.Warn](
      `[live-preview] LP0806: "${target.fieldName}" asks for the fragment strategy, but no fragment handler is configured; ` +
        'the boundary is patched instead. Configure `fragments` (payload-live-preview/fragment) to render it on the server.',
    );
  }

  #warnUnsupportedStrategy(target: CachedElement): void {
    if (this.#warnedStrategy.has(target.element)) return;
    this.#warnedStrategy.add(target.element);
    this.d[RuntimeDependencySlot.Warn](
      `[live-preview] LP0407: "${target.fieldName}" asks for strategy "${String(target.strategy)}"; ` +
        'only "patch", "fragment" and "route" exist, so the element is left unchanged.',
    );
  }

  #ownerKeysForUpdate(
    transaction: UpdateTransaction,
    fields: Record<string, unknown>,
  ): readonly string[] | null | false {
    if (!this.d[RuntimeDependencySlot.ScopeBindingsByOwner]) return false;
    const { message } = transaction;
    const keys = messageOwnerKeys({
      globalSlug: typeof message.globalSlug === 'string' ? message.globalSlug : undefined,
      collectionSlug:
        typeof message.collectionSlug === 'string' ? message.collectionSlug : undefined,
      documentId: readDocumentId(fields),
    });
    if (keys === null && !this.l[RuntimeLifecycleSlot.WarnedUnattributableMessage]) {
      this.l[RuntimeLifecycleSlot.WarnedUnattributableMessage] = true;
      this.d[RuntimeDependencySlot.Warn](
        '[live-preview] LP0202: scopeBindingsByOwner: update names no document; nothing applied',
      );
    }
    return keys;
  }

  /** Whether this document owns any binding currently on the page. */
  #ownsAnyBinding(ownerKeys: readonly string[] | null): boolean {
    for (const binding of this.d[RuntimeDependencySlot.Cache].values()) {
      if (isBindingInScope(binding.owner, ownerKeys)) return true;
    }
    return false;
  }

  /** Whether any cached binding for `fieldName` may receive this update. */
  #hasAddressableBinding(fieldName: string, ownerKeys: readonly string[] | null | false): boolean {
    const bindings = this.d[RuntimeDependencySlot.Cache].get(fieldName);
    if (bindings === undefined) return false;
    if (ownerKeys === false) return true;
    return bindings.some((binding) => isBindingInScope(binding.owner, ownerKeys));
  }

  /**
   * Walk the incoming `data` payload and warn (via `this.d[RuntimeDependencySlot.Warn]`) when an
   * editable-looking field arrives for which **no `[data-payload-field]`
   * anchor exists** in the page. This is the most common live-preview
   * footgun: an SSR template renders the binding only when the field is
   * non-empty, so editing a previously-empty field has nowhere to land.
   *
   * The warning remains active independently of verbose debug logging and is
   * gated by:
   *   - per-field deduplication via `#warnedOrphanFields`
   *   - scalar value heuristic (objects/arrays don't get warned)
   *   - a small ignore-list of system fields Payload always ships
   *
   * The method intentionally lives on the runtime — not on the cache —
   * because it depends on the locale and on schema knowledge that the
   * cache does not own.
   */
  #diagnoseOrphanFields(
    fields: Record<string, unknown>,
    locale: string | undefined,
    ownerKeys: readonly string[] | null | false,
  ): void {
    if (this.d[RuntimeDependencySlot.Cache].fieldCount === 0) return;
    // With scoping active, a page that renders none of this document's
    // bindings is the normal case, not a missing anchor. Warning per field
    // there would report the whole document as broken on every keystroke.
    if (ownerKeys !== false && !this.#ownsAnyBinding(ownerKeys)) return;
    let localisedBindingNames: Set<string> | undefined;
    for (const [rawName, value] of Object.entries(fields)) {
      if (this.l[RuntimeLifecycleSlot.WarnedOrphanFields].has(rawName)) continue;
      if (SYSTEM_FIELD_NAMES.has(rawName)) continue;
      if (!isLiveBindableScalar(value)) continue;
      const baseName = stripLocaleSuffix(rawName, locale);
      if (this.#hasAddressableBinding(rawName, ownerKeys)) continue;
      if (baseName !== rawName && this.#hasAddressableBinding(baseName, ownerKeys)) {
        continue;
      }
      // Element-local locales can intentionally consume several suffixed
      // variants of one field while the message's global locale is different.
      // Build this alias set lazily only after the direct/common checks miss.
      if (localisedBindingNames === undefined) {
        localisedBindingNames = new Set<string>();
        for (const [fieldName, bindings] of this.d[RuntimeDependencySlot.Cache].entries()) {
          for (const binding of bindings) {
            if (ownerKeys !== false && !isBindingInScope(binding.owner, ownerKeys)) continue;
            if (binding.locale !== undefined) {
              localisedBindingNames.add(`${fieldName}_${binding.locale}`);
            }
          }
        }
      }
      if (localisedBindingNames.has(rawName)) continue;
      this.l[RuntimeLifecycleSlot.WarnedOrphanFields].add(rawName);
      this.d[RuntimeDependencySlot.Warn](
        `[live-preview] LP0201: update arrived for field "${rawName}" but no ` +
          `<… data-payload-field="${baseName}"> element exists on this page. ` +
          `Render the binding anchor unconditionally in your template so ` +
          `live edits to an initially-empty field have somewhere to land.`,
      );
    }
  }

  /**
   * Freeze the per-binding transformed value into the revision's scheduler
   * entry. Replays therefore cannot observe plugins registered or removed
   * after this revision was prepared.
   */
  #transformForBinding(
    target: CachedElement,
    originalValue: unknown,
    allFields: Record<string, unknown>,
    isCurrent: () => boolean,
  ): unknown {
    if (this.d[RuntimeDependencySlot.TransformValue] === undefined) {
      return originalValue;
    }
    try {
      const transformed = this.d[RuntimeDependencySlot.TransformValue](
        target.fieldName,
        originalValue,
        {
          element: target.element,
          allFields,
        },
        isCurrent,
      );
      const returnedThenable = observeThenableResult(transformed);
      if (!isCurrent()) return originalValue;
      if (returnedThenable) {
        throw new TypeError(
          `Transform for "${target.fieldName}" returned a Promise/thenable; transforms must be synchronous`,
        );
      }
      return transformed;
    } catch (err) {
      if (!isCurrent()) return originalValue;
      const error = err instanceof Error ? err : new Error(String(err));
      void this.d[RuntimeDependencySlot.Emitter].emit('error', {
        error,
        context: 'transform',
        code: 'LP0602',
      });
      return originalValue;
    }
  }

  /** Re-read lifecycle state after an arbitrary reentrant callback. */
  #isRunning(): boolean {
    return this.l[RuntimeLifecycleSlot.Started];
  }

  /**
   * Report the first flush the visibility gate held back.
   *
   * The gate is off until the cache grows past `visibilityGateThreshold`, and
   * from then on an offscreen binding is buffered until it scrolls into view.
   * That is a deliberate trade, but it is also a cliff: a page that grows one
   * binding past the threshold changes its update semantics wholesale, and the
   * symptom — "editing a field below the fold does nothing" — looks exactly
   * like a broken runtime. Nothing else in the pipeline reports it, so a
   * consumer can only discover it by instrumenting this package.
   *
   * Warned once, on the same reasoning as the unattributable-message warning:
   * a silent no-op is the hardest possible symptom to diagnose.
   */
  #warnOnDeferredWrites(stats: FlushStats): void {
    if (stats.deferred === 0) return;
    if (this.l[RuntimeLifecycleSlot.WarnedVisibilityGate]) return;
    this.l[RuntimeLifecycleSlot.WarnedVisibilityGate] = true;
    this.d[RuntimeDependencySlot.Warn](
      `[live-preview] LP0301: visibility gate held ${String(stats.deferred)} offscreen ` +
        'update(s) until scrolled into view; see visibilityGateThreshold.',
    );
  }

  #applyUpdate(update: ScheduledUpdate): boolean {
    const transaction = this.l[RuntimeLifecycleSlot.ActiveUpdate];
    if (
      transaction === null ||
      update.identity === undefined ||
      !sameRevision(transaction.identity, update.identity) ||
      !(
        this.l[RuntimeLifecycleSlot.Started] &&
        this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
      )
    ) {
      return false;
    }
    const schemaEntry =
      transaction.schemaIndex !== undefined
        ? lookupSchema(transaction.schemaIndex, update.target.fieldName)
        : undefined;
    const value = update.value;
    let resolvedType = resolveRuntimeFieldType(update.target, schemaEntry?.type);
    // Payload 3.x sends no field schema, so rich-text fields would fall
    // through to the `text` heuristic and render "[object Object]".
    // A Lexical value is unmistakable — upgrade the renderer on sight.
    if (
      resolvedType === 'text' &&
      update.target.explicitFieldType !== true &&
      looksLikeLexicalRoot(value)
    ) {
      resolvedType = 'richText';
    }
    let renderer: FieldRenderer | undefined;
    try {
      renderer = this.d[RuntimeDependencySlot.ResolveRenderer](resolvedType, update.target);
    } catch (err) {
      if (!(
        this.l[RuntimeLifecycleSlot.Started] &&
        this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
      )) {
        return false;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      void this.d[RuntimeDependencySlot.Emitter].emitWhile(
        'error',
        { error, context: 'renderer', code: 'LP0603' },
        () =>
          this.l[RuntimeLifecycleSlot.Started] &&
          this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction,
      );
      return false;
    }
    // Renderer resolution is plugin code and may synchronously accept a newer
    // message. Never let the obsolete transaction proceed to a DOM write.
    if (!(
      this.l[RuntimeLifecycleSlot.Started] &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
    )) {
      return false;
    }
    // Element snapshots exist solely for `elementUpdate`. The inline runtime
    // normally has no listener for that event, so avoid a needless DOM read
    // and event Promise for every binding on the default hot path. Listener
    // presence is captured before renderer dispatch, alongside the value the
    // event describes; registrations made by that renderer begin with the
    // next element update.
    const emitElementUpdate =
      this.d[RuntimeDependencySlot.Emitter].listenerCount('elementUpdate') > 0;
    const previous = emitElementUpdate ? readElementSnapshot(update.target.element) : undefined;
    // Custom-element DOM accessors can execute application code. Treat the
    // optional snapshot as the same reentrant boundary as renderer lookup and
    // dispatch so a getter-triggered newer revision wins before any DOM write.
    if (!(
      this.l[RuntimeLifecycleSlot.Started] &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
    )) {
      return false;
    }
    const context: RenderContext = {
      allFields: update.allFields,
      locale: update.target.locale ?? transaction.locale,
      schema: schemaEntry,
      ...(this.#renderRichText !== undefined ? { renderRichText: this.#renderRichText } : {}),
    };
    // A boundary anchor is out of layout and out of the accessibility tree
    // while its field is empty, and appears the moment the editor fills it.
    if (update.target.boundary === true) {
      update.target.element.toggleAttribute('hidden', isEmptyFieldValue(value));
    }
    try {
      if (update.target.targetAttribute !== undefined) {
        const outcome = applyAttributeBinding(
          update.target.element,
          update.target.targetAttribute,
          value,
        );
        if (outcome === 'blocked') {
          this.d[RuntimeDependencySlot.Warn](
            `[live-preview] LP0401: refused to write field "${update.target.fieldName}" ` +
              `into attribute "${update.target.targetAttribute}" (unsafe attribute or value)`,
          );
          return false;
        }
      } else if (renderer) {
        // `FieldRenderer` intentionally retains its public 1.x `void` result.
        // Marked built-ins use an internal exact-false sentinel for known
        // no-write paths. Custom/plugin return values remain ignored exactly as
        // before, including a `false` produced by a real DOM mutation.
        const outcome = invokeRenderer(renderer, update.target, value, context);
        if (outcome === false && rendererUsesNoWriteOutcome(renderer)) return false;
      } else {
        this.d[RuntimeDependencySlot.Log]('no renderer for', resolvedType);
        return false;
      }
    } catch (err) {
      // A renderer or custom-element attribute reaction may have accepted a
      // newer revision before throwing. Its obsolete failure is not a current
      // runtime error and must not trigger any later lifecycle callbacks.
      if (!(
        this.l[RuntimeLifecycleSlot.Started] &&
        this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
      )) {
        return false;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      void this.d[RuntimeDependencySlot.Emitter].emitWhile(
        'error',
        { error, context: 'renderer', code: 'LP0603' },
        () =>
          this.l[RuntimeLifecycleSlot.Started] &&
          this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction,
      );
      return false;
    }
    // Both renderer writes and setAttribute/removeAttribute can execute
    // consumer code synchronously (plugins or custom-element reactions).
    if (!(
      this.l[RuntimeLifecycleSlot.Started] &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
    )) {
      return false;
    }
    if (emitElementUpdate) {
      void this.d[RuntimeDependencySlot.Emitter].emitWhile(
        'elementUpdate',
        {
          element: update.target.element,
          fieldName: update.target.fieldName,
          previousValue: previous,
          nextValue: value,
          revision: transaction.identity.revision,
          receivedAt: transaction.receivedAt,
          source: 'patch',
        },
        () =>
          this.l[RuntimeLifecycleSlot.Started] &&
          this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction,
      );
    }
    // emitWhile invokes its first handler before yielding. Account for a
    // synchronous reentrant update so the obsolete write is not counted as a
    // successful flush and cannot publish afterUpdate.
    const applied =
      this.l[RuntimeLifecycleSlot.Started] &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction;
    if (applied && this.d[RuntimeDependencySlot.SkipUnchanged]) {
      // Recorded only for a write that counted. A refused or superseded write
      // leaves the previous identity in place, so the next message re-applies.
      const identity = valueIdentity(value);
      if (identity !== undefined) {
        this.l[RuntimeLifecycleSlot.LastAppliedIdentity].set(update.target.element, identity);
      } else {
        this.l[RuntimeLifecycleSlot.LastAppliedIdentity].delete(update.target.element);
      }
    }
    return applied;
  }

  /**
   * Scroll the preview to the field whose value changed this update — where the
   * editor's cursor is (roadmap 2.0 "reveal the edited section"). The first
   * message establishes a baseline and never scrolls; afterwards only a field
   * whose value actually changed is a candidate, and the shared FieldRevealer
   * scrolls only when that field differs from the last revealed one and is
   * off-screen, so continuous typing and manual scroll-away are not fought.
   */
  #revealChangedFields(fields: Readonly<Record<string, unknown>>): void {
    if (!this.d[RuntimeDependencySlot.RevealEditedField]) return;
    const last = this.l[RuntimeLifecycleSlot.RevealLastValues];
    const baseline = last.size === 0;
    const changed: string[] = [];
    for (const [name, value] of Object.entries(fields)) {
      const id = valueIdentity(value);
      if (last.get(name) !== id) changed.push(name);
      last.set(name, id);
    }
    if (baseline) return;
    for (const name of changed) {
      if (this.#revealField(name) !== 'no-element') break;
    }
  }

  /** Reveal one field's bound element; the shared verdict for tier 1 and tier 2. */
  #revealField(fieldName: string): 'revealed' | 'already-visible' | 'skipped-same' | 'no-element' {
    const element = this.d[RuntimeDependencySlot.Cache].get(fieldName)?.[0]?.element;
    if (element === undefined) return 'no-element';
    const win = element.ownerDocument.defaultView as RevealWindow | null;
    if (win === null) return 'no-element';
    return this.l[RuntimeLifecycleSlot.Revealer].reveal(fieldName, element, win);
  }

  #onFlush(stats: FlushStats): void {
    // Before every early return below. A flush that applied nothing is exactly
    // the flush this reports, and the `applied === 0` guard would swallow it.
    // The same reasoning holds for the inspection snapshot: an empty flush is
    // the one a diagnosing reader most needs to see.
    this.l[RuntimeLifecycleSlot.LastFlush] = stats;
    this.#warnOnDeferredWrites(stats);
    const { identity, data } = stats;
    if (identity === undefined) return;
    const transaction = this.l[RuntimeLifecycleSlot.ActiveUpdate];
    if (
      transaction === null ||
      !(
        this.l[RuntimeLifecycleSlot.Started] &&
        this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction
      ) ||
      !sameRevision(transaction.identity, identity)
    ) {
      return;
    }
    // The revision's flush ran: terminal state, whether or not it applied a
    // write (every value may have been unchanged, or nothing was bound). A
    // later message now finds a finished update, not an abandoned one.
    if (!transaction.completed && transaction.pendingFragments === 0) {
      transaction.completed = true;
      this.l[RuntimeLifecycleSlot.CompletedCount] += 1;
    }
    if (stats.applied === 0 || data === undefined) return;
    const isCurrent = (): boolean =>
      this.l[RuntimeLifecycleSlot.Started] &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === transaction &&
      sameRevision(transaction.identity, identity);
    this.d[RuntimeDependencySlot.A11y]?.announceUpdate(stats.applied);
    if (!isCurrent()) return;
    dispatchIslandUpdate(this.d[RuntimeDependencySlot.Root], {
      fields: data.fields,
      revision: identity.revision,
      receivedAt: transaction.receivedAt,
      locale: transaction.locale,
    });
    if (!isCurrent()) return;
    this.#revealChangedFields(data.fields);
    if (!isCurrent()) return;
    if (this.d[RuntimeDependencySlot.Emitter].listenerCount('afterUpdate') === 0) {
      return;
    }
    void this.d[RuntimeDependencySlot.Emitter].emitWhile(
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
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */

  #onHeartbeatTimeout(): void {
    if (!this.#isRunning()) return;
    this.d[RuntimeDependencySlot.Bus].advanceGeneration();
    const active = this.l[RuntimeLifecycleSlot.ActiveUpdate];
    this.l[RuntimeLifecycleSlot.ActiveUpdate] = null;
    if (active !== null) {
      this.d[RuntimeDependencySlot.Scheduler].cancelRevision(active.identity);
    }
    this.d[RuntimeDependencySlot.Merger]?.destroy();
    const wasConnected = this.d[RuntimeDependencySlot.ConnectionState].markDisconnected();

    // Release the old origin before publishing the disconnect. A synchronous
    // disconnect listener may immediately dispatch from another allow-listed
    // origin; that update then connects and locks within the fresh generation,
    // and no later timeout step may undo its lock.
    try {
      this.d[RuntimeDependencySlot.HeartbeatTimeoutHook]?.();
    } catch (err) {
      this.d[RuntimeDependencySlot.Log]('heartbeat:', err);
    }
    if (!this.#isRunning()) return;
    if (wasConnected && this.#isDisconnectedWithoutActiveUpdate()) {
      this.d[RuntimeDependencySlot.A11y]?.announceDisconnected();
      void this.d[RuntimeDependencySlot.Emitter].emitWhile(
        'disconnect',
        { reason: 'timeout', timestamp: Date.now() },
        () => this.#isDisconnectedWithoutActiveUpdate(),
      );
      if (!this.#isRunning()) return;
      if (this.#isDisconnectedWithoutActiveUpdate()) {
        this.d[RuntimeDependencySlot.Log]('connection', 'connected', '→', 'disconnected');
        if (!this.#isRunning()) return;
      }
    }
    if (!this.#isRunning()) return;
    this.#sendReadyAfterStart();
  }

  /** Later handshake retries are best-effort and must not escape timer callbacks. */
  #sendReadyAfterStart(): void {
    try {
      this.d[RuntimeDependencySlot.SendReady](this.d[RuntimeDependencySlot.ReadyTargets]);
    } catch (error) {
      this.#reportError(error, 'ready', 'LP0606');
    }
  }

  #reportError(cause: unknown, context: string, code: DiagnosticCode): void {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    void this.d[RuntimeDependencySlot.Emitter].emit('error', {
      error,
      context,
      code,
    });
  }

  #isDisconnectedWithoutActiveUpdate(): boolean {
    return (
      this.l[RuntimeLifecycleSlot.Started] &&
      this.d[RuntimeDependencySlot.ConnectionState].status === 'disconnected' &&
      this.l[RuntimeLifecycleSlot.ActiveUpdate] === null
    );
  }
}

/** Resolve explicit binding metadata before schema and tag-name fallbacks. */
function resolveRuntimeFieldType(
  target: CachedElement,
  schemaType: string | undefined,
): RendererKey {
  if (target.explicitFieldType) return target.fieldType;
  if (schemaType !== undefined) {
    const mapped = payloadTypeToRenderer(schemaType);
    if (mapped !== undefined) return mapped;
  }
  return target.fieldType;
}

/**
 * Invoke the public 1.x void renderer contract without erasing its JavaScript
 * return value. Built-ins reserve exact `false` for a deliberate no-write;
 * every other result (including custom `void`) retains legacy success semantics.
 */
function invokeRenderer(
  renderer: FieldRenderer,
  target: CachedElement,
  value: unknown,
  context: RenderContext,
): unknown {
  // TypeScript's `void` is intentionally caller-facing: implementations may
  // return a value, while callers cannot depend on it. Reading it internally
  // here is the narrow compatibility bridge for the built-in sentinel.
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
  return renderer.render(target, value, context);
}

function createA11y(options: RuntimeOptions): A11yAnnouncer | null {
  if (options.enableA11y === false) return null;
  const targetDocument =
    options.root === undefined
      ? undefined
      : options.root.nodeType === 9
        ? (options.root as Document)
        : options.root.ownerDocument;
  return new A11yAnnouncer(options.a11yLocale, targetDocument);
}

/** DOM node types are stable across realms; global constructors are not. */
function isDocumentRoot(root: Document | Element): root is Document {
  return root.nodeType === 9;
}

/** lib.dom models body as present, although head-time documents can lack it. */
function readDocumentBody(root: Document): HTMLElement | null {
  return root.body;
}

/**
 * Structural check for a Lexical root payload. Mirrors
 * `isLexicalContent` from `@lexical/render` — duplicated here (four
 * lines) so the lightweight `./core` entry does not transitively pull
 * the entire Lexical renderer just for this shape test.
 */
function looksLikeLexicalRoot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (!('root' in value)) return false;
  const root = value.root;
  if (typeof root !== 'object' || root === null) return false;
  return Array.isArray((root as { children?: unknown }).children);
}

/**
 * Default ready broadcaster used when the host does not inject one.
 * Posts to `window.parent` and `window.opener` for each origin.
 */
function defaultSendReady(origins: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const targets: Window[] = [];
  if (window.parent !== window) targets.push(window.parent);
  if (window.opener instanceof Window) targets.push(window.opener);
  MessageBus.sendReady(targets, origins);
}

function sameRevision(a: MessageRevision, b: MessageRevision): boolean {
  return a.generation === b.generation && a.revision === b.revision;
}

/**
 * Top-level Payload document fields the live-preview engine ships in
 * every update but consumers almost never want to bind to. Suppressing
 * them keeps the orphan-field diagnostic focused on the user's own
 * editable fields.
 */
const SYSTEM_FIELD_NAMES: ReadonlySet<string> = new Set([
  'id',
  '_id',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  '_status',
  'globalType',
  'collection',
  'locale',
  'localized',
]);

/**
 * Decide whether a value looks like something a `<p data-payload-field>`
 * anchor would render. Strings, numbers, booleans, dates → yes. Objects
 * (Lexical content, relationships, uploads) and arrays → no.
 */
function isLiveBindableScalar(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  );
}

/**
 * Strip a trailing `_<locale>` suffix from a field name. Used by the
 * orphan-field diagnostic so a localized variant of a bound field
 * (e.g., `heroTitle_en`) doesn't fire a false warning when the binding
 * is `heroTitle`.
 */
function stripLocaleSuffix(name: string, locale: string | undefined): string {
  if (!locale) return name;
  const suffix = `_${locale}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
function readElementSnapshot(element: Element): unknown {
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    return (element as HTMLInputElement).value;
  }
  if (element.tagName === 'IMG') {
    return (element as HTMLImageElement).src;
  }
  return element.textContent;
}

export type { CachedElement };
export { resolveFieldValue } from './field-value';

/** Empty for a boundary anchor: nothing, an empty string, or an empty array. */
function isEmptyFieldValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return Array.isArray(value) && value.length === 0;
}
