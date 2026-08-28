/**
 * Per-instance plugin manager. Mutations run through one call-order queue;
 * while a queue-held hook is pending, a requested mutation takes the direct
 * path because that hook may be awaiting it. See ADR 0005.
 */

import type { FieldRenderer } from '@core/types';
import type { PluginInspection } from '@core/inspection/types';
import { LIBRARY_PROTOCOL_VERSION } from '@core/protocol-version';
import { VERSION } from '@/version';
import { incompatibilityOf } from './compat';
import { isolateDiagnostic } from '@core/diagnostics';
import { observeThenableResult } from '@core/thenable';
import type { EventEmitter } from '@events/emitter';
import { ResourceScope } from './resource-scope';
import { ScopedPluginEvents } from './scoped-events';
import type { FieldTransform, LivePreviewPlugin, PluginContext } from './types';

export interface PluginManagerOptions {
  readonly events: EventEmitter;
  readonly config: Readonly<Record<string, unknown>>;
  /** Add one renderer layer to the host; may return the layer's disposer. */
  readonly registerFieldRenderer: (renderer: FieldRenderer) => void;
  /** Receives transform contract failures for the runtime's `error` event. */
  readonly onTransformError?: (error: Error) => unknown;
  readonly log: (...args: unknown[]) => void;
}

interface PluginRegistration {
  readonly plugin: LivePreviewPlugin;
  readonly scope: ResourceScope;
}

interface InitializingPluginRegistration {
  readonly scope: ResourceScope;
  cancelled: boolean;
}

interface TransformRegistration {
  readonly transform: FieldTransform;
  active: boolean;
}

function isPluginDisposer(value: unknown): value is (() => void) | undefined {
  return typeof value === 'function';
}

export class PluginManager {
  readonly #events: EventEmitter;
  readonly #config: Readonly<Record<string, unknown>>;
  // The public callback type is void; the client host returns its layer disposer through it.
  readonly #registerRenderer: (renderer: FieldRenderer) => unknown;
  readonly #onTransformError: ((error: Error) => void) | undefined;
  readonly #log: (...args: unknown[]) => void;
  readonly #plugins = new Map<string, PluginRegistration>();
  readonly #initializing = new Map<string, InitializingPluginRegistration>();
  readonly #teardowns = new Map<string, Promise<void>>();
  readonly #destroying = new Set<string>();
  readonly #transforms = new Map<string, TransformRegistration[]>();
  #mutationQueue: Promise<void> = Promise.resolve();
  // Hooks awaited by the queue entry in flight. Hooks started on the direct
  // path never hold the queue, so they must not open it for others.
  #queuedHooks = 0;

  constructor(options: PluginManagerOptions) {
    this.#events = options.events;
    this.#config = options.config;
    this.#registerRenderer = options.registerFieldRenderer;
    this.#log = isolateDiagnostic(options.log);
    const onTransformError = options.onTransformError;
    this.#onTransformError =
      onTransformError === undefined
        ? undefined
        : isolateDiagnostic((...args: unknown[]): unknown => {
            // Private and single-callered: `applyTransforms` normalizes to an
            // Error before it reports one.
            const error = args[0] as Error;
            try {
              return onTransformError(error);
            } catch (reportError) {
              this.#log('transform error reporter failed:', reportError);
              return undefined;
            }
          });
  }

  /** Register a plugin transactionally; concurrent mutations run in call order. */
  register(plugin: LivePreviewPlugin): Promise<void> {
    if (this.#queuedHooks > 0) return this.#registerNow(plugin, false);
    return this.#enqueue(() => this.#registerNow(plugin, true));
  }

  /** Remove one plugin and every resource its registration created. */
  unregister(name: string): Promise<void> {
    if (this.#queuedHooks > 0) return this.#unregisterNow(name, false);
    return this.#enqueue(async () => {
      await this.#unregisterNow(name, true);
    });
  }

