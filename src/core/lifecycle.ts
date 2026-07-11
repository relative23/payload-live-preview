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
  PayloadDocumentEventMessage,
  PayloadFieldSchema,
  PayloadLivePreviewData,
  PayloadLivePreviewMessage,
} from '@/types/payload-protocol';
import type { EventEmitter } from '@events/emitter';
import type { OriginMatcher } from './message-bus';
import type { CachedElement, FieldRenderer, FieldType, RenderContext } from './types';
import { ElementCache } from './cache';
import { ObserverManager } from './observers';
import { MessageBus } from './message-bus';
import { ConnectionState, HeartbeatTimer } from './state';
import { UpdateScheduler, type FlushStats, type ScheduledUpdate } from './update-scheduler';
import { A11yAnnouncer } from './a11y';
import {
  buildSchemaIndex,
  lookupSchema,
  payloadTypeToRenderer,
  type SchemaIndex,
} from '@schema/index';
import {
  LIBRARY_PROTOCOL_VERSION,
  negotiateProtocol,
  type ProtocolNegotiation,
} from './protocol-version';

const READY_RETRY_DELAYS_MS = [0, 500, 1000, 2000] as const;

export interface RuntimeOptions {
  /** Document root containing the bindings. Defaults to `document`. */
  readonly root?: Document | Element;
  /** Map from field type to renderer. */
  readonly renderers: Readonly<Record<string, FieldRenderer>>;
  /** Origin matcher for incoming messages. */
  readonly originMatcher: OriginMatcher;
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
  /** When true, every update applies regardless of visibility. */
  readonly disableVisibilityGate?: boolean;
  /** Cache-size threshold above which off-screen updates are queued for replay. Default 50. */
  readonly visibilityGateThreshold?: number;
  /**
   * Mount an `aria-live` region and announce connect/update/disconnect
   * to assistive technology. Default `true`. Set `false` for runtimes
   * that already provide their own screen-reader announcements.
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
   * approves; otherwise the message is dropped. Useful in
   * multi-tenant admin contexts where origin-trust alone is too
   * permissive.
   */
  readonly validateToken?: (token: string | undefined, origin: string) => boolean | Promise<boolean>;
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

export class LivePreviewRuntime {
  readonly #emitter: EventEmitter;
  readonly #cache: ElementCache;
  readonly #observers: ObserverManager;
  readonly #scheduler: UpdateScheduler;
  readonly #bus: MessageBus;
  readonly #state: ConnectionState;
  readonly #heartbeat: HeartbeatTimer;
  readonly #renderers: Readonly<Record<string, FieldRenderer>>;
  readonly #root: Document | Element;
  readonly #readyTargets: readonly string[];
  readonly #sendReady: (origins: readonly string[]) => void;
  readonly #onHeartbeatTimeoutHook: (() => void) | undefined;
  readonly #log: (...args: unknown[]) => void;
  readonly #warn: (...args: unknown[]) => void;
  readonly #readyTimers: ReturnType<typeof setTimeout>[] = [];
  readonly #a11y: A11yAnnouncer | null;

  #currentLocale: string | undefined;
  #currentSchema: readonly PayloadFieldSchema[] | undefined;
  #schemaIndex: SchemaIndex | undefined;
  #protocolNegotiation: ProtocolNegotiation = negotiateProtocol(undefined);
  #started = false;
  #updateCount = 0;
  /**
   * Field names we've already warned about as "orphan updates" — updates
   * arrived for them but no `[data-payload-field=…]` anchor exists.
   * Set-membership prevents the diagnostic from spamming the console
   * during continuous editing.
   */
  readonly #warnedOrphanFields = new Set<string>();

