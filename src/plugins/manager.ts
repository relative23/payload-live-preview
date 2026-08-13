/**
 * Per-instance plugin manager.
 *
 * Every registration receives an isolated resource scope. Event listeners,
 * transforms, renderer layers, and generic cleanups registered through the
 * context are revoked together before the plugin's `destroy()` hook runs.
 * Normal manager mutations are serialized so init, removal, and
 * re-registration cannot expose a partially initialized registration.
 * Mutations requested while an awaited lifecycle hook is pending take a
 * direct transactional path so the hook never waits on a queue entry blocked
 * by itself. Each registration still stages its resources until commit.
 *
 * @module @plugins/manager
 */

import type { FieldRenderer } from '@core/types';
import { isolateDiagnostic } from '@core/diagnostics';
import { observeThenableResult } from '@core/thenable';
import { EventEmitter } from '@events/emitter';
import type { EventHandler, LivePreviewEventMap, Unsubscribe } from '@events/types';
import type {
  FieldTransform,
  LivePreviewPlugin,
  PluginContext,
  PluginDisposer,
  PluginEvents,
} from './types';

export interface PluginManagerOptions {
  readonly events: EventEmitter;
  readonly config: Readonly<Record<string, unknown>>;
  /** Add one renderer layer to the host. Retains the established void contract. */
  readonly registerFieldRenderer: (renderer: FieldRenderer) => void;
  /** Report transform contract failures to the owning runtime event channel. */
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

interface OwnedSubscription {
  readonly kind: 'on' | 'once';
  readonly event: keyof LivePreviewEventMap;
  readonly handler: EventHandler<unknown>;
  dispose: Unsubscribe;
}

interface ScopedResource {
  readonly acquire: (() => PluginDisposer | undefined) | undefined;
  readonly finalize: (() => void) | undefined;
  cleanup: PluginDisposer | undefined;
  disposed: boolean;
}

const noopDisposer: PluginDisposer = () => undefined;

function isPluginDisposer(value: unknown): value is PluginDisposer {
  return typeof value === 'function';
}

/** Registration-local collection of exact, idempotent cleanup handles. */
class ResourceScope {
  readonly #pluginName: string;
  readonly #log: (...args: unknown[]) => void;
  // A Set preserves registration order for commit/reverse teardown while
  // allowing short-lived internal resources (notably once listeners) to leave
  // the scope immediately instead of accumulating until plugin removal.
  readonly #resources = new Set<ScopedResource>();
  #state: 'staging' | 'committing' | 'active' | 'closed' = 'staging';

  constructor(pluginName: string, log: (...args: unknown[]) => void) {
    this.#pluginName = pluginName;
    this.#log = log;
  }

  assertOpen(): void {
    if (this.#state === 'closed') {
      throw new Error(`Plugin context for "${this.#pluginName}" is no longer active`);
    }
  }

  get active(): boolean {
    return this.#state === 'active';
  }

  /** Whether retained facade operations still belong to this registration. */
  eligible(): boolean {
    return this.#state !== 'closed';
  }

