/**
 * `LivePreviewClient`: a `LivePreviewRuntime` with its own emitter, plugin
 * manager and renderer registry. A page that only needs a working preview uses
 * `generateInlineScript()` instead.
 */

import { assertMergeDepthExplicit } from '@/types/merge-depth';
import { LivePreviewRuntime, type RuntimeOptions } from '@core/lifecycle';
import type { LivePreviewInspection } from '@core/inspection/types';
import type { CachedElement, RendererKey } from '@core/types';
import { EventEmitter } from '@events/emitter';
import { OriginDetector } from '@detection/origin';
import { PluginManager } from '@plugins/manager';
import { RendererRegistry } from '@plugins/renderer-registry';
import type { LivePreviewPlugin } from '@plugins/types';
import { isDevMode, isInPreviewContext } from '@detection/environment';
import { buildBuiltinRenderers } from '@field-types/index';
import { definedOnly } from '@/types/defined-only';
import { withProfileDefaults, type LivePreviewClientConfig } from './config';
import { noopDiagnostic, safeConsoleDebug } from '@core/diagnostics';

/** `T` with every property optional and `undefined`-able, for literals built from optional inputs. */
type Loose<T> = { readonly [K in keyof T]?: T[K] | undefined };

function invert(value: boolean | undefined): boolean | undefined {
  return value === undefined ? undefined : !value;
}

export class LivePreviewClient {
  readonly #emitter = new EventEmitter();
  readonly #detector: OriginDetector;
  readonly #rendererRegistry: RendererRegistry;
  readonly #runtime: LivePreviewRuntime;
  readonly #plugins: PluginManager;
  readonly #log: (...args: unknown[]) => void;
  #started = false;
  #destroyed = false;
  #tornDown = false;
  #destroyPromise: Promise<void> | null = null;

  constructor(rawConfig: LivePreviewClientConfig = {}) {
    const config = withProfileDefaults(rawConfig);
    const serverURL = config.serverURL ?? '';
    assertMergeDepthExplicit({
      defaults: rawConfig.defaults,
      serverURL,
      mergeDepth: config.mergeDepth,
    });
    const debug = config.debug ?? isDevMode();
    this.#log = debug
      ? (...args): void => {
          safeConsoleDebug('[live-preview]', ...args);
        }
      : noopDiagnostic;

    this.#detector = new OriginDetector(
      definedOnly({
        additionalOrigins: config.allowedOrigins,
        enableReferrerDetection: invert(config.disableReferrerDetection),
        enableLocalhostMatching: invert(config.disableLocalhostMatching),
      }),
    );

    if (this.#detector.isProductionUnconfigured) {
      this.#log('no trusted origin could be detected — set allowedOrigins');
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

    this.#runtime = new LivePreviewRuntime(
      definedOnly({
        root: config.root,
        renderers: this.#rendererRegistry.renderers,
        resolveRenderer: (fieldType: RendererKey, target: CachedElement) =>
          config.resolveRenderer?.(fieldType, target) ?? this.#rendererRegistry.resolve(fieldType),
        renderRichText: config.renderRichText,
        sanitizerPolicy: config.sanitizerPolicy,
        transformValue: (
          fieldName: string,
          value: unknown,
          context: { readonly element: Element; readonly allFields: Record<string, unknown> },
          isCurrent?: () => boolean,
        ) => this.#plugins.applyTransforms(fieldName, value, context, isCurrent),
        originMatcher: (origin: string) => this.#detector.matches(origin),
        // Read per handshake, not once: after a lock, a bfcache restore must
        // re-broadcast to the locked origin alone, not every pre-lock candidate.
        readyTargets: () => this.#detector.enumerate(),
        emitter: this.#emitter,
        dataMerge:
          serverURL === ''
            ? undefined
            : definedOnly({
                serverURL,
                apiRoute: config.apiRoute,
                depth: config.mergeDepth,
                fetchFn: config.mergeFetch,
              }),
        debounceMs: config.debounceMs,
        heartbeatMs: config.heartbeatMs,
        intersectionRootMargin: config.intersectionRootMargin,
        scopeBindingsByOwner: config.scopeBindingsByOwner,
        skipUnchanged: config.skipUnchanged,
        revealEditedField: config.revealEditedField,
        eventSourcePolicy: config.eventSourcePolicy,
        dependencies: config.dependencies,
        strategies: config.strategies,
        disableVisibilityGate: config.disableVisibilityGate,
        visibilityGateThreshold: config.visibilityGateThreshold,
        enableA11y: config.enableA11y,
        a11yLocale: config.a11yLocale,
        onHeartbeatTimeout: () => {
          this.#detector.unlockOrigin();
        },
        lockedOrigin: () => this.#detector.lockedOrigin,
        validateToken: config.validateToken,
        log: this.#log,
      } satisfies Loose<RuntimeOptions>),
    );

