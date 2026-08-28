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

  it('pairs later duplicates positionally without touching their attributes and reports the key once', () => {
    const onDuplicateKey = vi.fn();
    const live = el(`<ul><li ${KEY}="a">first</li><li ${KEY}="a">second</li></ul>`);
    const [first, second] = Array.from(live.children);
    morphElement(live, el(`<ul><li ${KEY}="a">FIRST</li><li ${KEY}="a">SECOND</li></ul>`), {
      ...options,
      onDuplicateKey,
    });
    expect(onDuplicateKey).toHaveBeenCalledWith(live, 'a');
    expect(first?.textContent).toBe('FIRST');
    expect(live.children[1]).toBe(second);
    expect(second?.getAttribute(KEY)).toBe('a');
    expect(second?.textContent).toBe('SECOND');
  });

  it('does not treat an empty-valued key attribute as a key', () => {
    const live = el(
      '<div><div data-payload-island><input value="a"></div><div data-payload-island>B</div></div>',
    );
    const [a, b] = Array.from(live.children);
    (a!.firstElementChild as HTMLInputElement).value = 'typed';
    morphElement(
      live,
      el('<div><div data-payload-island><input></div><div data-payload-island>B!</div></div>'),
      { keyAttributes: ['data-payload-island'] },
    );
    expect(live.children[0]).toBe(a);
    expect(live.children[1]).toBe(b);
    expect(b?.hasAttribute('data-payload-island')).toBe(true);
    expect((a!.firstElementChild as HTMLInputElement).value).toBe('typed');
  });

  it('inserts a leading comment or whitespace without consuming the live elements', () => {
    const live = el('<section><p>one</p><p>two</p></section>');
    const [p1, p2] = Array.from(live.children);
    morphElement(live, el('<section><!-- c --><p>one!</p><p>two!</p></section>'), options);
    expect(live.children[0]).toBe(p1);
    expect(live.children[1]).toBe(p2);
    expect(live.innerHTML).toBe('<!-- c --><p>one!</p><p>two!</p>');

    const spaced = el('<section><p>one</p><p>two</p></section>');
    const [s1, s2] = Array.from(spaced.children);
    morphElement(spaced, el('<section>\n  <p>uno</p><p>dos</p></section>'), options);
    expect(spaced.children[0]).toBe(s1);
    expect(spaced.children[1]).toBe(s2);
  });

  it('treats an inserted element as an insertion when the following node pairs with the live one', () => {
    const live = el('<div><p>a</p><span>b</span></div>');
    const [p, span] = Array.from(live.children);
    morphElement(live, el('<div><h2>title</h2><p>a!</p><span>b!</span></div>'), options);
    expect(live.children[0]?.tagName).toBe('H2');
    expect(live.children[1]).toBe(p);
    expect(live.children[2]).toBe(span);
  });

  it('replaces exactly one live element on a tag change and keeps pairing the rest', () => {
    const live = el('<div><p>a</p><span>b</span><em>c</em></div>');
    const [, span, em] = Array.from(live.children);
    morphElement(live, el('<div><h2>a</h2><span>b!</span><em>c!</em></div>'), options);
    expect(live.children[0]?.tagName).toBe('H2');
    expect(live.children[1]).toBe(span);
    expect(live.children[2]).toBe(em);
  });

  it('never rewrites a text node into a comment or back', () => {
    const live = el('<p>text</p>');
    morphElement(live, el('<p><!-- note --></p>'), options);
    expect(live.firstChild?.nodeType).toBe(Node.COMMENT_NODE);
    expect(live.textContent).toBe('');
  });

  it('restores focus and selection on an input inside a keyed item that moved', () => {
    document.body.innerHTML = '';
    const live = el(
      `<ul><li ${KEY}="a"><input value="x"></li><li ${KEY}="b"><input value="y"></li></ul>`,
    );
    document.body.append(live);
    const input = live.querySelectorAll('input')[1]!;
    input.value = 'moved';
    input.focus();
    input.setSelectionRange(1, 3);
    morphElement(
      live,
      el(`<ul><li ${KEY}="b"><input></li><li ${KEY}="a"><input></li></ul>`),
      options,
    );
    expect(live.firstElementChild?.getAttribute(KEY)).toBe('b');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('moved');
    expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
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

describe('whitespace between children', () => {
  it('keeps a retained element in place when the live markup carries indentation the template does not', () => {
    // Astro 4–6, and most SSR that keeps source indentation, render text
    // nodes between the elements; the template renders none. A retained
    // element must not be moved to reach the rendered order — a DOM move is a
    // remove-and-insert that blurs a focused input.
    document.body.innerHTML =
      '<li data-key="b">\n  <span class="t">Beta</span>\n  <input class="i" aria-label="Beta">\n  <details><summary>more</summary></details>\n</li>';
    const live = document.body.firstElementChild as HTMLElement;
    const input = live.querySelector('input')!;
    input.value = 'half typed';
    const removed: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) removed.push(...Array.from(record.removedNodes));
    });
    observer.observe(live, { childList: true, subtree: true });

    const rendered = document.createElement('template');
    rendered.innerHTML =
      '<li data-key="b"><span class="t">Beta, edited</span><input class="i" aria-label="Beta, edited"><details><summary>more</summary></details></li>';
    const result = morphElement(live, rendered.content.firstElementChild!, {
      keyAttributes: ['data-key'],
    });
    observer.takeRecords().forEach((record) => removed.push(...Array.from(record.removedNodes)));
    observer.disconnect();

    expect(result).toBe(live);
    expect(live.querySelector('input')).toBe(input);
    expect(input.value).toBe('half typed');
    expect(input.getAttribute('aria-label')).toBe('Beta, edited');
    expect(live.querySelector('.t')?.textContent).toBe('Beta, edited');
    expect(removed.filter((node) => node.nodeType === Node.ELEMENT_NODE)).toEqual([]);
    expect(live.innerHTML).not.toContain('\n');
  });
});
