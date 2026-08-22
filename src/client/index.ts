/**
 * Public, high-level `LivePreviewClient`.
 *
 * The client wraps a `LivePreviewRuntime` with:
 *
 *   - Per-instance event emitter (no singleton).
 *   - Per-instance plugin manager.
 *   - Custom-renderer registration.
 *   - Field-name transforms frozen into revision-bound scheduler entries before
 *     their later attribute or renderer dispatch.
 *
 * Consumers who want full programmatic control instantiate
 * `LivePreviewClient` directly. Consumers who just want a working
 * inline preview should use `generateInlineScript()` instead.
 *
 * @module @client
 */

import { LivePreviewRuntime } from '@core/lifecycle';
import type { LivePreviewInspection } from '@core/inspection/types';
import { EventEmitter } from '@events/emitter';
import { OriginDetector } from '@detection/origin';
import { PluginManager } from '@plugins/manager';
import { RendererRegistry } from '@plugins/renderer-registry';
import type { LivePreviewPlugin } from '@plugins/types';
import { isDevMode, isInPreviewContext } from '@detection/environment';
import { buildBuiltinRenderers } from '@field-types/index';
import type { FieldType } from '@core/types';
import type { LivePreviewClientConfig } from './config';
import { noopDiagnostic, safeConsoleDebug } from '@core/diagnostics';

export class LivePreviewClient {
  readonly #emitter = new EventEmitter();
  readonly #detector: OriginDetector;
  readonly #rendererRegistry: RendererRegistry;
  readonly #runtime: LivePreviewRuntime;
  readonly #plugins: PluginManager;
  readonly #log: (...args: unknown[]) => void;
  #started = false;
  #destroyed = false;
  #destroyPromise: Promise<void> | null = null;

