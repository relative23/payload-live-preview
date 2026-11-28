/**
 * Per-client renderer layers: built-ins are the base, plugin registrations
 * stack above per field type, and removing a layer by identity reveals the
 * one beneath. See ADR 0005.
 */

import type { FieldRenderer, RendererKey } from '@core/types';
import type { PluginDisposer } from './types';

interface RendererLayer {
  readonly renderer: FieldRenderer;
}

export class RendererRegistry {
  readonly #base: Readonly<Record<string, FieldRenderer>>;
  readonly #active: Record<string, FieldRenderer>;
  readonly #layers = new Map<RendererKey, RendererLayer[]>();

  constructor(base: Readonly<Record<string, FieldRenderer>>) {
    this.#base = base;
    this.#active = { ...base };
  }

  /** Stable live map, retained for the runtime's `renderers` option. */
  get renderers(): Readonly<Record<string, FieldRenderer>> {
    return this.#active;
  }

  resolve(fieldType: RendererKey): FieldRenderer | undefined {
    return this.#active[fieldType];
  }

  register(renderer: FieldRenderer): PluginDisposer {
    const fieldType = renderer.name;
    const layer: RendererLayer = { renderer };
    const stack = this.#layers.get(fieldType);
    if (stack === undefined) this.#layers.set(fieldType, [layer]);
    else stack.push(layer);
    this.#active[fieldType] = renderer;

    let active = true;
    return () => {
      if (!active) return;
      active = false;

      const current = this.#layers.get(fieldType);
      if (current === undefined) return;
      const index = current.indexOf(layer);
      if (index < 0) return;
      const wasTop = index === current.length - 1;
      current.splice(index, 1);
      if (current.length === 0) this.#layers.delete(fieldType);
      if (!wasTop) return;

      const previousLayer = current.at(-1);
      const previousRenderer = previousLayer?.renderer ?? this.#base[fieldType];
      if (previousRenderer === undefined) Reflect.deleteProperty(this.#active, fieldType);
      else this.#active[fieldType] = previousRenderer;
    };
  }
}
