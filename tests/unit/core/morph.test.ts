import { describe, expect, it, vi } from 'vitest';
import { isMorphBoundary, isMorphCompatible, morphElement, syncAttributes } from '@core/morph';

/**
 * ADR 0008 made executable: the morph retains live nodes wherever the
 * rendered markup is compatible, edits attributes with the state exception,
 * pairs children by key or position, and never crosses a boundary.
 */

const KEY = 'data-payload-key';
const options = { keyAttributes: [KEY] };

function el(html: string): Element {
  const host = document.createElement('template');
  host.innerHTML = html.trim();
  const first = host.content.firstElementChild;
  if (first === null) throw new Error('no element');
  return first;
}

describe('compatibility and boundaries', () => {
  it('is compatible for the same tag, incompatible across tags', () => {
    expect(isMorphCompatible(el('<li>a</li>'), el('<li>b</li>'))).toBe(true);
    expect(isMorphCompatible(el('<li>a</li>'), el('<div>b</div>'))).toBe(false);
  });

  it('treats custom elements, islands, contenteditable and owned subtrees as boundaries', () => {
    expect(isMorphBoundary(el('<my-widget></my-widget>'))).toBe(true);
    expect(isMorphBoundary(el('<astro-island></astro-island>'))).toBe(true);
    expect(isMorphBoundary(el('<div data-payload-island></div>'))).toBe(true);
    expect(isMorphBoundary(el('<div data-payload-owned></div>'))).toBe(true);
    expect(isMorphBoundary(el('<div contenteditable></div>'))).toBe(true);
    expect(isMorphBoundary(el('<div contenteditable="false"></div>'))).toBe(false);
    expect(isMorphBoundary(el('<div></div>'))).toBe(false);
  });

  it('returns the rendered element when incompatible, without touching the live one', () => {
    const live = el('<li class="keep">a</li>');
    const rendered = el('<div>b</div>');
    expect(morphElement(live, rendered, options)).toBe(rendered);
    expect(live.outerHTML).toBe('<li class="keep">a</li>');
  });
});

describe('attributes', () => {
  it('sets, updates and removes attributes to match the rendered element', () => {
    const live = el('<li class="old" data-x="1" title="t">a</li>');
    syncAttributes(live, el('<li class="new" data-y="2">a</li>'));
    expect(live.getAttribute('class')).toBe('new');
    expect(live.hasAttribute('data-x')).toBe(false);
    expect(live.hasAttribute('title')).toBe(false);
    expect(live.getAttribute('data-y')).toBe('2');
  });

  it('leaves open/value/checked/selected alone unless the template names them', () => {
    const live = el('<details open><summary>s</summary></details>');
    syncAttributes(live, el('<details><summary>s</summary></details>'));
    expect(live.hasAttribute('open')).toBe(true);
    syncAttributes(live, el('<details open="">x</details>'));
    expect(live.hasAttribute('open')).toBe(true);
    const input = el('<input value="typed" checked>');
    syncAttributes(input, el('<input>'));
    expect(input.getAttribute('value')).toBe('typed');
    expect(input.hasAttribute('checked')).toBe(true);
    syncAttributes(input, el('<input value="cms">'));
    expect(input.getAttribute('value')).toBe('cms');
  });
});

