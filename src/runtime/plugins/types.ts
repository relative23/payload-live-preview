/** Plugin contract: a scoped, per-instance context for renderers, transforms and events. */

import type { CachedElement, FieldRenderer } from '@core/types';
import type { EventHandler, LivePreviewEventMap, Unsubscribe } from '@events/types';
import type { PluginCompatibility } from './compat';

/** Idempotent handle that releases one plugin-owned resource. */
export type PluginDisposer = () => void;

/** The client's event surface scoped to one registration: bulk removal and introspection see only this plugin's listeners. */
export interface PluginEvents {
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
  /** Guarded emit; dispatch stops when the predicate turns false or this registration is removed. */
  readonly emitWhile: <E extends keyof LivePreviewEventMap>(
    event: E,
    payload: LivePreviewEventMap[E],
    shouldContinue: () => boolean,
  ) => Promise<boolean>;
  readonly listenerCount: (event: keyof LivePreviewEventMap) => number;
  readonly removeAllListeners: (event?: keyof LivePreviewEventMap) => void;
  readonly eventNames: () => (keyof LivePreviewEventMap)[];
}

/**
 * Synchronous value transform run in registration order; returning a thenable
 * is a contract error (`LP0602`) that dispatches the untransformed value.
 */
export type FieldTransform = (
  value: unknown,
  context: {
    readonly fieldName: string;
    readonly element: Element;
    readonly allFields: Record<string, unknown>;
  },
) => unknown;

export interface PluginContext {
  readonly events: PluginEvents;
  /** Register a renderer layer owned by this registration. */
  readonly registerFieldRenderer: (renderer: FieldRenderer) => void;
  /** Register an ordered transform owned by this registration. */
  readonly registerTransform: (fieldName: string, transform: FieldTransform) => void;
  /** Register a synchronous cleanup run on rollback, `unuse()` and client destruction. */
  readonly registerCleanup?: (cleanup: PluginDisposer) => void;
  readonly getConfig: () => Readonly<Record<string, unknown>>;
  readonly log: (...args: unknown[]) => void;
}

/** `init` runs once per registration, `destroy` on removal; both may return a promise. */
export interface LivePreviewPlugin {
  readonly name: string;
  readonly version?: string;
  /** Checked at registration; a plugin this runtime does not fit is refused (`LP0103`). */
  readonly compat?: PluginCompatibility;
  readonly init: (context: PluginContext) => void | Promise<void>;
  readonly destroy?: () => void | Promise<void>;
}

export type { CachedElement };
