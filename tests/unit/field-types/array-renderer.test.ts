import { beforeEach, describe, expect, it } from 'vitest';
import { setSanitizerPolicy } from '@security/sanitizer';
import { emptyContext, makeTarget, rendererNamed } from './helpers';

beforeEach(() => {
  setSanitizerPolicy('strict');
});

describe('array renderer', () => {
  it('joins primitives with separator', () => {
    const el = document.createElement('span');
    rendererNamed('array').render(makeTarget(el), ['a', 'b', 'c'], emptyContext());
    expect(el.textContent).toBe('a, b, c');
  });

  it('uses custom separator', () => {
    const el = document.createElement('span');
    rendererNamed('array').render(
      makeTarget(el, { arraySeparator: ' | ' }),
      ['a', 'b'],
      emptyContext(),
    );
    expect(el.textContent).toBe('a | b');
  });

  it('JSON-stringifies object items in fallback mode', () => {
    const el = document.createElement('span');
    rendererNamed('array').render(makeTarget(el), [{ x: 1 }, { x: 2 }], emptyContext());
    expect(el.textContent).toBe('{"x":1}, {"x":2}');
  });

  it('renders items with template', () => {
    const el = document.createElement('ul');
    rendererNamed('array').render(
      makeTarget(el, { arrayTemplate: '<li>{{title}}</li>' }),
      [{ title: 'one' }, { title: 'two' }],
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<li>one</li>');
    expect(el.innerHTML).toContain('<li>two</li>');
  });

  it('renders primitives via {{value}}', () => {
    const el = document.createElement('ul');
    rendererNamed('array').render(
      makeTarget(el, { arrayTemplate: '<li>{{value}}</li>' }),
      ['a', 'b'],
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<li>a</li>');
    expect(el.innerHTML).toContain('<li>b</li>');
  });

  it('exposes {{index}}', () => {
    const el = document.createElement('div');
    rendererNamed('array').render(
      makeTarget(el, { arrayTemplate: '<span>{{index}}</span>' }),
      ['a', 'b'],
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<span>0</span>');
    expect(el.innerHTML).toContain('<span>1</span>');
  });

  it('escapes template field values', () => {
    const el = document.createElement('div');
    rendererNamed('array').render(
      makeTarget(el, { arrayTemplate: '<span>{{title}}</span>' }),
      [{ title: '<script>x</script>' }],
      emptyContext(),
    );
    expect(el.innerHTML).not.toContain('<script>');
    expect(el.innerHTML).toContain('&lt;script&gt;');
  });

  it.each(['$&', '$$', '$`', "$'"])(
    'renders replacement metasequence %s literally in object templates',
    (value) => {
      const el = document.createElement('div');
      rendererNamed('array').render(
        makeTarget(el, { arrayTemplate: '<span>{{title}}</span>' }),
        [{ title: value }],
        emptyContext(),
      );
      expect(el.querySelector('span')?.textContent).toBe(value);
    },
  );

  it('does not interpret placeholders introduced by an earlier object-field replacement', () => {
    const el = document.createElement('div');
    rendererNamed('array').render(
      makeTarget(el, { arrayTemplate: '<span>{{title}}</span>' }),
      [{ title: 'literal {{index}} and {{suffix}}', suffix: 'nested replacement' }],
      emptyContext(),
    );
    expect(el.querySelector('span')?.textContent).toBe('literal {{index}} and {{suffix}}');
  });

  it('does not interpret placeholders introduced by a primitive replacement', () => {
    const el = document.createElement('div');
    rendererNamed('array').render(
      makeTarget(el, { arrayTemplate: '<span>{{value}}</span>' }),
      ['literal {{index}}'],
      emptyContext(),
    );
    expect(el.querySelector('span')?.textContent).toBe('literal {{index}}');
  });

  it.each(['$&', '$$', '$`', "$'"])(
    'renders replacement metasequence %s literally in primitive templates',
    (value) => {
      const el = document.createElement('div');
      rendererNamed('array').render(
        makeTarget(el, { arrayTemplate: '<span>{{value}}</span>' }),
        [value],
        emptyContext(),
      );
      expect(el.querySelector('span')?.textContent).toBe(value);
    },
  );

  it('ignores non-array values', () => {
    const el = document.createElement('span');
    el.textContent = 'before';
    expect(rendererNamed('array').render(makeTarget(el), 'not-an-array', emptyContext())).toBe(
      false,
    );
    expect(el.textContent).toBe('before');
  });

  it('blocks share the array semantics', () => {
    const el = document.createElement('span');
    rendererNamed('blocks').render(makeTarget(el), ['a', 'b'], emptyContext());
    expect(el.textContent).toBe('a, b');
  });
});
