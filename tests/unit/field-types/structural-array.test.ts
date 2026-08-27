import { describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import { createStructuralArrayRenderer } from '@field-types/structural-array';
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

  it('reconciles an SSR-seeded container on the first update without duplicating children', () => {
    const isolatedRenderer = buildBuiltinRenderers()['structural-array']!;
    const ul = document.createElement('ul');
    ul.innerHTML =
      '<li data-payload-key="1">server a</li>' + '<li data-payload-key="2">server b</li>';

    isolatedRenderer.render(
      target(ul, template),
      [
        { id: 1, label: 'client a' },
        { id: 2, label: 'client b' },
      ],
      ctx(),
    );

    expect([...ul.children].map((el) => el.textContent)).toEqual(['client a', 'client b']);
  });

  it('re-renders unchanged data when the observed item template changes', () => {
    const isolatedRenderer = buildBuiltinRenderers()['structural-array']!;
    const ul = document.createElement('ul');
    const items = [{ id: 1, label: 'same value' }];

    isolatedRenderer.render(target(ul, '<li class="before">{{label}}</li>'), items, ctx());
    isolatedRenderer.render(
      target(ul, '<li class="after">{{label}}</li>'),
      [{ id: 1, label: 'same value' }],
      ctx(),
    );

    expect(ul.firstElementChild?.className).toBe('after');
    expect(ul.firstElementChild?.textContent).toBe('same value');
  });

  it('applies synchronously without delegating authoritative DOM work to View Transitions', () => {
    let capturedWork: (() => void) | undefined;
    const startViewTransition = vi.fn((work: () => void) => {
      capturedWork = work;
      return { finished: Promise.resolve() };
    });
    Reflect.set(document, 'startViewTransition', startViewTransition);
    const isolatedRenderer = buildBuiltinRenderers()['structural-array']!;
    const ul = document.createElement('ul');

    try {
      isolatedRenderer.render(target(ul, template), [{ id: 1, label: 'synchronous' }], ctx());

      expect(ul.textContent).toBe('synchronous');
      expect(startViewTransition).not.toHaveBeenCalled();
      expect(capturedWork).toBeUndefined();
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
    }
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

  it('keeps rendering isolated when the console warning channel throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('hostile console');
    });
    const ul = document.createElement('ul');

    expect(() => {
      renderer.render(
        { element: ul, fieldName: 'items', fieldType: 'structural-array' },
        [{ id: 1, label: 'a' }],
        ctx(),
      );
    }).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('does not warn when a template is provided', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ul = document.createElement('ul');
    renderer.render(target(ul, template), [{ id: 1, label: 'a' }], ctx());
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps diff state per instance: two builds do not share memory', () => {
    // Two independent runtimes (each its own buildBuiltinRenderers()) render
    // the SAME element. If diff state were module-level, instance B would see
    // instance A's "previous" and compute an empty diff, wrongly skipping the
    // rebuild. Genuine per-instance state means B rebuilds from scratch.
    const rendererA = buildBuiltinRenderers()['structural-array']!;
    const rendererB = buildBuiltinRenderers()['structural-array']!;
    expect(rendererA).not.toBe(rendererB);

    const ul = document.createElement('ul');
    const items = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ];
    rendererA.render(target(ul, template), items, ctx());
    expect([...ul.children].map((c) => c.textContent)).toEqual(['a', 'b']);

    // Wipe the DOM (as if B mounted on a fresh render of the same node) and
    // feed B the identical array. A module singleton would treat this as a
    // no-op (previous === next) and leave the list empty; per-instance state
    // makes B render the items.
    ul.innerHTML = '';
    rendererB.render(target(ul, template), items, ctx());
    expect([...ul.children].map((c) => c.textContent)).toEqual(['a', 'b']);
  });
});

describe('key diagnostics (ADR 0008 §5)', () => {
  function harness(template = '<li>{{title}}</li>') {
    document.body.innerHTML = '<ul data-payload-field="rows" data-payload-structural></ul>';
    const element = document.body.firstElementChild!;
    const renderer = createStructuralArrayRenderer();
    const target = {
      element,
      fieldName: 'rows',
      fieldType: 'structural-array',
      arrayTemplate: template,
    } as unknown as Parameters<typeof renderer.render>[0];
    const context = { allFields: {}, locale: undefined, schema: undefined };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return { render: (value: unknown) => renderer.render(target, value, context), warn, element };
  }

  it('warns once per container when an item has no id (LP0404)', () => {
    const { render, warn } = harness();
    render([{ title: 'a' }, { title: 'b' }]);
    render([{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('LP0404'));
    expect(hits).toHaveLength(1);
    warn.mockRestore();
  });

  it('warns once when every key changed at once (LP0406)', () => {
    const { render, warn } = harness();
    render([
      { id: 1, title: 'a' },
      { id: 2, title: 'b' },
    ]);
    render([
      { id: 3, title: 'a' },
      { id: 4, title: 'b' },
    ]);
    render([
      { id: 5, title: 'a' },
      { id: 6, title: 'b' },
    ]);
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('LP0406'));
    expect(hits).toHaveLength(1);
    warn.mockRestore();
  });

  it('warns once when two items share a key (LP0405) and keeps rendering', () => {
    const { render, warn, element } = harness();
    render([
      { id: 'x', title: 'first' },
      { id: 'x', title: 'second' },
    ]);
    render([
      { id: 'x', title: 'FIRST' },
      { id: 'x', title: 'SECOND' },
    ]);
    render([
      { id: 'x', title: 'F' },
      { id: 'x', title: 'S' },
    ]);
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('LP0405'));
    expect(hits).toHaveLength(1);
    expect(Array.from(element.children, (li) => li.textContent)).toEqual(['F', 'S']);
    warn.mockRestore();
  });
});