  constructor(options: RuntimeOptions) {
    this.#emitter = options.emitter;
    this.#renderers = options.renderers;
    this.#root =
      options.root ?? (typeof document !== 'undefined' ? document : (null as unknown as Document));
    this.#readyTargets = options.readyTargets;
    this.#sendReady = options.sendReady ?? defaultSendReady;
    this.#onHeartbeatTimeoutHook = options.onHeartbeatTimeout;
    this.#log = options.log ?? noopLogger;
    this.#warn = options.warn ?? defaultWarn;
    this.#a11y = createA11y(options);

    this.#cache = new ElementCache();
    this.#observers = new ObserverManager(
      {
        onStructuralChange: () => {
          this.#rebuildCache();
        },
        onVisibilityChange: (element, visible) => {
          if (visible) this.#scheduler.notifyVisible(element);
        },
      },
      {
        ...(options.intersectionRootMargin !== undefined
          ? { intersectionRootMargin: options.intersectionRootMargin }
          : {}),
      },
    );
    this.#scheduler = new UpdateScheduler(
      (update) => {
        this.#applyUpdate(update);
      },
      {
        ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
        ...(options.disableVisibilityGate !== undefined
          ? { disableVisibilityGate: options.disableVisibilityGate }
          : {}),
        ...(options.visibilityGateThreshold !== undefined
          ? { visibilityGateThreshold: options.visibilityGateThreshold }
          : {}),
        isVisible: (element) => this.#observers.isVisible(element),
        getCacheSize: () => this.#cache.elementCount,
        onFlush: (stats) => {
          this.#onFlush(stats);
        },
      },
    );
    this.#bus = new MessageBus(options.originMatcher, {
      onUpdate: (msg, origin) => {
        this.#handleUpdate(msg, origin);
      },
      onDocumentEvent: (msg, origin) => {
        this.#handleDocumentEvent(msg, origin);
      },
      onInvalid: (reason, origin) => {
        if (reason === 'token') {
          const error = new Error(`Preview token rejected (origin: ${origin})`);
          void this.#emitter.emit('error', { error, context: 'token' });
        }
        this.#log('message rejected:', reason, origin);
      },
      ...(options.validateToken !== undefined ? { validateToken: options.validateToken } : {}),
    });
    this.#state = new ConnectionState((next, prev) => {
      this.#log('connection', prev, '→', next);
    });
    this.#heartbeat = new HeartbeatTimer({
      ...(options.heartbeatMs !== undefined ? { timeoutMs: options.heartbeatMs } : {}),
      onTimeout: () => {
        this.#onHeartbeatTimeout();
      },
    });
  }

  /**
   * Start the runtime: build cache, attach observers, listen for
   * messages, broadcast `ready`. Returns `true` if it actually started
   * (it will refuse to start a second time).
   */
  start(): boolean {
    if (this.#started) return false;
    this.#started = true;

    this.#buildCacheAndObserve();
    this.#observers.start(this.#root instanceof Document ? this.#root.body : this.#root);
    this.#bus.attach();
    this.#emitInit();

    // Re-broadcast ready several times to absorb parent-side init latency.
    for (const delay of READY_RETRY_DELAYS_MS) {
      if (delay === 0) {
        this.#sendReady(this.#readyTargets);
      } else {
        const handle = setTimeout(() => {
          this.#sendReady(this.#readyTargets);
        }, delay);
        this.#readyTimers.push(handle);
      }
    }

    return true;
  }

  /** Tear down all observers, timers, and listeners. Idempotent. */
  destroy(): void {
    if (!this.#started) return;
    this.#started = false;
    for (const handle of this.#readyTimers) clearTimeout(handle);
    this.#readyTimers.length = 0;
    this.#heartbeat.stop();
    this.#bus.detach();
    this.#observers.stop();
    this.#scheduler.destroy();
    this.#cache.clear();
    const wasConnected = this.#state.status === 'connected';
    this.#state.markDisconnected();
    if (wasConnected) {
      this.#a11y?.announceDisconnected();
      void this.#emitter.emit('disconnect', { reason: 'destroy', timestamp: Date.now() });
    }
    this.#a11y?.detach();
    void this.#emitter.emit('destroy', { timestamp: Date.now() });
  }

  /** Re-scan the DOM and re-register every binding. */
  refreshCache(): void {
    this.#rebuildCache();
  }

  /** Current connection status, exposed for the high-level client. */
  get status(): 'disconnected' | 'connecting' | 'connected' {
    return this.#state.status;
  }

  /** Read-only view of the element cache. */
  get cache(): ElementCache {
    return this.#cache;
  }

  /** Read-only view of how many updates have been received. */
  get updateCount(): number {
    return this.#updateCount;
  }

  /**
   * Negotiated protocol view — `min(library, remote)`. Useful for
   * consumers that want to branch on protocol capabilities without
   * hard-coding version numbers. Updates lazily as the remote party's
   * version arrives on incoming messages.
   */
  get protocol(): ProtocolNegotiation {
    return this.#protocolNegotiation;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────────

  #buildCacheAndObserve(): void {
    const stats = this.#cache.buildFromRoot(this.#root);
    this.#log('cache built', stats);
    void this.#emitter.emit('cacheRefresh', stats);
    for (const entry of this.#cache.values()) {
      this.#observers.observeElement(entry.element);
    }
  }

  #rebuildCache(): void {
    for (const entry of this.#cache.values()) {
      this.#observers.unobserveElement(entry.element);
      this.#scheduler.forget(entry.element);
    }
    this.#buildCacheAndObserve();
  }

  #emitInit(): void {
    void this.#emitter.emit('init', { timestamp: Date.now() });
  }

  #applyNegotiation(remoteVersion: number): void {
    const next = negotiateProtocol(remoteVersion);
    if (next.negotiated === this.#protocolNegotiation.negotiated) return;
    this.#protocolNegotiation = next;
    this.#log(
      'protocol negotiated',
      `ours=${LIBRARY_PROTOCOL_VERSION}`,
      `theirs=${remoteVersion}`,
      `negotiated=${next.negotiated}`,
    );
  }

  #handleUpdate(message: PayloadLivePreviewMessage, origin: string): void {
    this.#heartbeat.kick();
    if (message.protocolVersion !== undefined) {
      this.#applyNegotiation(message.protocolVersion);
    }
    if (message.data === undefined) {
      return;
    }
    if (this.#state.markConnected()) {
      this.#a11y?.announceConnected();
      void this.#emitter.emit('connect', { origin, timestamp: Date.now() });
    }
    this.#updateCount += 1;
    if (message.locale !== undefined) this.#currentLocale = message.locale;
    if (message.fieldSchemaJSON !== undefined) {
      this.#currentSchema = message.fieldSchemaJSON;
      this.#schemaIndex = buildSchemaIndex(message.fieldSchemaJSON);
    }

    const data: PayloadLivePreviewData = {
      fields: message.data,
      ...(this.#currentSchema !== undefined ? { schema: this.#currentSchema } : {}),
      ...(message.globalSlug !== undefined ? { globalSlug: message.globalSlug } : {}),
      ...(message.collectionSlug !== undefined ? { collectionSlug: message.collectionSlug } : {}),
      ...(this.#currentLocale !== undefined ? { locale: this.#currentLocale } : {}),
    };

    let cancelled = false;
    void this.#emitter
      .emit('beforeUpdate', {
        data,
        cancel: (): void => {
          cancelled = true;
        },
      })
      .then(() => {
        if (cancelled) return;
        this.#scheduleAllFields(data);
      });
  }

  #handleDocumentEvent(_message: PayloadDocumentEventMessage, _origin: string): void {
    void this.#emitter.emit('documentSave', { timestamp: Date.now() });
  }

  #scheduleAllFields(data: PayloadLivePreviewData): void {
    for (const [fieldName, bindings] of this.#cache.entries()) {
      const value = resolveFieldValue(data.fields, fieldName, this.#currentLocale);
      if (value === undefined) continue;
      for (const target of bindings) {
        const update: ScheduledUpdate = {
          target,
          value,
          allFields: data.fields,
        };
        this.#scheduler.schedule(update);
      }
    }
    this.#diagnoseOrphanFields(data.fields);
  }

  /**
   * Walk the incoming `data` payload and warn (via `this.#log`) when an
   * editable-looking field arrives for which **no `[data-payload-field]`
   * anchor exists** in the page. This is the most common live-preview
   * footgun: an SSR template renders the binding only when the field is
   * non-empty, so editing a previously-empty field has nowhere to land.
   *
   * The warning is gated by:
   *   - `this.#log` being a real logger (no-op when debug disabled)
   *   - per-field deduplication via `#warnedOrphanFields`
   *   - scalar value heuristic (objects/arrays don't get warned)
   *   - a small ignore-list of system fields Payload always ships
   *
   * The method intentionally lives on the runtime — not on the cache —
   * because it depends on the locale and on schema knowledge that the
   * cache does not own.
   */
  #diagnoseOrphanFields(fields: Record<string, unknown>): void {
    if (this.#cache.elementCount === 0) return;
    const boundNames = new Set<string>();
    for (const [name] of this.#cache.entries()) boundNames.add(name);
    for (const [rawName, value] of Object.entries(fields)) {
      if (this.#warnedOrphanFields.has(rawName)) continue;
      if (SYSTEM_FIELD_NAMES.has(rawName)) continue;
      if (!isLiveBindableScalar(value)) continue;
      const baseName = stripLocaleSuffix(rawName, this.#currentLocale);
      if (boundNames.has(rawName) || boundNames.has(baseName)) continue;
      this.#warnedOrphanFields.add(rawName);
      this.#warn(
        `[live-preview] update arrived for field "${rawName}" but no ` +
          `<… data-payload-field="${baseName}"> element exists on this page. ` +
          `Render the binding anchor unconditionally in your template so ` +
          `live edits to an initially-empty field have somewhere to land.`,
      );
    }
  }

  #applyUpdate(update: ScheduledUpdate): void {
    const schemaEntry =
      this.#schemaIndex !== undefined
        ? lookupSchema(this.#schemaIndex, update.target.fieldName)
        : undefined;
    const resolvedType = this.#resolveFieldType(update.target, schemaEntry?.type);
    const renderer = this.#renderers[resolvedType];
    const previous = readElementSnapshot(update.target.element);
    const context: RenderContext = {
      allFields: update.allFields,
      locale: this.#currentLocale,
      schema: schemaEntry,
    };
    try {
      if (renderer) {
        renderer.render(update.target, update.value, context);
      } else {
        this.#log('no renderer for', resolvedType);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      void this.#emitter.emit('error', { error, context: 'renderer' });
      return;
    }
    void this.#emitter.emit('elementUpdate', {
      element: update.target.element,
      fieldName: update.target.fieldName,
      previousValue: previous,
      nextValue: update.value,
    });
  }

  /**
   * Resolve the renderer name for an update. Explicit consumer DOM
   * attributes (`data-payload-type`) always win; otherwise the schema
   * type maps to a renderer; otherwise the cache's tag-based heuristic
   * stands.
   */
  #resolveFieldType(target: CachedElement, schemaType: string | undefined): FieldType {
    if (target.explicitFieldType) return target.fieldType;
    if (schemaType !== undefined) {
      const mapped = payloadTypeToRenderer(schemaType);
      if (mapped !== undefined) return mapped;
    }
    return target.fieldType;
  }

  #onFlush(stats: FlushStats): void {
    if (stats.applied === 0 && stats.deferred === 0) return;
    if (stats.applied > 0) this.#a11y?.announceUpdate(stats.applied);
    void this.#emitter.emit('afterUpdate', {
      data: {
        fields: {},
        ...(this.#currentLocale !== undefined ? { locale: this.#currentLocale } : {}),
      },
      updatedCount: stats.applied,
      durationMs: stats.durationMs,
    });
  }

  #onHeartbeatTimeout(): void {
    if (this.#state.markDisconnected()) {
      this.#a11y?.announceDisconnected();
      void this.#emitter.emit('disconnect', { reason: 'timeout', timestamp: Date.now() });
    }
    try {
      this.#onHeartbeatTimeoutHook?.();
    } catch (err) {
      this.#log('onHeartbeatTimeout hook threw:', err);
    }
    this.#sendReady(this.#readyTargets);
  }
}