  /** Own a resource that the plugin itself already acquired. */
  own(cleanup: PluginDisposer): PluginDisposer {
    this.assertOpen();
    return this.#track({
      acquire: undefined,
      finalize: undefined,
      cleanup,
      disposed: false,
    });
  }

  /**
   * Stage a manager-owned resource until init commits. Active contexts acquire
   * later registrations immediately; retained closed contexts are rejected.
   */
  stage(acquire: () => PluginDisposer | undefined, finalize?: () => void): PluginDisposer {
    this.assertOpen();
    const resource: ScopedResource = {
      acquire,
      finalize,
      cleanup: undefined,
      disposed: false,
    };
    const dispose = this.#track(resource);
    if (this.#state === 'active') {
      try {
        this.#activate(resource);
      } catch (error) {
        this.#dispose(resource);
        throw error;
      }
    }
    return dispose;
  }

  /** Atomically publish every context registration after init succeeds. */
  commit(): void {
    if (this.#state !== 'staging') {
      throw new Error(`Plugin context for "${this.#pluginName}" cannot be committed`);
    }
    this.#state = 'committing';
    try {
      for (const resource of this.#resources) this.#activate(resource);
      this.#state = 'active';
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    if (this.#state === 'closed') return;
    this.#state = 'closed';
    for (const resource of [...this.#resources].reverse()) this.#dispose(resource);
    this.#resources.clear();
  }

  #track(resource: ScopedResource): PluginDisposer {
    this.#resources.add(resource);
    return (): void => {
      this.#dispose(resource);
    };
  }

  #activate(resource: ScopedResource): void {
    if (resource.disposed || resource.cleanup !== undefined || resource.acquire === undefined) {
      return;
    }
    const cleanup = resource.acquire();
    resource.cleanup = cleanup ?? noopDisposer;
  }

  #dispose(resource: ScopedResource): void {
    if (resource.disposed) return;
    resource.disposed = true;
    this.#resources.delete(resource);
    const cleanup = resource.cleanup;
    resource.cleanup = undefined;
    if (cleanup !== undefined) {
      try {
        // TypeScript's `void` callback convention still permits a JavaScript
        // implementation to return a value. View it through an unknown-return
        // boundary so accidental thenables can be observed without awaiting.
        const cleanupWithResult: () => unknown = cleanup;
        const result = cleanupWithResult();
        if (observeThenableResult(result)) {
          this.#log(
            `plugin "${this.#pluginName}" cleanup returned a Promise/thenable; cleanups must be synchronous`,
          );
        }
      } catch (error) {
        this.#log(`plugin "${this.#pluginName}" cleanup failed:`, error);
      }
    }
    try {
      resource.finalize?.();
    } catch (error) {
      this.#log(`plugin "${this.#pluginName}" cleanup failed:`, error);
    }
  }
}

/** Event facade that wraps handler identity and owns only this scope's handles. */
class ScopedPluginEvents extends EventEmitter implements PluginEvents {
  readonly #events: EventEmitter;
  readonly #scope: ResourceScope;
  readonly #subscriptions = new Set<OwnedSubscription>();

  constructor(events: EventEmitter, scope: ResourceScope) {
    super();
    this.#events = events;
    this.#scope = scope;
  }

  override on<E extends keyof LivePreviewEventMap>(
    event: E,
    handler: EventHandler<LivePreviewEventMap[E]>,
  ): Unsubscribe {
    return this.#subscribe('on', event, handler);
  }

  override once<E extends keyof LivePreviewEventMap>(
    event: E,
    handler: EventHandler<LivePreviewEventMap[E]>,
  ): Unsubscribe {
    return this.#subscribe('once', event, handler);
  }