    this.#emitter.on('connect', (e) => {
      this.#detector.lockOrigin(e.origin);
    });

    if (config.autoStart !== false) {
      this.start();
    }
  }

  /**
   * Start the runtime: `true` while eligible and started or scheduled for DOM
   * readiness, `false` once destroyed or outside a preview context.
   */
  start(): boolean {
    if (this.#destroyed) return false;
    if (this.#started) {
      // A deferred DOM-ready startup can fail after this returned and roll
      // itself back; this call retries it.
      this.#runtime.start();
      return true;
    }
    if (!isInPreviewContext()) return false;
    const started = this.#runtime.start();
    if (started) this.#started = true;
    return started;
  }

  /**
   * Release the message ingress, keeping plugins and renderers, for `pagehide`:
   * a bfcache restore re-runs no script, so an attached client would return
   * bound to a frozen page. `false` when nothing was running.
   */
  suspend(): boolean {
    if (this.#destroyed || !this.#started) return false;
    return this.#runtime.suspend();
  }

  /** Reacquire after `suspend()`: the same path as `start()`, because a restored document needs the same rebuild. */
  resume(): boolean {
    if (this.#destroyed || !this.#started) return false;
    return this.#runtime.start();
  }

  /** Stop the runtime and tear down every plugin. Idempotent; concurrent callers share one promise. */
  destroy(): Promise<void> {
    if (this.#destroyPromise !== null) return this.#destroyPromise;
    this.#destroyed = true;
    let resolveDestroy!: () => void;
    let rejectDestroy!: (reason: unknown) => void;
    const inFlight = new Promise<void>((resolve, reject) => {
      resolveDestroy = resolve;
      rejectDestroy = reject;
    });
    // Published before the teardown: a `destroy` handler calling destroy()
    // re-entrantly must get this same promise.
    this.#destroyPromise = inFlight;
    const finish = (): void => {
      this.#emitter.removeAllListeners();
      this.#tornDown = true;
    };
    try {
      this.#runtime.destroy();
      void this.#plugins.destroyAll().finally(finish).then(resolveDestroy, rejectDestroy);
    } catch (error) {
      finish();
      rejectDestroy(error);
    }
    return inFlight;
  }

  async use(plugin: LivePreviewPlugin): Promise<void> {
    if (this.#destroyed) throw new Error('LivePreviewClient: already destroyed');
    await this.#plugins.register(plugin);
  }

  /** Unregister a plugin and release everything its registration owned. Still allowed from a destroy hook during teardown. */
  async unuse(name: string): Promise<void> {
    if (this.#tornDown) throw new Error('LivePreviewClient: already destroyed');
    await this.#plugins.unregister(name);
  }

  refreshCache(): void {
    this.#runtime.refreshCache();
  }

  get events(): EventEmitter {
    return this.#emitter;
  }

  /** Names of the registered plugins. */
  get plugins(): readonly string[] {
    return this.#plugins.list();
  }

  get status(): 'disconnected' | 'connecting' | 'connected' {
    return this.#runtime.status;
  }

  /**
   * Point-in-time read of runtime state, no I/O: `bindings.orphanFields` when a
   * field refuses to update, `scheduler.deferred` when updates stop below the fold.
   */
  inspect(): LivePreviewInspection {
    return { ...this.#runtime.inspect(), plugins: this.#plugins.snapshot() };
  }

  /** Number of accepted updates so far. */
  get updateCount(): number {
    return this.#runtime.updateCount;
  }

  /** `true` once `destroy()` has been called. */
  get destroyed(): boolean {
    return this.#destroyed;
  }
}

/** A started client, or `null` when the page is not a preview context. */
export function initLivePreview(config: LivePreviewClientConfig = {}): LivePreviewClient | null {
  const client = new LivePreviewClient({ ...config, autoStart: false });
  return client.start() ? client : null;
}

export type { LivePreviewClientConfig } from './config';
