/**
 * Per-instance plugin manager.
 *
 * Holds the plugins registered on one `LivePreviewClient`. Plugins
 * are isolated from each other and from other client instances —
 * there is no shared global state.
 *
 * @module @plugins/manager
 */

import type { EventEmitter } from '@events/emitter';
import type { FieldRenderer } from '@core/types';
import type { FieldTransform, LivePreviewPlugin, PluginContext } from './types';

export interface PluginManagerOptions {
  readonly events: EventEmitter;
  readonly config: Readonly<Record<string, unknown>>;
  readonly registerFieldRenderer: (renderer: FieldRenderer) => void;
  readonly log: (...args: unknown[]) => void;
}

export class PluginManager {
  readonly #events: EventEmitter;
  readonly #config: Readonly<Record<string, unknown>>;
  readonly #registerRenderer: (renderer: FieldRenderer) => void;
  readonly #log: (...args: unknown[]) => void;
  readonly #plugins = new Map<string, LivePreviewPlugin>();
  readonly #transforms = new Map<string, FieldTransform[]>();

  constructor(options: PluginManagerOptions) {
    this.#events = options.events;
    this.#config = options.config;
    this.#registerRenderer = options.registerFieldRenderer;
    this.#log = options.log;
  }

  /**
   * Register a plugin and run its `init` hook. Duplicate names are
   * ignored (with a debug warning). Errors thrown by `init` are
   * caught and surfaced via the error logger; the plugin is *not*
   * added to the registry in that case.
   */
  async register(plugin: LivePreviewPlugin): Promise<void> {
    if (this.#plugins.has(plugin.name)) {
      this.#log(`plugin "${plugin.name}" already registered`);
      return;
    }
    const context: PluginContext = {
      events: this.#events,
      registerFieldRenderer: (renderer) => {
        this.#registerRenderer(renderer);
      },
      registerTransform: (fieldName, transform) => {
        this.#addTransform(fieldName, transform);
      },
      getConfig: () => this.#config,
      log: (...args) => {
        this.#log(`[${plugin.name}]`, ...args);
      },
    };
    try {
      await plugin.init(context);
      this.#plugins.set(plugin.name, plugin);
      this.#log(`plugin "${plugin.name}" registered`);
    } catch (err) {
      this.#log(`plugin "${plugin.name}" init failed:`, err);
    }
  }

  /**
   * Remove a plugin and call its `destroy` hook.
   */
  async unregister(name: string): Promise<void> {
    const plugin = this.#plugins.get(name);
    if (!plugin) return;
    this.#plugins.delete(name);
    if (plugin.destroy) {
      try {
        await plugin.destroy();
      } catch (err) {
        this.#log(`plugin "${name}" destroy failed:`, err);
      }
    }
  }

  /**
   * Destroy every registered plugin. Used by `LivePreviewClient.destroy`.
   * Errors from individual plugins are isolated.
   */
  async destroyAll(): Promise<void> {
    const names = [...this.#plugins.keys()];
    for (const name of names) await this.unregister(name);
    this.#transforms.clear();
  }

  /**
   * Apply every transform registered for `fieldName` to `value`, in
   * registration order. Returns the transformed value.
   */
  applyTransforms(
    fieldName: string,
    value: unknown,
    context: { readonly element: Element; readonly allFields: Record<string, unknown> },
  ): unknown {
    const transforms = this.#transforms.get(fieldName);
    if (!transforms || transforms.length === 0) return value;
    let result: unknown = value;
    for (const transform of transforms) {
      try {
        result = transform(result, {
          fieldName,
          element: context.element,
          allFields: context.allFields,
        });
      } catch (err) {
        this.#log(`transform for "${fieldName}" threw:`, err);
        return value;
      }
    }
    return result;
  }

  /** Names of currently registered plugins. */
  list(): readonly string[] {
    return [...this.#plugins.keys()];
  }

  /** Test introspection — number of plugins. */
  get size(): number {
    return this.#plugins.size;
  }

  #addTransform(fieldName: string, transform: FieldTransform): void {
    const existing = this.#transforms.get(fieldName);
    if (existing) existing.push(transform);
    else this.#transforms.set(fieldName, [transform]);
  }
}
