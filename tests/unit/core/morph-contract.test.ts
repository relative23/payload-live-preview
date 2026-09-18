import { describe, expect, it } from 'vitest';
import { morphElement, type MorphOptions } from '@core/morph';

/**
 * The morph's contract, one case per promise, in the order ADR 0008 makes
 * them: what a retained node keeps (focus, caret, a selection, form state,
 * a disclosure), what pairs with what (keys, positions, namespaces,
 * hydration markers), and what is never entered (custom elements, islands,
 * contenteditable, owned and nested-fragment subtrees). `morph.test.ts`
 * holds the mechanics; this file is the fence around them (2.1 plan, M5):
 * a change to the engine that moves one of these lines is a change to the
 * contract, and the ADR addendum says so.
 *
 * jsdom has no layout, so scroll position, playback and rendering are the
 * browser suite's (`tests/e2e/specs/structural-morph.spec.ts`).
 */

const KEY = 'data-payload-key';
const options: MorphOptions = { keyAttributes: [KEY] };
const SVG = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';

function el(html: string): Element {
  const host = document.createElement('template');
  host.innerHTML = html.trim();
  const first = host.content.firstElementChild;
  if (first === null) throw new Error('no element');
  return document.importNode(first, true);
}

/** A live element attached to the document, where focus and selection exist. */
function mount(html: string): Element {
  const element = el(html);
  document.body.append(element);
  return element;
}

function blurCount(target: Element): () => number {
  let count = 0;
  target.addEventListener('blur', () => {
    count += 1;
  });
  return () => count;
}

describe('§1 what a retained node keeps', () => {
  it('keeps focus and the caret through an edit beside the focused input, without a blur', () => {
    const live = mount('<li data-payload-key="a"><span>old</span><input value="x"></li>');
    const input = live.querySelector('input')!;
    input.focus();
    input.value = 'typed here';
    input.setSelectionRange(3, 3);
    const blurs = blurCount(input);
    morphElement(
      live,
      el('<li data-payload-key="a"><span>new</span><input value="x"></li>'),
      options,
    );
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 3]);
    expect(input.value).toBe('typed here');
    expect(blurs()).toBe(0);
  });

  it('keeps a textarea caret and direction, and restores them after a keyed move', () => {
    const list = mount(
      '<ul><li data-payload-key="a">a</li><li data-payload-key="b"><textarea>draft</textarea></li></ul>',
    );
    const area = list.querySelector('textarea')!;
    area.focus();
    area.value = 'a longer draft';
    area.setSelectionRange(2, 8, 'backward');
    // In place first: nothing moves, nothing blurs.
    const blurs = blurCount(area);
    morphElement(
      list,
      el(
        '<ul><li data-payload-key="a">A</li><li data-payload-key="b"><textarea>draft</textarea></li></ul>',
      ),
      options,
    );
    expect(document.activeElement).toBe(area);
    expect(blurs()).toBe(0);
    expect([area.selectionStart, area.selectionEnd, area.selectionDirection]).toEqual([
      2,
      8,
      'backward',
    ]);
    // Then a move: the item is re-inserted, which blurs, and focus with its range comes back.
    morphElement(
      list,
      el(
        '<ul><li data-payload-key="b"><textarea>draft</textarea></li><li data-payload-key="a">A</li></ul>',
      ),
      options,
    );
    expect(list.firstElementChild?.querySelector('textarea')).toBe(area);
    expect(document.activeElement).toBe(area);
    expect(area.value).toBe('a longer draft');
    expect([area.selectionStart, area.selectionEnd]).toEqual([2, 8]);
  });

  it('keeps a text selection on the text node it edits in place, collapsed to its start', () => {
    const live = mount('<p data-payload-key="p">the quick brown fox</p>');
    const text = live.firstChild!;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 9);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    morphElement(live, el('<p data-payload-key="p">the quick brown cat</p>'), options);
    expect(live.firstChild).toBe(text);
    expect(text.nodeValue).toBe('the quick brown cat');
    // The node is the same, so the selection still points into the live
    // paragraph. Its offsets are not kept: writing `nodeValue` is the DOM's
    // "replace data" over the whole node, and that algorithm moves every
    // range boundary inside the replaced span to its start. A selection
    // across an edited text node therefore collapses; one across a sibling
    // the edit did not touch is untouched.
    const kept = selection.getRangeAt(0);
    expect(kept.startContainer).toBe(text);
    expect([kept.startOffset, kept.endOffset]).toEqual([0, 0]);
  });

  it('keeps a listener and an expando on a retained element', () => {
    const live = mount('<li data-payload-key="a"><button>go</button></li>');
    const button = live.querySelector('button')!;
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });
    (button as HTMLButtonElement & { __site?: string }).__site = 'mine';
    morphElement(
      live,
      el('<li data-payload-key="a"><button class="c">go now</button></li>'),
      options,
    );
    expect(live.querySelector('button')).toBe(button);
    button.click();
    expect(clicks).toBe(1);
    expect((button as HTMLButtonElement & { __site?: string }).__site).toBe('mine');
    expect(button.className).toBe('c');
  });
});

