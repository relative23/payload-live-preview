import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FieldRenderer } from '@core/types';
import {
  __resetBuiltinRenderersForTests,
  buildBuiltinRenderers,
  registerBuiltinRenderer,
} from '@field-types/index';
import { RendererRegistry } from '@plugins/renderer-registry';

afterEach(() => {
  __resetBuiltinRenderersForTests();
});

describe('built-in field renderer assembly', () => {
  it('keeps void-returning custom renderers assignable to the 1.x contract', () => {
    const legacyRenderer: FieldRenderer = {
      name: 'text',
      render() {},
    };

    expect(
      legacyRenderer.render(
        { element: document.createElement('p'), fieldName: 'title', fieldType: 'text' },
        'value',
        { allFields: {}, locale: undefined, schema: undefined },
      ),
    ).toBeUndefined();
  });

  it('keeps incidental value-returning custom renderers assignable to the 1.x void contract', () => {
    const legacyRenderer: FieldRenderer = {
      name: 'text',
      render: () => 'legacy return value',
    };

    expect(legacyRenderer.name).toBe('text');
  });

  it('assembles every default renderer without relying on import side effects', () => {
    const renderers = buildBuiltinRenderers();

    for (const type of [
      'text',
      'textarea',
      'richText',
      'html',
      'url',
      'email',
      'image',
      'upload',
      'relationship',
      'select',
      'radio',
      'checkbox',
      'date',
      'number',
      'array',
      'blocks',
      'structural-array',
    ]) {
      expect(renderers[type], type).toBeDefined();
    }
  });

  it('keeps an explicitly registered override above the default layer', () => {
    const override: FieldRenderer = {
      name: 'text',
      render: () => undefined,
    };
    registerBuiltinRenderer(override);

    expect(buildBuiltinRenderers()['text']).toBe(override);
  });

  it('restores an explicit override after a plugin renderer layer is removed', () => {
    const override: FieldRenderer = { name: 'text', render: () => undefined };
    const plugin: FieldRenderer = { name: 'text', render: () => undefined };
    registerBuiltinRenderer(override);
    const registry = new RendererRegistry(buildBuiltinRenderers());

    const dispose = registry.register(plugin);
    expect(registry.resolve('text')).toBe(plugin);

    dispose();
    expect(registry.resolve('text')).toBe(override);
  });

  it('does not mutate the registry when a renderer module is imported directly', async () => {
    vi.resetModules();
    const registry = await import('@field-types/registry');
    const override: FieldRenderer = {
      name: 'text',
      render: () => undefined,
    };
    registry.registerBuiltinRenderer(override);

    await import('@field-types/text');

    expect(registry.buildBuiltinRenderers()['text']).toBe(override);
  });

  it('creates fresh stateful structural renderers for independent clients', () => {
    const first = buildBuiltinRenderers()['structural-array'];
    const second = buildBuiltinRenderers()['structural-array'];

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  it('keeps text-renderer warning deduplication local to each client snapshot', () => {
    const first = buildBuiltinRenderers()['text'];
    const second = buildBuiltinRenderers()['text'];
    if (first === undefined || second === undefined) throw new Error('text renderer missing');
    const element = document.createElement('h1');
    element.appendChild(document.createElement('span'));
    const target = { element, fieldName: 'title', fieldType: 'text' } as const;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      first.render(target, 'first', { allFields: {}, locale: undefined, schema: undefined });
      second.render(target, 'second', { allFields: {}, locale: undefined, schema: undefined });

      expect(first).not.toBe(second);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
