import { describe, expect, it, vi } from 'vitest';
import { RendererRegistry } from '@plugins/renderer-registry';
import type { FieldRenderer } from '@core/types';

function renderer(name: FieldRenderer['name']): FieldRenderer {
  return { name, render: vi.fn() };
}

describe('RendererRegistry', () => {
  it('keeps a stable live map and restores layers in stack order', () => {
    const base = renderer('text');
    const lower = renderer('text');
    const upper = renderer('text');
    const registry = new RendererRegistry({ text: base });
    const liveMap = registry.renderers;

    const disposeLower = registry.register(lower);
    const disposeUpper = registry.register(upper);
    expect(registry.renderers).toBe(liveMap);
    expect(registry.resolve('text')).toBe(upper);

    disposeLower();
    expect(registry.resolve('text')).toBe(upper);
    disposeUpper();
    expect(registry.resolve('text')).toBe(base);
  });

  it('deletes a plugin-only renderer and makes its disposer idempotent', () => {
    const registry = new RendererRegistry({});
    const pluginRenderer = renderer('text');
    const dispose = registry.register(pluginRenderer);
    expect(registry.resolve('text')).toBe(pluginRenderer);

    dispose();
    dispose();

    expect(registry.resolve('text')).toBeUndefined();
    expect('text' in registry.renderers).toBe(false);
  });

  it('reveals the preceding plugin layer when no built-in base exists', () => {
    const registry = new RendererRegistry({});
    const lower = renderer('text');
    const upper = renderer('text');
    const disposeLower = registry.register(lower);
    const disposeUpper = registry.register(upper);

    disposeUpper();
    expect(registry.resolve('text')).toBe(lower);
    disposeLower();
    expect(registry.resolve('text')).toBeUndefined();
  });
});
