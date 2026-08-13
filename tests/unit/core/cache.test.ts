import { beforeEach, describe, expect, it } from 'vitest';
import {
  ElementCache,
  FIELD_ATTRIBUTE,
  TARGET_ATTRIBUTE_ATTRIBUTE,
  TYPE_ATTRIBUTE,
  resolveFieldType,
} from '@core/cache';

function makeHtml(html: string): Element {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('ElementCache — buildFromRoot', () => {
  it('indexes elements by their data-payload-field attribute', () => {
    const root = makeHtml(`
      <h1 data-payload-field="title">A</h1>
      <p data-payload-field="subtitle">B</p>
      <span data-payload-field="title">A2</span>
    `);
    const cache = new ElementCache();
    const stats = cache.buildFromRoot(root);
    expect(stats.elementCount).toBe(3);
    expect(stats.fieldCount).toBe(2);
    expect(cache.get('title')).toHaveLength(2);
    expect(cache.get('subtitle')).toHaveLength(1);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('skips elements with empty field name', () => {
    const root = makeHtml('<p data-payload-field="">x</p><p data-payload-field="ok">y</p>');
    const cache = new ElementCache();
    const stats = cache.buildFromRoot(root);
    expect(stats.elementCount).toBe(1);
    expect(cache.get('ok')).toHaveLength(1);
    expect(cache.get('')).toBeUndefined();
  });

  it('captures auxiliary binding attributes', () => {
    const root = makeHtml(`
      <a data-payload-field="ctaLabel"
         data-payload-href="ctaUrl">x</a>
      <img data-payload-field="hero"
           data-payload-src="hero.url"
           data-payload-alt="hero.alt" />
      <ul data-payload-field="items"
          data-payload-type="array"
          data-payload-array-template="<li>{{value}}</li>"
          data-payload-array-separator="; ">x</ul>
    `);
    const cache = new ElementCache();
    cache.buildFromRoot(root);
    const cta = cache.get('ctaLabel')?.[0];
    expect(cta?.hrefField).toBe('ctaUrl');
    const hero = cache.get('hero')?.[0];
    expect(hero?.srcField).toBe('hero.url');
    expect(hero?.altField).toBe('hero.alt');
    const items = cache.get('items')?.[0];
    expect(items?.fieldType).toBe('array');
    expect(items?.arrayTemplate).toBe('<li>{{value}}</li>');
    expect(items?.arraySeparator).toBe('; ');
  });

  it('treats an empty locale attribute as no element-local override', () => {
    const root = makeHtml('<span data-payload-field="title" data-payload-locale="">initial</span>');
    const cache = new ElementCache();

    cache.buildFromRoot(root);

    expect(cache.get('title')?.[0]?.locale).toBeUndefined();
  });

  it('respects a filter predicate', () => {
    const root = makeHtml(`
      <p data-payload-field="a">x</p>
      <p data-payload-field="b" class="exclude">y</p>
    `);
    const cache = new ElementCache({ filter: (el) => !el.classList.contains('exclude') });
    cache.buildFromRoot(root);
    expect(cache.get('a')).toHaveLength(1);
    expect(cache.get('b')).toBeUndefined();
  });

  it('clearing replaces previous contents on rebuild', () => {
    const root = makeHtml('<p data-payload-field="a">x</p>');
    const cache = new ElementCache();
    cache.buildFromRoot(root);
    expect(cache.fieldCount).toBe(1);
    const empty = document.createElement('div');
    const stats = cache.buildFromRoot(empty);
    expect(stats.elementCount).toBe(0);
    expect(cache.fieldCount).toBe(0);
  });

  it('forgets an externally retained stale node on full rebuild', () => {
    const root = makeHtml('<p data-payload-field="a">x</p>');
    const cache = new ElementCache();
    cache.buildFromRoot(root);
    const retained = root.querySelector('[data-payload-field="a"]')!;
    expect(cache.has(retained)).toBe(true);

    cache.buildFromRoot(document.createElement('div'));
    expect(cache.has(retained)).toBe(false);
    expect(cache.getByElement(retained)).toBeUndefined();
  });
});

describe('ElementCache — incremental mutation', () => {
  let cache: ElementCache;
  let root: Element;

  beforeEach(() => {
    cache = new ElementCache();
    root = makeHtml('<p data-payload-field="title">x</p>');
    cache.buildFromRoot(root);
  });

  it('add registers a new element', () => {
    const newEl = document.createElement('span');
    newEl.setAttribute(FIELD_ATTRIBUTE, 'subtitle');
    expect(cache.add(newEl)?.fieldName).toBe('subtitle');
    expect(cache.get('subtitle')).toHaveLength(1);
  });

  it('add replaces an existing binding instead of duplicating it', () => {
    const target = root.querySelector('[data-payload-field="title"]')!;

    expect(cache.add(target)?.fieldName).toBe('title');
    target.setAttribute(TARGET_ATTRIBUTE_ATTRIBUTE, 'data-preview-value');
    expect(cache.add(target)?.targetAttribute).toBe('data-preview-value');

    expect(cache.get('title')).toHaveLength(1);
    expect(cache.get('title')?.[0]?.targetAttribute).toBe('data-preview-value');
    expect([...cache.values()].map((entry) => entry.element)).toEqual([target]);
    expect(cache.elementCount).toBe(1);
  });

  it('refreshes a same-field binding in place without changing peer order', () => {
    root = makeHtml(
      '<p id="first" data-payload-field="title">first</p>' +
        '<p id="second" data-payload-field="title">second</p>',
    );
    cache.buildFromRoot(root);
    const first = root.querySelector('#first')!;
    const second = root.querySelector('#second')!;
    first.setAttribute(TARGET_ATTRIBUTE_ATTRIBUTE, 'aria-label');

    const refreshed = cache.add(first);

    expect(refreshed?.targetAttribute).toBe('aria-label');
    expect(cache.get('title')?.map((entry) => entry.element)).toEqual([first, second]);
    expect(cache.get('title')?.[0]).toBe(refreshed);
    expect(cache.elementCount).toBe(2);
  });

  it('moves an existing element to its new field and remove leaves no stale bucket', () => {
    const target = root.querySelector('[data-payload-field="title"]')!;
    target.setAttribute(FIELD_ATTRIBUTE, 'subtitle');

    expect(cache.add(target)?.fieldName).toBe('subtitle');
    expect(cache.get('title')).toBeUndefined();
    expect(cache.get('subtitle')).toHaveLength(1);
    expect(cache.elementCount).toBe(1);

    expect(cache.remove(target)).toBe(true);
    expect(cache.get('title')).toBeUndefined();
    expect(cache.get('subtitle')).toBeUndefined();
    expect(cache.has(target)).toBe(false);
    expect(cache.elementCount).toBe(0);
  });

  it('atomically removes an existing binding when the new binding is invalid', () => {
    const target = root.querySelector('[data-payload-field="title"]')!;
    target.removeAttribute(FIELD_ATTRIBUTE);

    expect(cache.add(target)).toBeUndefined();
    expect(cache.get('title')).toBeUndefined();
    expect(cache.getByElement(target)).toBeUndefined();
    expect(cache.elementCount).toBe(0);
  });

  it('removes only the invalidated element from a shared field bucket', () => {
    root = makeHtml(
      '<p id="first" data-payload-field="title">first</p>' +
        '<p id="second" data-payload-field="title">second</p>',
    );
    cache.buildFromRoot(root);
    const first = root.querySelector('#first')!;
    const second = root.querySelector('#second')!;
    first.removeAttribute(FIELD_ATTRIBUTE);

    expect(cache.add(first)).toBeUndefined();

    expect(cache.get('title')?.map((entry) => entry.element)).toEqual([second]);
    expect(cache.has(first)).toBe(false);
    expect(cache.getByElement(first)).toBeUndefined();
    expect(cache.remove(first)).toBe(false);
    expect(cache.elementCount).toBe(1);
  });

  it('atomically removes an existing binding when the filter stops accepting it', () => {
    let accepted = true;
    const filtered = new ElementCache({ filter: () => accepted });
    const target = document.createElement('span');
    target.setAttribute(FIELD_ATTRIBUTE, 'title');
    expect(filtered.add(target)?.fieldName).toBe('title');

    accepted = false;

    expect(filtered.add(target)).toBeUndefined();
    expect(filtered.get('title')).toBeUndefined();
    expect(filtered.getByElement(target)).toBeUndefined();
    expect(filtered.elementCount).toBe(0);
  });

  it('preserves the old binding atomically when the filter throws', () => {
    let shouldThrow = false;
    const filtered = new ElementCache({
      filter: () => {
        if (shouldThrow) throw new Error('filter failed');
        return true;
      },
    });
    const target = document.createElement('span');
    target.setAttribute(FIELD_ATTRIBUTE, 'title');
    const original = filtered.add(target);
    shouldThrow = true;

    expect(() => filtered.add(target)).toThrow('filter failed');
    expect(filtered.get('title')).toEqual([original]);
    expect(filtered.getByElement(target)).toBe(original);
    expect(filtered.elementCount).toBe(1);
  });

  it('add returns undefined for elements without a field name', () => {
    const newEl = document.createElement('span');
    expect(cache.add(newEl)).toBeUndefined();
  });

  it('add returns undefined when filter rejects', () => {
    const filtered = new ElementCache({ filter: () => false });
    const el = document.createElement('span');
    el.setAttribute(FIELD_ATTRIBUTE, 'x');
    expect(filtered.add(el)).toBeUndefined();
  });

  it('remove cleans the bucket', () => {
    const target = root.querySelector('[data-payload-field="title"]')!;
    expect(cache.remove(target)).toBe(true);
    expect(cache.get('title')).toBeUndefined();
  });

  it('remove returns false for unknown element', () => {
    expect(cache.remove(document.createElement('div'))).toBe(false);
  });

  it('keeps remaining bindings when removing one of several', () => {
    const a = document.createElement('span');
    a.setAttribute(FIELD_ATTRIBUTE, 'title');
    cache.add(a);
    expect(cache.get('title')).toHaveLength(2);
    const first = root.querySelector('[data-payload-field="title"]')!;
    cache.remove(first);
    expect(cache.get('title')).toHaveLength(1);
  });
});

describe('ElementCache — introspection', () => {
  it('fieldCount and elementCount work as expected', () => {
    const root = makeHtml(`
      <p data-payload-field="a">x</p>
      <p data-payload-field="a">y</p>
      <p data-payload-field="b">z</p>
    `);
    const cache = new ElementCache();
    cache.buildFromRoot(root);
    expect(cache.fieldCount).toBe(2);
    expect(cache.elementCount).toBe(3);
  });

  it('values yields every binding', () => {
    const root = makeHtml(`
      <p data-payload-field="a">x</p>
      <p data-payload-field="b">y</p>
    `);
    const cache = new ElementCache();
    cache.buildFromRoot(root);
    const names = [...cache.values()].map((b) => b.fieldName);
    expect(new Set(names)).toEqual(new Set(['a', 'b']));
  });

  it('has reports membership accurately', () => {
    const root = makeHtml('<p data-payload-field="a">x</p>');
    const cache = new ElementCache();
    cache.buildFromRoot(root);
    const tracked = root.querySelector('[data-payload-field="a"]')!;
    expect(cache.has(tracked)).toBe(true);
    expect(cache.has(document.createElement('span'))).toBe(false);
  });

  it('clear empties the cache', () => {
    const root = makeHtml('<p data-payload-field="a">x</p>');
    const cache = new ElementCache();
    cache.buildFromRoot(root);
    cache.clear();
    expect(cache.fieldCount).toBe(0);
    expect(cache.elementCount).toBe(0);
  });

  it('clear resets element membership for externally retained nodes', () => {
    const root = makeHtml('<p data-payload-field="a">x</p>');
    const cache = new ElementCache();
    cache.buildFromRoot(root);
    const retained = root.querySelector('[data-payload-field="a"]')!;
    cache.clear();
    expect(cache.has(retained)).toBe(false);
    expect(cache.getByElement(retained)).toBeUndefined();
  });

  it('entries iterates the field map', () => {
    const root = makeHtml(`
      <p data-payload-field="a">x</p>
      <p data-payload-field="b">y</p>
    `);
    const cache = new ElementCache();
    cache.buildFromRoot(root);
    const entries = [...cache.entries()].map(([k]) => k);
    expect(new Set(entries)).toEqual(new Set(['a', 'b']));
  });

  it('getByElement returns the entry for a registered element', () => {
    const root = makeHtml('<p data-payload-field="a">x</p>');
    const cache = new ElementCache();
    cache.buildFromRoot(root);
    const el = root.querySelector('[data-payload-field="a"]')!;
    expect(cache.getByElement(el)?.fieldName).toBe('a');
  });
});

describe('resolveFieldType', () => {
  it('honours explicit valid data-payload-type', () => {
    const el = document.createElement('p');
    el.setAttribute(TYPE_ATTRIBUTE, 'richText');
    expect(resolveFieldType(el)).toBe('richText');
  });

  it('falls back to text for unknown explicit type', () => {
    const el = document.createElement('p');
    el.setAttribute(TYPE_ATTRIBUTE, 'wat');
    expect(resolveFieldType(el)).toBe('text');
  });

  it('infers richText from data-payload-richtext attribute', () => {
    const el = document.createElement('div');
    el.setAttribute('data-payload-richtext', '');
    expect(resolveFieldType(el)).toBe('richText');
  });

  it('infers html, array, image, url, date from element/attributes', () => {
    const div = document.createElement('div');
    div.setAttribute('data-payload-html', '');
    expect(resolveFieldType(div)).toBe('html');

    const ul = document.createElement('ul');
    ul.setAttribute('data-payload-array', '');
    expect(resolveFieldType(ul)).toBe('array');

    expect(resolveFieldType(document.createElement('img'))).toBe('image');
    expect(resolveFieldType(document.createElement('a'))).toBe('url');
    expect(resolveFieldType(document.createElement('time'))).toBe('date');
  });

  it('inputs map to checkbox/number/date based on input.type', () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    expect(resolveFieldType(cb)).toBe('checkbox');

    const num = document.createElement('input');
    num.type = 'number';
    expect(resolveFieldType(num)).toBe('number');

    const dt = document.createElement('input');
    dt.type = 'date';
    expect(resolveFieldType(dt)).toBe('date');

    const text = document.createElement('input');
    text.type = 'text';
    expect(resolveFieldType(text)).toBe('text');
  });

  it('defaults to text for vanilla elements', () => {
    expect(resolveFieldType(document.createElement('p'))).toBe('text');
    expect(resolveFieldType(document.createElement('span'))).toBe('text');
  });
});
