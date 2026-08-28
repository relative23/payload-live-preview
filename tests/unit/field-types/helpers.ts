import { buildBuiltinRenderers } from '@field-types/index';
import type { CachedElement, FieldRenderer, RenderContext } from '@core/types';

export function makeTarget(
  element: Element,
  overrides: Partial<CachedElement> = {},
): CachedElement {
  return {
    element,
    fieldName: 'f',
    fieldType: 'text',
    ...overrides,
  };
}

export function emptyContext(allFields: Record<string, unknown> = {}): RenderContext {
  return { allFields, locale: 'en-US', schema: undefined };
}

/** A fresh renderer map per call; stateful renderers must not leak between tests. */
export function rendererNamed(name: string): FieldRenderer {
  const renderer = buildBuiltinRenderers()[name];
  if (!renderer) throw new Error(`no renderer for ${name}`);
  return renderer;
}