function createA11y(options: RuntimeOptions): A11yAnnouncer | null {
  if (options.enableA11y === false) return null;
  return options.a11yLocale !== undefined
    ? new A11yAnnouncer(options.a11yLocale)
    : new A11yAnnouncer();
}

function noopLogger(): void {
  // Intentionally empty — debug logging is opt-in via RuntimeOptions.log.
}

/**
 * Default `warn` channel — routes to `console.warn` so consumer-side
 * mistakes (orphan field updates, etc.) reach the developer even when
 * debug logging is off. Falls back to a no-op when `console` is
 * unavailable (some sandboxes).
 */
function defaultWarn(...args: unknown[]): void {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(...args);
  }
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

/**
 * Resolve a field value from the update payload, walking nested dotted
 * paths and trying locale-suffixed fallbacks when a locale is active.
 *
 * Hardened against prototype pollution: keys `__proto__`, `prototype`,
 * and `constructor` short-circuit to `undefined`.
 */
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

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
export function resolveFieldValue(
  fields: Record<string, unknown>,
  path: string,
  locale: string | undefined,
): unknown {
  const direct = readSafe(fields, path);
  if (direct !== undefined) return direct;
  if (path.includes('.')) {
    const segments = path.split('.');
    let current: unknown = fields;
    for (const segment of segments) {
      if (BLOCKED_KEYS.has(segment)) return undefined;
      if (current === null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    if (current !== undefined) return current;
  }
  if (locale !== undefined) {
    const localised = readSafe(fields, `${path}_${locale}`);
    if (localised !== undefined) return localised;
  }
  return undefined;
}

function readSafe(obj: Record<string, unknown>, key: string): unknown {
  if (BLOCKED_KEYS.has(key)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined;
  return obj[key];
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