describe('§3 form state the visitor owns', () => {
  it('keeps a visitor-toggled checkbox and radio when the template names neither', () => {
    const live = mount(
      '<li data-payload-key="a"><span>t</span><input type="checkbox"><input type="radio" name="r" value="1"><input type="radio" name="r" value="2"></li>',
    );
    const [box, one, two] = Array.from(live.querySelectorAll('input'));
    box!.checked = true;
    two!.checked = true;
    morphElement(
      live,
      el(
        '<li data-payload-key="a"><span>edited</span><input type="checkbox"><input type="radio" name="r" value="1"><input type="radio" name="r" value="2"></li>',
      ),
      options,
    );
    expect(live.querySelectorAll('input')[0]).toBe(box);
    expect([box!.checked, one!.checked, two!.checked]).toEqual([true, false, true]);
  });

  it("writes the checked attribute the template names, and the visitor's choice still wins once made", () => {
    const live = mount('<li data-payload-key="a"><input type="checkbox"></li>');
    const box = live.querySelector('input')!;
    // Untouched by the visitor: the template's `checked` reaches the property.
    morphElement(
      live,
      el('<li data-payload-key="a"><input type="checkbox" checked></li>'),
      options,
    );
    expect(box.hasAttribute('checked')).toBe(true);
    expect(box.checked).toBe(true);
    // Toggled by the visitor: the attribute is still synchronised, the property is theirs.
    box.checked = false;
    morphElement(
      live,
      el('<li data-payload-key="a"><input type="checkbox" checked></li>'),
      options,
    );
    expect(box.hasAttribute('checked')).toBe(true);
    expect(box.checked).toBe(false);
  });

  it('keeps a typed input value while the template changes the value attribute', () => {
    const live = mount('<li data-payload-key="a"><input value="cms"></li>');
    const input = live.querySelector('input')!;
    input.value = 'visitor';
    morphElement(live, el('<li data-payload-key="a"><input value="cms 2"></li>'), options);
    expect(input.getAttribute('value')).toBe('cms 2');
    expect(input.value).toBe('visitor');
  });

  it('keeps the chosen option of a select and the typed text of a textarea', () => {
    const live = mount(
      '<li data-payload-key="a"><select><option value="1">One</option><option value="2">Two</option></select><textarea>from cms</textarea></li>',
    );
    const select = live.querySelector('select')!;
    const area = live.querySelector('textarea')!;
    select.value = '2';
    area.value = 'the visitor wrote this';
    morphElement(
      live,
      el(
        '<li data-payload-key="a"><select><option value="1">Uno</option><option value="2">Dos</option></select><textarea>from cms, edited</textarea></li>',
      ),
      options,
    );
    expect(live.querySelector('select')).toBe(select);
    expect(select.value).toBe('2');
    expect(Array.from(select.options, (option) => option.textContent)).toEqual(['Uno', 'Dos']);
    expect(area.value).toBe('the visitor wrote this');
    expect(area.textContent).toBe('from cms, edited');
  });

  it('opens a details the template opens and never closes one by leaving `open` out', () => {
    const live = mount('<li data-payload-key="a"><details><summary>s</summary>body</details></li>');
    const details = live.querySelector('details')!;
    morphElement(
      live,
      el('<li data-payload-key="a"><details open><summary>s</summary>body</details></li>'),
      options,
    );
    expect(details.open).toBe(true);
    morphElement(
      live,
      el('<li data-payload-key="a"><details><summary>s</summary>body 2</details></li>'),
      options,
    );
    expect(details.open).toBe(true);
    expect(details.lastChild?.nodeValue).toBe('body 2');
  });
});

