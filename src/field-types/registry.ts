/**
 * Field-renderer registry.
 *
 * Maps a `FieldType` to the function that mutates a DOM element with
 * the new value. The registry pattern decouples the lifecycle from the
 * concrete renderers, so:
 *
 *   - Tests can substitute mock renderers.
 *   - Plugins can register custom renderers via the high-level client.
 *   - New field types ship without touching `lifecycle.ts`.
 *
 * The built-in renderers are collected through `registerBuiltinRenderer`
 * from each renderer module. To avoid tree-shaking, the explicit
 * aggregator `buildBuiltinRenderers` accepts an *additional* renderer
 * array — `@field-types/index` invokes it with every concrete renderer
 * so the references stay reachable.
 *
 * @module @field-types/registry
 */

import type { FieldRenderer, FieldType } from '@core/types';

const builtinRenderers = new Map<FieldType, FieldRenderer>();

/**
 * Snapshot the built-in renderer map. Returned object is a fresh,
 * frozen plain object so consumers cannot mutate the registry.
 */
export function buildBuiltinRenderers(
  extras: readonly FieldRenderer[] = [],
): Readonly<Record<string, FieldRenderer>> {
  for (const renderer of extras) builtinRenderers.set(renderer.name, renderer);
  const out: Record<string, FieldRenderer> = {};
  for (const [type, renderer] of builtinRenderers) out[type] = renderer;
  return Object.freeze(out);
}

/**
 * Register a built-in renderer. Called from each individual renderer
 * module's side-effecting registration.
 */
export function registerBuiltinRenderer(renderer: FieldRenderer): void {
  builtinRenderers.set(renderer.name, renderer);
}

/**
 * Test-only helper: clear the built-in renderer map.
 */
export function __resetBuiltinRenderersForTests(): void {
  builtinRenderers.clear();
}