  /** Destroy every registration; one failure never strands another. */
  destroyAll(): Promise<void> {
    if (this.#queuedHooks > 0) return this.#destroyAllNow(false);
    return this.#enqueue(async () => {
      await this.#destroyAllNow(true);
    });
  }

  /** Apply active transforms in registration order; a failure returns the original value. */
  applyTransforms(
    fieldName: string,
    value: unknown,
    context: { readonly element: Element; readonly allFields: Record<string, unknown> },
    isCurrent?: () => boolean,
  ): unknown {
    const registrations = this.#transforms.get(fieldName);
    if (registrations === undefined || registrations.length === 0) return value;

    let result: unknown = value;
    for (const registration of [...registrations]) {
      if (!registration.active) continue;
      const { transform } = registration;
      if (isCurrent?.() === false) return value;
      try {
        result = transform(result, {
          fieldName,
          element: context.element,
          allFields: context.allFields,
        });
        const returnedThenable = observeThenableResult(result);
        // A transform may synchronously let a newer message in; then its
        // result belongs to a superseded revision and is not reported.
        if (isCurrent?.() === false) return value;
        if (returnedThenable) {
          throw new TypeError(
            `Transform for "${fieldName}" returned a Promise/thenable; transforms must be synchronous`,
          );
        }
      } catch (error) {
        if (isCurrent?.() === false) return value;
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.#log(`transform for "${fieldName}" failed:`, normalized);
        this.#onTransformError?.(normalized);
        return value;
      }
    }
    return result;
  }

  list(): readonly string[] {
    return [...this.#plugins.keys()];
  }

  /** Every plugin with its state and live registrations (`inspect().plugins`). */
  snapshot(): readonly PluginInspection[] {
    const entries: PluginInspection[] = [];
    const describe = (
      name: string,
      version: string | undefined,
      state: PluginInspection['state'],
      scope: ResourceScope,
    ): PluginInspection => {
      const counts = scope.counts();
      return {
        name,
        version,
        state,
        registrations: {
          transforms: counts.transform,
          renderers: counts.renderer,
          subscriptions: counts.subscription,
          cleanups: counts.cleanup,
        },
      };
    };
    for (const [name, initializing] of this.#initializing) {
      entries.push(describe(name, undefined, 'initializing', initializing.scope));
    }
    for (const [name, registration] of this.#plugins) {
      entries.push(describe(name, registration.plugin.version, 'active', registration.scope));
    }
    // A name with a pending teardown left `#plugins` before the teardown began.
    for (const name of this.#teardowns.keys()) {
      entries.push({
        name,
        version: undefined,
        state: 'tearing-down',
        registrations: { transforms: 0, renderers: 0, subscriptions: 0, cleanups: 0 },
      });
    }
    return entries;
  }

  get size(): number {
    return this.#plugins.size;
  }

  async #registerNow(plugin: LivePreviewPlugin, queued: boolean): Promise<void> {
    if (
      this.#plugins.has(plugin.name) ||
      this.#initializing.has(plugin.name) ||
      this.#teardowns.has(plugin.name)
    ) {
      this.#log(`plugin "${plugin.name}" already registered`);
      return;
    }

    const incompatibility = incompatibilityOf(plugin.compat, VERSION, LIBRARY_PROTOCOL_VERSION);
    if (incompatibility !== undefined) {
      this.#refuse(plugin.name, incompatibility);
      return;
    }
    const scope = new ResourceScope(plugin.name, this.#log);
    const context = this.#createContext(plugin.name, scope);
    const initializing: InitializingPluginRegistration = { scope, cancelled: false };
    this.#initializing.set(plugin.name, initializing);
    try {
      await this.#runHook(() => plugin.init(context), queued);
      if (initializing.cancelled) return;
      scope.commit();
    } catch (error) {
      scope.close();
      if (!initializing.cancelled) this.#log(`plugin "${plugin.name}" init failed:`, error);
      return;
    } finally {
      if (this.#initializing.get(plugin.name) === initializing) {
        this.#initializing.delete(plugin.name);
      }
    }

    this.#plugins.set(plugin.name, { plugin, scope });
    this.#log(`plugin "${plugin.name}" registered`);
  }

  /** A refused plugin is an integration mistake; it reaches the `error` event, not only the log. */
  #refuse(name: string, reason: string): void {
    const message = `plugin "${name}" refused: ${reason}`;
    this.#log(message);
    void this.#events.emit('error', {
      error: new Error(message),
      context: 'plugin',
      code: 'LP0103',
    });
  }

  #createContext(pluginName: string, scope: ResourceScope): PluginContext {
    return {
      events: new ScopedPluginEvents(this.#events, scope),
      registerFieldRenderer: (renderer) => {
        scope.stage('renderer', () => {
          const result = this.#registerRenderer(renderer);
          return isPluginDisposer(result) ? result : undefined;
        });
      },
      registerTransform: (fieldName, transform) => {
        const registration: TransformRegistration = { transform, active: false };
        scope.stage('transform', () => {
          registration.active = true;
          const existing = this.#transforms.get(fieldName);
          if (existing === undefined) this.#transforms.set(fieldName, [registration]);
          else existing.push(registration);

          return () => {
            registration.active = false;
            const current = this.#transforms.get(fieldName);
            if (current === undefined) return;
            const index = current.indexOf(registration);
            if (index >= 0) current.splice(index, 1);
            if (current.length === 0) this.#transforms.delete(fieldName);
          };
        });
      },
      registerCleanup: (cleanup) => {
        scope.own(cleanup);
      },
      getConfig: () => this.#config,
      log: (...args) => {
        this.#log(`[${pluginName}]`, ...args);
      },
    };
  }

  #unregisterNow(name: string, queued: boolean): Promise<void> {
    const initializing = this.#initializing.get(name);
    if (initializing !== undefined) {
      initializing.cancelled = true;
      initializing.scope.close();
      return Promise.resolve();
    }

    const existingTeardown = this.#teardowns.get(name);
    if (existingTeardown !== undefined) {
      // A destroy hook removing its own name cannot await the teardown that
      // awaits it; its resources are already revoked, so this is complete.
      if (this.#destroying.has(name)) return Promise.resolve();
      return queued ? this.#holdQueue(existingTeardown) : existingTeardown;
    }
    const registration = this.#plugins.get(name);
    if (registration === undefined) return Promise.resolve();

    // Revoke before consumer code runs: a throwing destroy keeps no access,
    // and a same-name registration from inside destroy stays a duplicate.
    this.#plugins.delete(name);
    registration.scope.close();
    const teardown = Promise.resolve().then(() =>
      this.#destroyPlugin(name, registration.plugin, queued),
    );
    this.#teardowns.set(name, teardown);
    void teardown.then(() => {
      if (this.#teardowns.get(name) === teardown) this.#teardowns.delete(name);
    });
    return teardown;
  }

  async #destroyPlugin(name: string, plugin: LivePreviewPlugin, queued: boolean): Promise<void> {
    if (plugin.destroy === undefined) return;
    this.#destroying.add(name);
    try {
      await this.#runHook(() => plugin.destroy?.(), queued);
    } catch (error) {
      this.#log(`plugin "${name}" destroy failed:`, error);
    } finally {
      this.#destroying.delete(name);
    }
  }

  async #destroyAllNow(queued: boolean): Promise<void> {
    for (const initializing of this.#initializing.values()) {
      initializing.cancelled = true;
      initializing.scope.close();
    }
    const names = [...this.#plugins.keys()];
    for (const name of names) await this.#unregisterNow(name, queued);
  }

  async #runHook(hook: () => void | Promise<void>, queued: boolean): Promise<void> {
    if (!queued) {
      await hook();
      return;
    }
    await this.#holdQueue(Promise.resolve().then(hook));
  }

  async #holdQueue(pending: Promise<void>): Promise<void> {
    this.#queuedHooks += 1;
    try {
      await pending;
    } finally {
      this.#queuedHooks -= 1;
    }
  }

  #enqueue(operation: () => void | Promise<void>): Promise<void> {
    const result = this.#mutationQueue.then(operation);
    // Keep the tail usable after an escaped error; the caller still sees it on `result`.
    this.#mutationQueue = result.catch((error: unknown) => {
      this.#log('plugin manager mutation failed:', error);
    });
    return result;
  }
}
