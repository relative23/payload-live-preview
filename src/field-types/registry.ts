/**
 * Field-renderer registry.
 *
 * Maps a `RendererKey` to the function that mutates a DOM element with
 * the new value. The registry pattern decouples the lifecycle from the
 * concrete renderers, so:
 *
 *   - Tests can substitute mock renderers.
 *   - Plugins can register custom renderers via the high-level client.
 *   - New field types ship without touching `lifecycle.ts`.
 *
 * The explicit aggregator in `@field-types/index` supplies the default
 * renderers as values, so it remains tree-shaking-safe without module import
 * side effects. This registry stores only explicit consumer overrides.
 *
 * @module @field-types/registry
 */

import type { FieldRenderer, RendererKey } from '@core/types';

const builtinRenderers = new Map<RendererKey, FieldRenderer>();

/**
 * Assemble a fresh renderer map. Defaults are copied first and explicit
 * registrations are layered above them, so `registerBuiltinRenderer()` keeps
 * its documented override semantics. The registry never retains the defaults;
 * stateful defaults can therefore be recreated independently per client.
 */
export function buildBuiltinRenderers(
  defaults: readonly FieldRenderer[] = [],
): Readonly<Record<string, FieldRenderer>> {
  const out: Record<string, FieldRenderer> = {};
  for (const renderer of defaults) out[renderer.name] = renderer;
  for (const [type, renderer] of builtinRenderers) out[type] = renderer;
  return Object.freeze(out);
}

/**
 * Register or replace an explicit renderer override for future snapshots.
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