  override off<E extends keyof LivePreviewEventMap>(
    event: E,
    handler: EventHandler<LivePreviewEventMap[E]>,
  ): void {
    const untypedHandler = handler as EventHandler<unknown>;
    for (const subscription of [...this.#subscriptions]) {
      if (subscription.event === event && subscription.handler === untypedHandler) {
        subscription.dispose();
      }
    }
  }

  override emit<E extends keyof LivePreviewEventMap>(
    event: E,
    payload: LivePreviewEventMap[E],
  ): Promise<void> {
    this.#scope.assertOpen();
    return this.#events.emit(event, payload);
  }

  override emitWhile<E extends keyof LivePreviewEventMap>(
    event: E,
    payload: LivePreviewEventMap[E],
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    this.#scope.assertOpen();
    return this.#events.emitWhile(event, payload, () => {
      if (!this.#scope.eligible()) return false;
      const callerEligible = shouldContinue();
      // The caller predicate is arbitrary, re-entrant plugin code. It may close
      // this scope before returning, so eligibility must bracket its invocation.
      if (!this.#scope.eligible()) return false;
      return callerEligible;
    });
  }

  override listenerCount(event: keyof LivePreviewEventMap): number {
    let count = 0;
    for (const subscription of this.#subscriptions) {
      if (subscription.event === event) count += 1;
    }
    return count;
  }

  override removeAllListeners(event?: keyof LivePreviewEventMap): void {
    for (const subscription of [...this.#subscriptions]) {
      if (event === undefined || subscription.event === event) subscription.dispose();
    }
  }

  override eventNames(): (keyof LivePreviewEventMap)[] {
    const names = new Set<keyof LivePreviewEventMap>();
    for (const subscription of this.#subscriptions) names.add(subscription.event);
    return [...names];
  }

  #subscribe<E extends keyof LivePreviewEventMap>(
    kind: 'on' | 'once',
    event: E,
    handler: EventHandler<LivePreviewEventMap[E]>,
  ): Unsubscribe {
    this.#scope.assertOpen();

    const untypedHandler = handler as EventHandler<unknown>;
    const existing = [...this.#subscriptions].find(
      (subscription) =>
        subscription.kind === kind &&
        subscription.event === event &&
        subscription.handler === untypedHandler,
    );
    if (existing !== undefined) return existing.dispose;

    // Each scope gets a distinct wrapper even when two plugins pass the same
    // handler reference. EventEmitter's Set-based storage can therefore revoke
    // one plugin without accidentally revoking the other.
    let dispose = noopDisposer;
    let subscriptionActive = true;
    const wrapped: EventHandler<LivePreviewEventMap[E]> = async (payload) => {
      if (!this.#scope.active || !subscriptionActive) return;
      // The base emitter removes its once bucket before dispatch. Mirror that
      // timing in scoped introspection and release ownership before invoking
      // arbitrary/re-entrant plugin code.
      if (kind === 'once') dispose();
      await handler(payload);
    };
    const subscription: OwnedSubscription = {
      kind,
      event,
      handler: untypedHandler,
      dispose: noopDisposer,
    };
    dispose = this.#scope.stage(
      () => this.#events[kind](event, wrapped),
      () => {
        subscriptionActive = false;
        this.#subscriptions.delete(subscription);
      },
    );
    subscription.dispose = dispose;
    this.#subscriptions.add(subscription);
    return dispose;
  }
}

export class PluginManager {
  readonly #events: EventEmitter;
  readonly #config: Readonly<Record<string, unknown>>;
  // JavaScript preserves an expression callback's actual return even when its
  // public TypeScript contract is void. The client host uses that internal
  // channel for exact renderer ownership; other legacy return values are ignored.
  readonly #registerRenderer: (renderer: FieldRenderer) => unknown;
  readonly #onTransformError: ((error: Error) => void) | undefined;
  readonly #log: (...args: unknown[]) => void;
  readonly #plugins = new Map<string, PluginRegistration>();
  readonly #initializing = new Map<string, InitializingPluginRegistration>();
  readonly #teardowns = new Map<string, Promise<void>>();
  readonly #destroying = new Set<string>();
  readonly #transforms = new Map<string, TransformRegistration[]>();
  #mutationQueue: Promise<void> = Promise.resolve();
  #hookDepth = 0;

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
            const error = args[0];
            if (!(error instanceof Error)) return undefined;
            try {
              return onTransformError(error);
            } catch (reportError) {
              // Preserve the existing best-effort diagnostic for synchronous
              // reporter failures; the outer isolation also observes rejected
              // Promises and hostile thenables without changing transform flow.
              this.#log('transform error reporter failed:', reportError);
              return undefined;
            }
          });
  }

  /** Register a plugin transactionally. Concurrent mutations run in call order. */
  register(plugin: LivePreviewPlugin): Promise<void> {
    if (this.#hookDepth > 0) return this.#registerNow(plugin);
    return this.#enqueue(() => this.#registerNow(plugin));
  }

  /** Remove one plugin and every resource created by its registration. */
  unregister(name: string): Promise<void> {
    if (this.#hookDepth > 0) return this.#unregisterNow(name);
    return this.#enqueue(async () => {
      await this.#unregisterNow(name);
    });
  }

  /** Destroy every active registration without allowing one failure to strand another. */
  destroyAll(): Promise<void> {
    if (this.#hookDepth > 0) return this.#destroyAllNow();
    return this.#enqueue(async () => {
      await this.#destroyAllNow();
    });
  }

  /**
   * Apply active transforms in registration order. A failure stops the chain
   * and returns the original merged value, never a partially transformed one.
   */
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
        // A transform may synchronously cause a newer live-preview message to
        // be accepted. Observe an invalid Promise to prevent a global
        // rejection, but do not report it or invoke another plugin for work
        // that no longer owns the active lifecycle revision.
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

  /** Names of currently registered plugins. */
  list(): readonly string[] {
    return [...this.#plugins.keys()];
  }

  /** Test introspection — number of active plugins. */
  get size(): number {
    return this.#plugins.size;
  }

  async #registerNow(plugin: LivePreviewPlugin): Promise<void> {
    if (
      this.#plugins.has(plugin.name) ||
      this.#initializing.has(plugin.name) ||
      this.#teardowns.has(plugin.name)
    ) {
      this.#log(`plugin "${plugin.name}" already registered`);
      return;
    }

    const scope = new ResourceScope(plugin.name, this.#log);
    const context = this.#createContext(plugin.name, scope);
    const initializing: InitializingPluginRegistration = { scope, cancelled: false };
    this.#initializing.set(plugin.name, initializing);
    try {
      await this.#runHook(() => plugin.init(context));
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

  #createContext(pluginName: string, scope: ResourceScope): PluginContext {
    return {
      events: new ScopedPluginEvents(this.#events, scope),
      registerFieldRenderer: (renderer) => {
        scope.stage(() => {
          const result = this.#registerRenderer(renderer);
          return isPluginDisposer(result) ? result : undefined;
        });
      },
      registerTransform: (fieldName, transform) => {
        const registration: TransformRegistration = { transform, active: false };
        scope.stage(() => {
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

  #unregisterNow(name: string): Promise<void> {
    const initializing = this.#initializing.get(name);
    if (initializing !== undefined) {
      initializing.cancelled = true;
      initializing.scope.close();
      return Promise.resolve();
    }

    const existingTeardown = this.#teardowns.get(name);
    if (existingTeardown !== undefined) {
      // A destroy hook awaiting unregister(its own name) cannot await the
      // teardown promise that is awaiting that hook. Its owned resources were
      // already revoked before destroy began, so redundant removals made while
      // that hook is active are complete and resolve immediately.
      if (this.#destroying.has(name)) return Promise.resolve();
      return existingTeardown;
    }
    const registration = this.#plugins.get(name);
    if (registration === undefined) return Promise.resolve();

    // Make the registration inactive and revoke its context before invoking
    // consumer code. A throwing destroy hook therefore cannot retain access.
    this.#plugins.delete(name);
    registration.scope.close();
    // Publish the in-flight name reservation before entering arbitrary destroy
    // code. A destroy hook may synchronously try to register the same name; that
    // attempt must remain a duplicate until this teardown has fully settled.
    const teardown = Promise.resolve().then(() => this.#destroyPlugin(name, registration.plugin));
    this.#teardowns.set(name, teardown);
    void teardown.then(() => {
      if (this.#teardowns.get(name) === teardown) this.#teardowns.delete(name);
    });
    return teardown;
  }

  async #destroyPlugin(name: string, plugin: LivePreviewPlugin): Promise<void> {
    if (plugin.destroy === undefined) return;
    this.#destroying.add(name);
    try {
      await this.#runHook(() => plugin.destroy?.());
    } catch (error) {
      this.#log(`plugin "${name}" destroy failed:`, error);
    } finally {
      this.#destroying.delete(name);
    }
  }

  async #destroyAllNow(): Promise<void> {
    for (const initializing of this.#initializing.values()) {
      initializing.cancelled = true;
      initializing.scope.close();
    }
    const names = [...this.#plugins.keys()];
    for (const name of names) await this.#unregisterNow(name);
  }

  async #runHook(hook: () => void | Promise<void>): Promise<void> {
    this.#hookDepth += 1;
    try {
      await hook();
    } finally {
      this.#hookDepth -= 1;
    }
  }

  #enqueue(operation: () => void | Promise<void>): Promise<void> {
    const result = this.#mutationQueue.then(operation);
    // Keep the internal tail usable even if an unexpected manager error
    // escapes. The caller still receives `result` and can observe the error.
    this.#mutationQueue = result.catch((error: unknown) => {
      this.#log('plugin manager mutation failed:', error);
    });
    return result;
  }
}