describe('children', () => {
  it('retains the element and updates text in place', () => {
    const live = el('<li><span>old</span> text</li>');
    const span = live.querySelector('span');
    const text = live.lastChild;
    const kept = morphElement(live, el('<li><span>new</span> words</li>'), options);
    expect(kept).toBe(live);
    expect(live.querySelector('span')).toBe(span);
    expect(live.lastChild).toBe(text);
    expect(live.innerHTML).toBe('<span>new</span> words');
  });

  it('pairs keyed children by key across a reorder and keeps their identity', () => {
    const live = el(`<ul><li ${KEY}="a">A</li><li ${KEY}="b">B</li><li ${KEY}="c">C</li></ul>`);
    const [a, b, c] = Array.from(live.children);
    morphElement(
      live,
      el(`<ul><li ${KEY}="c">C!</li><li ${KEY}="a">A</li><li ${KEY}="b">B</li></ul>`),
      options,
    );
    expect(Array.from(live.children)).toEqual([c, a, b]);
    expect(c?.textContent).toBe('C!');
  });

  it('inserts new keyed children and removes vanished ones', () => {
    const live = el(`<ul><li ${KEY}="a">A</li><li ${KEY}="b">B</li></ul>`);
    const a = live.firstElementChild;
    morphElement(live, el(`<ul><li ${KEY}="a">A</li><li ${KEY}="z">Z</li></ul>`), options);
    expect(live.firstElementChild).toBe(a);
    expect(live.children[1]?.getAttribute(KEY)).toBe('z');
    expect(live.children).toHaveLength(2);
  });

  it('pairs unkeyed children positionally by kind and replaces a different kind', () => {
    const live = el('<div><p>one</p><span>two</span></div>');
    const p = live.querySelector('p');
    morphElement(live, el('<div><p>uno</p><em>dos</em></div>'), options);
    expect(live.querySelector('p')).toBe(p);
    expect(live.querySelector('em')?.textContent).toBe('dos');
    expect(live.querySelector('span')).toBeNull();
  });

  it('never pairs a keyed child with an unkeyed one', () => {
    const live = el(`<ul><li>plain</li></ul>`);
    const plain = live.firstElementChild;
    morphElement(live, el(`<ul><li ${KEY}="k">keyed</li></ul>`), options);
    expect(live.firstElementChild).not.toBe(plain);
    expect(live.firstElementChild?.getAttribute(KEY)).toBe('k');
    expect(live.children).toHaveLength(1);
  });

  it('degrades later duplicates to positional pairing and reports the key once', () => {
    const onDuplicateKey = vi.fn();
    const live = el(`<ul><li ${KEY}="a">first</li><li ${KEY}="a">second</li></ul>`);
    const [first, second] = Array.from(live.children);
    morphElement(live, el(`<ul><li ${KEY}="a">FIRST</li><li ${KEY}="a">SECOND</li></ul>`), {
      ...options,
      onDuplicateKey,
    });
    expect(onDuplicateKey).toHaveBeenCalledWith(live, 'a');
    expect(first?.textContent).toBe('FIRST');
    expect(live.children[1]).not.toBe(second);
    expect(live.children[1]?.textContent).toBe('SECOND');
  });
});

describe('boundaries inside an item', () => {
  it('keeps a custom element untouched, including its own children and attributes', () => {
    const live = el('<li><x-counter count="5"><b>internal</b></x-counter><span>t</span></li>');
    const counter = live.firstElementChild;
    morphElement(live, el('<li><x-counter count="0"></x-counter><span>u</span></li>'), options);
    expect(live.firstElementChild).toBe(counter);
    expect(counter?.getAttribute('count')).toBe('5');
    expect(counter?.innerHTML).toBe('<b>internal</b>');
    expect(live.querySelector('span')?.textContent).toBe('u');
  });

  it('keeps an island and a contenteditable subtree as they are', () => {
    const live = el(
      '<li><div data-payload-island><i>hydrated</i></div><p contenteditable>typed by the visitor</p></li>',
    );
    const [island, editable] = Array.from(live.children);
    morphElement(
      live,
      el('<li><div data-payload-island><i>fresh</i></div><p contenteditable>cms</p></li>'),
      options,
    );
    expect(live.children[0]).toBe(island);
    expect(island?.innerHTML).toBe('<i>hydrated</i>');
    expect(live.children[1]).toBe(editable);
    expect(editable?.textContent).toBe('typed by the visitor');
  });

  it('inserts a boundary fresh where the live tree had none', () => {
    const live = el('<li><span>t</span></li>');
    morphElement(live, el('<li><span>t</span><x-new>hi</x-new></li>'), options);
    expect(live.children[1]?.tagName.toLowerCase()).toBe('x-new');
    expect(live.children[1]?.textContent).toBe('hi');
  });
});

describe('what a retained node keeps', () => {
  it('keeps focus and the listener on an input inside a morphed item', () => {
    document.body.innerHTML = '';
    const live = el('<li><label>Name</label><input name="n"></li>');
    document.body.append(live);
    const input = live.querySelector('input')!;
    const heard = vi.fn();
    input.addEventListener('input', heard);
    input.value = 'half-typed';
    input.focus();
    expect(document.activeElement).toBe(input);
    morphElement(live, el('<li><label>Full name</label><input name="n"></li>'), options);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('half-typed');
    input.dispatchEvent(new Event('input'));
    expect(heard).toHaveBeenCalledOnce();
    expect(live.querySelector('label')?.textContent).toBe('Full name');
  });
});

describe('replacement paths', () => {
  it('replaces a keyed child whose tag changed under the same key', () => {
    const live = el(`<ul><li ${KEY}="a">A</li></ul>`);
    const old = live.firstElementChild;
    morphElement(live, el(`<ul><div ${KEY}="a">A</div></ul>`), options);
    expect(live.firstElementChild).not.toBe(old);
    expect(live.firstElementChild?.tagName).toBe('DIV');
    expect(live.children).toHaveLength(1);
  });

  it('replaces a positional child that became a boundary on one side only', () => {
    const live = el('<li><div data-payload-owned>site-owned</div></li>');
    const owned = live.firstElementChild;
    morphElement(live, el('<li><div>plain now</div></li>'), options);
    expect(live.firstElementChild).not.toBe(owned);
    expect(live.firstElementChild?.textContent).toBe('plain now');
  });
});