describe('§2 pairing across namespaces and hydration markers', () => {
  it('edits SVG attributes in place and keeps the SVG namespace and a namespaced href', () => {
    const live = mount(
      '<li data-payload-key="a"><svg viewBox="0 0 10 10"><use xlink:href="#one"></use><path d="M0 0"></path></svg></li>',
    );
    const svg = live.querySelector('svg')!;
    const use = live.querySelector('use')!;
    const path = live.querySelector('path')!;
    expect(use.getAttributeNS(XLINK, 'href')).toBe('#one');
    morphElement(
      live,
      el(
        '<li data-payload-key="a"><svg viewBox="0 0 20 20"><use xlink:href="#two"></use><path d="M1 1"></path></svg></li>',
      ),
      options,
    );
    expect(live.querySelector('svg')).toBe(svg);
    expect(svg.namespaceURI).toBe(SVG);
    expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(live.querySelector('use')).toBe(use);
    expect(use.getAttributeNS(XLINK, 'href')).toBe('#two');
    expect(use.getAttribute('xlink:href')).toBe('#two');
    expect(live.querySelector('path')).toBe(path);
    expect(path.getAttribute('d')).toBe('M1 1');
  });

  it('never pairs an element with its namesake in another namespace', () => {
    const live = mount('<li data-payload-key="a"><svg><a href="#x"><text>t</text></a></svg></li>');
    const svgAnchor = live.querySelector('a')!;
    expect(svgAnchor.namespaceURI).toBe(SVG);
    // The rendered item replaces the drawing with an HTML link at the same position.
    morphElement(live, el('<li data-payload-key="a"><a href="#x">t</a></li>'), options);
    const htmlAnchor = live.querySelector('a')!;
    expect(htmlAnchor).not.toBe(svgAnchor);
    expect(htmlAnchor.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(live.querySelector('svg')).toBeNull();
  });

  it('keeps an HTML subtree inside foreignObject when both sides render it', () => {
    const live = mount(
      '<li data-payload-key="a"><svg><foreignObject><div class="note">old</div></foreignObject></svg></li>',
    );
    const div = live.querySelector('div')!;
    morphElement(
      live,
      el(
        '<li data-payload-key="a"><svg><foreignObject><div class="note">new</div></foreignObject></svg></li>',
      ),
      options,
    );
    expect(live.querySelector('div')).toBe(div);
    expect(div.textContent).toBe('new');
  });

  it('treats React and Vue hydration markers on one side only as insertions or surplus', () => {
    // Markers on the rendered side: inserted, the live elements keep their identity.
    const live = mount('<li data-payload-key="a"><span>one</span><span>two</span></li>');
    const [one, two] = Array.from(live.children);
    morphElement(
      live,
      el(
        '<li data-payload-key="a"><!--$--><span>one</span><!--/$--><!--[--><span>two</span><!--]--></li>',
      ),
      options,
    );
    expect(Array.from(live.children)).toEqual([one, two]);
    expect(live.innerHTML).toBe(
      '<!--$--><span>one</span><!--/$--><!--[--><span>two</span><!--]-->',
    );
    // Markers on the live side only: removed as surplus, the elements still keep their identity.
    morphElement(
      live,
      el('<li data-payload-key="a"><span>uno</span><span>dos</span></li>'),
      options,
    );
    expect(Array.from(live.children)).toEqual([one, two]);
    expect(live.innerHTML).toBe('<span>uno</span><span>dos</span>');
  });

  it('keeps every keyed item across a reorder with inserts and removals, in the rendered order', () => {
    const live = mount(
      '<ul><li data-payload-key="a">a</li><li data-payload-key="b">b</li><li data-payload-key="c">c</li></ul>',
    );
    const [a, , c] = Array.from(live.children);
    morphElement(
      live,
      el(
        '<ul><li data-payload-key="c">C</li><li data-payload-key="d">d</li><li data-payload-key="a">A</li></ul>',
      ),
      options,
    );
    expect(Array.from(live.children, (item) => item.getAttribute(KEY))).toEqual(['c', 'd', 'a']);
    expect(live.children[0]).toBe(c);
    expect(live.children[2]).toBe(a);
    expect(live.textContent).toBe('CdA');
  });
});

describe('§4 boundaries the morph never crosses', () => {
  it('leaves an upgraded custom element whole: its shadow root, its field, its attributes', () => {
    class Note extends HTMLElement {
      connected = 0;
      connectedCallback(): void {
        this.connected += 1;
        if (this.shadowRoot === null) {
          this.attachShadow({ mode: 'open' }).innerHTML = '<b>shadow</b>';
        }
      }
    }
    if (customElements.get('x-note') === undefined) customElements.define('x-note', Note);
    const live = mount('<li data-payload-key="a"><x-note title="t1"><i>light</i></x-note></li>');
    const note = live.querySelector<Note>('x-note')!;
    expect(note.connected).toBe(1);
    morphElement(
      live,
      el('<li data-payload-key="a"><x-note title="t2"><i>other light</i></x-note></li>'),
      options,
    );
    expect(live.querySelector('x-note')).toBe(note);
    expect(note.getAttribute('title')).toBe('t1');
    expect(note.innerHTML).toBe('<i>light</i>');
    expect(note.shadowRoot?.innerHTML).toBe('<b>shadow</b>');
    expect(note.connected).toBe(1);
  });

  it('leaves astro-island and a data-payload-island subtree exactly as they are', () => {
    const live = mount(
      '<li data-payload-key="a"><astro-island uid="1"><p>hydrated</p></astro-island><div data-payload-island class="x"><p>vue</p></div></li>',
    );
    const [island, marked] = Array.from(live.children);
    morphElement(
      live,
      el(
        '<li data-payload-key="a"><astro-island uid="2"><p>re-rendered</p></astro-island><div data-payload-island class="y"><p>again</p></div></li>',
      ),
      options,
    );
    expect(Array.from(live.children)).toEqual([island, marked]);
    expect(island!.outerHTML).toBe('<astro-island uid="1"><p>hydrated</p></astro-island>');
    expect(marked!.outerHTML).toBe('<div data-payload-island="" class="x"><p>vue</p></div>');
  });

  it('treats every contenteditable spelling but "false" as a boundary and keeps what was typed', () => {
    const live = mount(
      '<li data-payload-key="a"><p contenteditable="">typed</p><p contenteditable="true">typed</p><p contenteditable="plaintext-only">typed</p><p contenteditable="false">cms</p></li>',
    );
    const paragraphs = Array.from(live.children);
    morphElement(
      live,
      el(
        '<li data-payload-key="a"><p contenteditable="">cms</p><p contenteditable="true">cms</p><p contenteditable="plaintext-only">cms</p><p contenteditable="false">cms 2</p></li>',
      ),
      options,
    );
    expect(Array.from(live.children)).toEqual(paragraphs);
    expect(Array.from(live.children, (p) => p.textContent)).toEqual([
      'typed',
      'typed',
      'typed',
      'cms 2',
    ]);
  });

  it('keeps a consumer-owned subtree, and inserts a boundary fresh where the live tree had none', () => {
    const live = mount('<li data-payload-key="a"><div data-payload-owned><b>site</b></div></li>');
    const owned = live.firstElementChild!;
    morphElement(
      live,
      el(
        '<li data-payload-key="a"><div data-payload-owned><b>cms</b></div><x-late>new</x-late></li>',
      ),
      options,
    );
    expect(live.firstElementChild).toBe(owned);
    expect(owned.innerHTML).toBe('<b>site</b>');
    expect(live.lastElementChild?.outerHTML).toBe('<x-late>new</x-late>');
  });

  it("synchronises a nested fragment or slot's attributes and leaves its children to their own update", () => {
    const live = mount(
      '<section><h2>t</h2><div data-payload-fragment="hero" class="a"><p>rendered by the fragment</p></div></section>',
    );
    const fragment = live.querySelector('[data-payload-fragment]')!;
    const inner = fragment.firstElementChild;
    morphElement(
      live,
      el(
        '<section><h2>t2</h2><div data-payload-fragment="hero" class="b"><p>a whole-page render</p></div></section>',
      ),
      { ...options, retainChildrenOf: (element) => element.hasAttribute('data-payload-fragment') },
    );
    expect(live.querySelector('h2')?.textContent).toBe('t2');
    expect(live.querySelector('[data-payload-fragment]')).toBe(fragment);
    expect(fragment.className).toBe('b');
    expect(fragment.firstElementChild).toBe(inner);
    expect(fragment.textContent).toBe('rendered by the fragment');
  });
});
