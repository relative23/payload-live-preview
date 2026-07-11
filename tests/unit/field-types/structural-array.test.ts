import { describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import type { CachedElement, RenderContext } from '@core/types';

function target(element: Element, template: string): CachedElement {
  return {
    element,
    fieldName: 'items',
    fieldType: 'structural-array',
    arrayTemplate: template,
  };
}

function ctx(allFields: Record<string, unknown> = {}): RenderContext {
  return { allFields, locale: 'en', schema: undefined };
}

describe('structural-array renderer', () => {
  const renderers = buildBuiltinRenderers();
  const renderer = renderers['structural-array']!;
  const template = '<li>{{label}}</li>';

  it('renders initial items', () => {
    const ul = document.createElement('ul');
    renderer.render(
      target(ul, template),
      [
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
      ],
      ctx(),
    );
    expect([...ul.children].map((el) => el.textContent)).toEqual(['a', 'b']);
  });

  it('keeps existing DOM nodes across reorders', () => {
    const ul = document.createElement('ul');
    const items = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ];
    renderer.render(target(ul, template), items, ctx());
    const second = ul.children[1];
    renderer.render(target(ul, template), [items[1]!, items[0]!, items[2]!], ctx());
    expect(ul.children[0]).toBe(second);
  });

  it('ignores non-array values', () => {
    const ul = document.createElement('ul');
    ul.innerHTML = '<li>seed</li>';
    renderer.render(target(ul, template), 'not an array', ctx());
    expect(ul.children).toHaveLength(1);
  });

  it('skips when no template is provided', () => {
    const ul = document.createElement('ul');
    renderer.render(
      { element: ul, fieldName: 'x', fieldType: 'structural-array' },
      [{ id: 1, label: 'a' }],
      ctx(),
    );
    expect(ul.children).toHaveLength(0);
  });

  it('warns once when the template attribute is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ul = document.createElement('ul');
    const noTemplate: CachedElement = {
      element: ul,
      fieldName: 'items',
      fieldType: 'structural-array',
    };
    renderer.render(noTemplate, [{ id: 1, label: 'a' }], ctx());
    renderer.render(noTemplate, [{ id: 2, label: 'b' }], ctx());
    renderer.render(noTemplate, [{ id: 3, label: 'c' }], ctx());
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/data-payload-array-template/);
    warn.mockRestore();
  });

  it('does not warn when a template is provided', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ul = document.createElement('ul');
    renderer.render(target(ul, template), [{ id: 1, label: 'a' }], ctx());
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
