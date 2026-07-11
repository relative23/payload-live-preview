/**
 * Public, high-level `LivePreviewClient`.
 *
 * The client wraps a `LivePreviewRuntime` with:
 *
 *   - Per-instance event emitter (no singleton).
 *   - Per-instance plugin manager.
 *   - Custom-renderer registration.
 *   - Field-name transforms applied before renderer dispatch.
 *
 * Consumers who want full programmatic control instantiate
 * `LivePreviewClient` directly. Consumers who just want a working
 * inline preview should use `generateInlineScript()` instead.
 *
 * @module @client
 */

import type { FieldRenderer } from '@core/types';
import { LivePreviewRuntime } from '@core/lifecycle';
import { EventEmitter } from '@events/emitter';
import { OriginDetector } from '@detection/origin';
import { PluginManager } from '@plugins/manager';
import type { LivePreviewPlugin } from '@plugins/types';
import { isDevMode, isInPreviewContext } from '@detection/environment';
import { buildBuiltinRenderers } from '@field-types/index';
import type { LivePreviewClientConfig } from './config';

export class LivePreviewClient {
  readonly #emitter = new EventEmitter();
  readonly #detector: OriginDetector;
  readonly #renderers: Record<string, FieldRenderer>;
  readonly #runtime: LivePreviewRuntime;
  readonly #plugins: PluginManager;
  readonly #log: (...args: unknown[]) => void;
  #started = false;
  #destroyed = false;

  constructor(config: LivePreviewClientConfig = {}) {
    const debug = config.debug ?? isDevMode();
    this.#log = debug
      ? (...args): void => {
          // eslint-disable-next-line no-console -- opt-in debug channel
          console.debug('[live-preview]', ...args);
        }
      : (): void => {
          /* silent */
        };

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

    const builtin = buildBuiltinRenderers();
    this.#renderers = { ...builtin };

    this.#plugins = new PluginManager({
      events: this.#emitter,
      config: Object.freeze({ ...config }),
      registerFieldRenderer: (renderer) => {
        this.#renderers[renderer.name] = renderer;
      },
      log: this.#log,
    });

    this.#runtime = new LivePreviewRuntime({
      ...(config.root !== undefined ? { root: config.root } : {}),
      renderers: this.#renderers,
      originMatcher: (origin) => this.#detector.matches(origin),
      readyTargets: this.#detector.enumerate(),
      emitter: this.#emitter,
      ...(config.serverURL !== undefined && config.serverURL !== ''
        ? {
            dataMerge: {
              serverURL: config.serverURL,
              ...(config.apiRoute !== undefined ? { apiRoute: config.apiRoute } : {}),
              ...(config.mergeDepth !== undefined ? { depth: config.mergeDepth } : {}),
            },
          }
        : {}),
      ...(config.debounceMs !== undefined ? { debounceMs: config.debounceMs } : {}),
      ...(config.heartbeatMs !== undefined ? { heartbeatMs: config.heartbeatMs } : {}),
      ...(config.intersectionRootMargin !== undefined
        ? { intersectionRootMargin: config.intersectionRootMargin }
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
   * Start the runtime. Returns `true` when the runtime actually
   * started (it may refuse to start outside a preview context).
   */
  start(): boolean {
    if (this.#destroyed) return false;
    if (this.#started) return true;
    if (!isInPreviewContext()) return false;
    this.#started = true;
    return this.#runtime.start();
  }

  /**
   * Stop the runtime and tear down every plugin. Idempotent.
   */
  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#runtime.destroy();
    await this.#plugins.destroyAll();
    this.#emitter.removeAllListeners();
  }

  /**
   * Register a plugin.
   */
  async use(plugin: LivePreviewPlugin): Promise<void> {
    if (this.#destroyed) throw new Error('LivePreviewClient: already destroyed');
    await this.#plugins.register(plugin);
  }

  /**
   * Unregister a plugin by name.
   */
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