  constructor(config: LivePreviewClientConfig = {}) {
    const debug = config.debug ?? isDevMode();
    this.#log = debug
      ? (...args): void => {
          safeConsoleDebug('[live-preview]', ...args);
        }
      : noopDiagnostic;

    this.#detector = new OriginDetector({
      ...(config.allowedOrigins !== undefined ? { additionalOrigins: config.allowedOrigins } : {}),
      ...(config.disableReferrerDetection !== undefined
        ? { enableReferrerDetection: !config.disableReferrerDetection }
        : {}),
      ...(config.disableLocalhostMatching !== undefined
        ? { enableLocalhostMatching: !config.disableLocalhostMatching }
        : {}),
    });

    if (this.#detector.isProductionUnconfigured) {
      this.#log('no trusted origin could be detected — set allowedOrigins or PAYLOAD_ADMIN_ORIGIN');
    }

    this.#rendererRegistry = new RendererRegistry(buildBuiltinRenderers());

    this.#plugins = new PluginManager({
      events: this.#emitter,
      config: Object.freeze({ ...config }),
      registerFieldRenderer: (renderer) => this.#rendererRegistry.register(renderer),
      onTransformError: (error) => {
        void this.#emitter.emit('error', { error, context: 'transform', code: 'LP0602' });
      },
      log: this.#log,
    });

    this.#runtime = new LivePreviewRuntime({
      ...(config.root !== undefined ? { root: config.root } : {}),
      renderers: this.#rendererRegistry.renderers,
      resolveRenderer: (fieldType: FieldType) => this.#rendererRegistry.resolve(fieldType),
      transformValue: (
        fieldName: string,
        value: unknown,
        context: { readonly element: Element; readonly allFields: Record<string, unknown> },
        isCurrent?: () => boolean,
      ) => this.#plugins.applyTransforms(fieldName, value, context, isCurrent),
      originMatcher: (origin) => this.#detector.matches(origin),
      readyTargets: this.#detector.enumerate(),
      emitter: this.#emitter,
      ...(config.serverURL !== undefined && config.serverURL !== ''
        ? {
            dataMerge: {
              serverURL: config.serverURL,
              ...(config.apiRoute !== undefined ? { apiRoute: config.apiRoute } : {}),
              ...(config.mergeDepth !== undefined ? { depth: config.mergeDepth } : {}),
              ...(config.mergeFetch !== undefined ? { fetchFn: config.mergeFetch } : {}),
            },
          }
        : {}),
      ...(config.debounceMs !== undefined ? { debounceMs: config.debounceMs } : {}),
      ...(config.heartbeatMs !== undefined ? { heartbeatMs: config.heartbeatMs } : {}),
      ...(config.intersectionRootMargin !== undefined
        ? { intersectionRootMargin: config.intersectionRootMargin }
        : {}),
      ...(config.scopeBindingsByOwner !== undefined
        ? { scopeBindingsByOwner: config.scopeBindingsByOwner }
        : {}),
      ...(config.disableVisibilityGate !== undefined
        ? { disableVisibilityGate: config.disableVisibilityGate }
        : {}),
      ...(config.visibilityGateThreshold !== undefined
        ? { visibilityGateThreshold: config.visibilityGateThreshold }
        : {}),
      ...(config.enableA11y !== undefined ? { enableA11y: config.enableA11y } : {}),
      ...(config.a11yLocale !== undefined ? { a11yLocale: config.a11yLocale } : {}),
      onHeartbeatTimeout: () => {
        this.#detector.unlockOrigin();
      },
      lockedOrigin: () => this.#detector.lockedOrigin,
      ...(config.validateToken !== undefined ? { validateToken: config.validateToken } : {}),
      log: this.#log,
    });

    this.#emitter.on('connect', (e) => {
      this.#detector.lockOrigin(e.origin);
    });

    if (config.autoStart !== false) {
      this.start();
    }
  }

  /**
   * Start the runtime. Returns `true` when this client is eligible and runtime
   * startup is active or scheduled for DOM readiness. Repeated calls on an
   * active client also return `true`; `false` means the client was destroyed or
   * the page is outside a preview context. A deferred startup can still fail,
   * roll back, and be retried by a later call.
   */
  start(): boolean {
    if (this.#destroyed) return false;
    if (this.#started) {
      // Normally the runtime is already active and returns false. Calling it is
      // intentional: a deferred DOM-ready startup can fail after this method has
      // returned; the runtime then rolls itself back and this call retries it.
      this.#runtime.start();
      return true;
    }
    if (!isInPreviewContext()) return false;
    const started = this.#runtime.start();
    if (started) this.#started = true;
    return started;
  }

  /**
   * Release the message ingress while keeping this client usable.
   *
   * For the document lifecycle, not for teardown: a back/forward-cache restore
   * does not re-run module scripts, so a client that stays attached across
   * `pagehide` returns bound to a frozen page and silently stops updating.
   * Plugins, renderers and transforms survive; `resume()` brings the same
   * client back. Returns `false` when there was nothing running to suspend.
   */
  suspend(): boolean {
    if (this.#destroyed || !this.#started) return false;
    return this.#runtime.suspend();
  }

  /**
   * Reacquire after `suspend()`.
   *
   * Deliberately the same path as `start()`: a restored document needs the
   * cache rebuilt, the observers rebound and the handshake rebroadcast, which
   * is exactly what starting does. Returns `false` for a destroyed client or
   * one that was never started.
   */
  resume(): boolean {
    if (this.#destroyed || !this.#started) return false;
    return this.#runtime.start();
  }

  /**
   * Stop the runtime and tear down every plugin. Idempotent.
   */
  destroy(): Promise<void> {
    if (this.#destroyPromise !== null) return this.#destroyPromise;
    this.#destroyed = true;
    let resolveDestroy!: () => void;
    let rejectDestroy!: (reason: unknown) => void;
    const inFlight = new Promise<void>((resolve, reject) => {
      resolveDestroy = resolve;
      rejectDestroy = reject;
    });
    // Publish the shared promise before synchronous runtime teardown. A destroy
    // event handler may call destroy() re-entrantly and must receive this same
    // in-flight completion rather than starting or observing a partial teardown.
    this.#destroyPromise = inFlight;
    try {
      this.#runtime.destroy();
      void this.#plugins
        .destroyAll()
        .finally(() => {
          this.#emitter.removeAllListeners();
        })
        .then(resolveDestroy, rejectDestroy);
    } catch (error) {
      this.#emitter.removeAllListeners();
      rejectDestroy(error);
    }
    return inFlight;
  }

  /**
   * Register a plugin.
   */
  async use(plugin: LivePreviewPlugin): Promise<void> {
    if (this.#destroyed) throw new Error('LivePreviewClient: already destroyed');
    await this.#plugins.register(plugin);
  }

  /** Unregister a plugin and release all resources owned by that registration. */
  async unuse(name: string): Promise<void> {
    await this.#plugins.unregister(name);
  }

  /** Rebuild the element cache manually. */
  refreshCache(): void {
    this.#runtime.refreshCache();
  }

  /** Read-only access to the event emitter for `on`/`once`/`off`. */
  get events(): EventEmitter {
    return this.#emitter;
  }

  /** Names of currently registered plugins. */
  get plugins(): readonly string[] {
    return this.#plugins.list();
  }

  /** Current connection status. */
  get status(): 'disconnected' | 'connecting' | 'connected' {
    return this.#runtime.status;
  }

  /** Number of valid updates received so far. */
  /**
   * Point-in-time read of runtime state, for diagnosing a preview that is not
   * updating. Performs no I/O and transmits nothing.
   *
   * Read `bindings.orphanFields` when a field refuses to update, and
   * `scheduler.deferred` together with `scheduler.visibilityGateActive` when
   * updates stop below the fold.
   */
  inspect(): LivePreviewInspection {
    return this.#runtime.inspect();
  }

  get updateCount(): number {
    return this.#runtime.updateCount;
  }

  /** `true` once `destroy()` has been called. */
  get destroyed(): boolean {
    return this.#destroyed;
  }
}

/**
 * Convenience factory: instantiate the client, returning `null` when
 * the page is not currently a preview context (top-level navigation).
 * Useful for SSR-style integrations that import this from any context.
 */
export function initLivePreview(config: LivePreviewClientConfig = {}): LivePreviewClient | null {
  const client = new LivePreviewClient({ ...config, autoStart: false });
  return client.start() ? client : null;
}

export type { LivePreviewClientConfig } from './config';
