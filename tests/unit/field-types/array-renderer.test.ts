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

/**
 * The fidelity oracle measured this on the Astro fixture: the rebuilt `<li>`
 * elements lost `data-astro-cid-…`, the marker the scoped styles hang on, so
 * the patched list was styled differently from the one the server sent — and
 * the write itself succeeded, so nothing in the runtime could notice.
 */
describe('array renderer — what the item template does not carry', () => {
  function list(itemsHtml: string): HTMLUListElement {
    const ul = document.createElement('ul');
    ul.innerHTML = itemsHtml;
    return ul;
  }

  function render(el: Element, value: unknown, template = '<li>{{value}}</li>'): void {
    rendererNamed('array').render(
      makeTarget(el, { arrayTemplate: template }),
      value,
      emptyContext(),
    );
  }

  it("keeps the framework's scoped-style marker on every rebuilt item", () => {
    const ul = list(
      '<li data-astro-cid-j7pv25f6>astro</li><li data-astro-cid-j7pv25f6>payload</li>',
    );

    render(ul, ['astro', 'payload', 'live-preview']);

    expect([...ul.children].map((li) => li.getAttribute('data-astro-cid-j7pv25f6'))).toEqual([
      '',
      '',
      '',
    ]);
  });

  it('carries a scoped class the same way, without knowing which framework wrote it', () => {
    const svelte = list('<li class="svelte-1abcde">one</li><li class="svelte-1abcde">two</li>');
    const vue = list('<li data-v-7ba5bd90>one</li>');

    render(svelte, ['one', 'two']);
    render(vue, ['one', 'two']);

    expect([...svelte.children].map((li) => li.getAttribute('class'))).toEqual([
      'svelte-1abcde',
      'svelte-1abcde',
    ]);
    expect([...vue.children].map((li) => li.getAttribute('data-v-7ba5bd90'))).toEqual(['', '']);
  });

  it("carries only what every item shares, never one row's own state", () => {
    const ul = list(
      '<li data-astro-cid-x data-index="0">one</li><li data-astro-cid-x data-index="1">two</li>',
    );

    render(ul, ['one', 'two']);

    expect(ul.children[0]?.hasAttribute('data-index')).toBe(false);
    expect(ul.children[0]?.getAttribute('data-astro-cid-x')).toBe('');
  });

  it('leaves the template in charge of an attribute it writes itself', () => {
    const ul = list('<li class="old">one</li>');

    render(ul, ['one'], '<li class="new">{{value}}</li>');

    expect(ul.children[0]?.getAttribute('class')).toBe('new');
  });

  it('refuses the attributes no write of ours may set', () => {
    const ul = list(
      '<li id="first" name="row" style="color:red" onclick="boom()" data-payload-key="7">one</li>',
    );

    render(ul, ['one']);

    const item = ul.children[0];
    for (const name of ['id', 'name', 'style', 'onclick', 'data-payload-key']) {
      expect(item?.hasAttribute(name), `${name} must not be carried over`).toBe(false);
    }
  });

  it('has nothing to carry when the list starts empty', () => {
    const ul = list('');

    render(ul, ['one']);

    expect(ul.children[0]?.attributes).toHaveLength(0);
  });
});
