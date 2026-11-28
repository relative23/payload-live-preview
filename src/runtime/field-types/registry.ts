/**
 * Explicit renderer overrides, layered above the defaults each time a map is
 * built. The registry never retains the defaults, so stateful ones can be
 * recreated per client.
 */

import type { FieldRenderer, RendererKey } from '@core/types';

const builtinRenderers = new Map<RendererKey, FieldRenderer>();

export function buildBuiltinRenderers(
  defaults: readonly FieldRenderer[] = [],
): Readonly<Record<string, FieldRenderer>> {
  const out: Record<string, FieldRenderer> = {};
  for (const renderer of defaults) out[renderer.name] = renderer;
  for (const [type, renderer] of builtinRenderers) out[type] = renderer;
  return Object.freeze(out);
}

/** Register or replace an override for maps built afterwards. */
export function registerBuiltinRenderer(renderer: FieldRenderer): void {
  builtinRenderers.set(renderer.name, renderer);
}

/** Test-only: clear the overrides. */
export function __resetBuiltinRenderersForTests(): void {
  builtinRenderers.clear();
}
