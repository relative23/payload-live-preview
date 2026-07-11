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

import type { EventEmitter } from '@events/emitter';
import type { CachedElement, FieldRenderer } from '@core/types';

/**
 * Function that mutates a value before the renderer receives it.
 * Returning a different shape than the input is allowed.
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
  readonly events: EventEmitter;
  readonly registerFieldRenderer: (renderer: FieldRenderer) => void;
  readonly registerTransform: (fieldName: string, transform: FieldTransform) => void;
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
  readonly init: (context: PluginContext) => void | Promise<void>;
  readonly destroy?: () => void | Promise<void>;
}

/**
 * Element-render context required by transforms.
 *
 * Re-exported from `@core/types` for ergonomics.
 */
export type { CachedElement };
