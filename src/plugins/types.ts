/**
 * Plugin system types.
 *
 * Each plugin participates in the live-preview lifecycle through a
 * scoped, per-instance context. Plugins can register custom field
 * renderers, transform incoming values, and subscribe to events —
 * the same primitives the built-in renderers use.
 *
 * The system is intentionally minimal. Anything that can be expressed
 * with an event subscription belongs in `events`, not `plugins`.
 *
 * @module @plugins/types
 */

import type { CachedElement, FieldRenderer } from '@core/types';
import type { EventEmitter } from '@events/emitter';
import type { EventHandler, LivePreviewEventMap, Unsubscribe } from '@events/types';
import type { PluginCompatibility } from './compat';

/** Idempotent handle that releases one plugin-owned resource. */
export type PluginDisposer = () => void;

/**
 * Event subscriptions scoped to one plugin registration.
 *
 * This remains nominally compatible with the pre-1.0.4 `EventEmitter` context
 * type. Its methods are registration-scoped: even bulk removal affects only
 * this plugin's subscriptions, never a consumer's or another plugin's
 * listeners.
 */
export interface PluginEvents extends EventEmitter {
  readonly on: <E extends keyof LivePreviewEventMap>(
    event: E,
    handler: EventHandler<LivePreviewEventMap[E]>,
  ) => Unsubscribe;
  readonly once: <E extends keyof LivePreviewEventMap>(
    event: E,
    handler: EventHandler<LivePreviewEventMap[E]>,
  ) => Unsubscribe;
  readonly off: <E extends keyof LivePreviewEventMap>(
    event: E,
    handler: EventHandler<LivePreviewEventMap[E]>,
  ) => void;
  /** Emit through the owning client's event channel. */
  readonly emit: <E extends keyof LivePreviewEventMap>(
    event: E,
    payload: LivePreviewEventMap[E],
  ) => Promise<void>;
  /**
   * Guarded emit through the owning client channel. Dispatch stops when the
   * caller predicate becomes false or this plugin registration is removed.
   */
  readonly emitWhile: <E extends keyof LivePreviewEventMap>(
    event: E,
    payload: LivePreviewEventMap[E],
    shouldContinue: () => boolean,
  ) => Promise<boolean>;
  /** Number of listeners owned by this plugin registration. */
  readonly listenerCount: (event: keyof LivePreviewEventMap) => number;
  /** Remove only listeners owned by this plugin registration. */
  readonly removeAllListeners: (event?: keyof LivePreviewEventMap) => void;
  /** Event names for which this plugin registration owns listeners. */
  readonly eventNames: () => (keyof LivePreviewEventMap)[];
}

/**
 * Synchronous function that transforms a merged field value while a revision's
 * per-binding scheduler entry is prepared. Transforms run in registration
 * order and each receives the preceding transform's result. The final value is
 * frozen into that entry before later renderer or attribute dispatch;
 * `allFields` remains the merged, untransformed update snapshot.
 *
 * Returning a different shape than the input is allowed, but returning a
 * Promise or other thenable is a contract error. If a transform throws or
 * returns a thenable, the chain stops, the runtime emits an `error` event, and
 * dispatch falls back to the original merged value. That fallback still passes
 * through the normal renderer and attribute security controls.
 */
export type FieldTransform = (
  value: unknown,
  context: {
    readonly fieldName: string;
    readonly element: Element;
    readonly allFields: Record<string, unknown>;
  },
) => unknown;

/**
 * Per-instance plugin context. Replaces the legacy singleton context.
 *
 * Plugins receive a context that is bound to the parent
 * `LivePreviewClient`. They can:
 *
 *   - subscribe via `events.on/once`,
 *   - register field renderers,
 *   - register value transforms,
 *   - read the client's (frozen) configuration,
 *   - log through the client's debug channel.
 */
export interface PluginContext {
  readonly events: PluginEvents;
  /** Register a renderer owned by this plugin registration. */
  readonly registerFieldRenderer: (renderer: FieldRenderer) => void;
  /** Register an ordered transform owned by this plugin registration. */
  readonly registerTransform: (fieldName: string, transform: FieldTransform) => void;
  /**
   * Register any additional synchronous cleanup owned by this registration.
   * The manager invokes it during rollback, `unuse()`, or client destruction.
   * Optional so pre-1.0.4 structural context mocks remain assignable.
   */
  readonly registerCleanup?: (cleanup: PluginDisposer) => void;
  readonly getConfig: () => Readonly<Record<string, unknown>>;
  readonly log: (...args: unknown[]) => void;
}

/**
 * Plugin definition. `init` runs once per registration; `destroy`
 * runs when the plugin is unregistered or the client is destroyed.
 *
 * Both hooks may return a promise; the manager awaits them.
 */
export interface LivePreviewPlugin {
  readonly name: string;
  readonly version?: string;
  /**
   * What the plugin was written for. Checked at registration; a plugin that
   * declares a runtime range this version does not satisfy, or a protocol
   * older than the one this runtime speaks, is refused with a log line.
   */
  readonly compat?: PluginCompatibility;
  readonly init: (context: PluginContext) => void | Promise<void>;
  readonly destroy?: () => void | Promise<void>;
}

/**
 * Element-render context required by transforms.
 *
 * Re-exported from `@core/types` for ergonomics.
 */
export type { CachedElement };
