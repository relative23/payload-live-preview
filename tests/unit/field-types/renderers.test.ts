import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@field-types/index';
import { buildBuiltinRenderers } from '@field-types/registry';
import type { CachedElement, FieldRenderer, RenderContext } from '@core/types';

function makeTarget(element: Element, overrides: Partial<CachedElement> = {}): CachedElement {
  return {
    element,
    fieldName: 'f',
    fieldType: 'text',
    ...overrides,
  };
}

function emptyContext(allFields: Record<string, unknown> = {}): RenderContext {
  return { allFields, locale: 'en-US', schema: undefined };
}

let renderers: ReturnType<typeof buildBuiltinRenderers>;

beforeEach(() => {
  renderers = buildBuiltinRenderers();
});

function renderer(name: string): FieldRenderer {
  const r = renderers[name];
  if (!r) throw new Error(`no renderer for ${name}`);
  return r;
}

describe('text renderer', () => {
  it('writes textContent for plain text', () => {
    const el = document.createElement('p');
    renderer('text').render(makeTarget(el), 'hello', emptyContext());
    expect(el.textContent).toBe('hello');
  });

  it('switches to innerHTML with <br> for multi-line text', () => {
    const el = document.createElement('div');
    renderer('text').render(makeTarget(el), 'a\nb', emptyContext());
    expect(el.innerHTML).toBe('a<br>b');
  });

  it('writes to input value', () => {
    const el = document.createElement('input');
    renderer('text').render(makeTarget(el), 'val', emptyContext());
    expect(el.value).toBe('val');
  });

  it('flattens Lexical content to plain text', () => {
    const el = document.createElement('p');
    renderer('text').render(
      makeTarget(el),
      {
        root: {
          children: [{ type: 'paragraph', children: [{ type: 'text', text: 'rich' }] }],
        },
      },
      emptyContext(),
    );
    expect(el.textContent).toBe('rich');
  });

  it('handles null and number values', () => {
    const el = document.createElement('span');
    renderer('text').render(makeTarget(el), null, emptyContext());
    expect(el.textContent).toBe('');
    renderer('text').render(makeTarget(el), 42, emptyContext());
    expect(el.textContent).toBe('42');
  });

  it('skips elements with structured child elements (preserves styled markup)', () => {
    const el = document.createElement('h1');
    const inner1 = document.createElement('span');
    inner1.textContent = 'Brand';
    inner1.style.fontSize = '64px';
    const inner2 = document.createElement('span');
    inner2.textContent = 'Tagline';
    el.append(inner1, inner2);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderer('text').render(makeTarget(el), 'replacement value', emptyContext());
    expect(el.children).toHaveLength(2);
    expect(el.firstElementChild?.textContent).toBe('Brand');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('honours data-payload-text opt-in to overwrite structured markup', () => {
    const el = document.createElement('h1');
    el.setAttribute('data-payload-text', '');
    const inner = document.createElement('span');
    inner.textContent = 'old';
    el.appendChild(inner);
    renderer('text').render(makeTarget(el), 'forced replacement', emptyContext());
    expect(el.textContent).toBe('forced replacement');
    expect(el.children).toHaveLength(0);
  });

  it('warns only once per element across repeated updates', () => {
    const el = document.createElement('h1');
    el.appendChild(document.createElement('span'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderer('text').render(makeTarget(el), 'a', emptyContext());
    renderer('text').render(makeTarget(el), 'b', emptyContext());
    renderer('text').render(makeTarget(el), 'c', emptyContext());
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('textarea renderer', () => {
  it('preserves newlines via <br>', () => {
    const el = document.createElement('div');
    renderer('textarea').render(makeTarget(el), 'a\nb', emptyContext());
    expect(el.innerHTML).toBe('a<br>b');
  });

  it('writes to textarea element', () => {
    const el = document.createElement('textarea');
    renderer('textarea').render(makeTarget(el), 'val', emptyContext());
    expect(el.value).toBe('val');
  });
});

describe('richText renderer', () => {
  it('renders Lexical content to HTML', () => {
    const el = document.createElement('div');
    renderer('richText').render(
      makeTarget(el),
      {
        root: {
          children: [{ type: 'paragraph', children: [{ type: 'text', text: 'hi' }] }],
        },
      },
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<p>hi</p>');
  });

  it('sanitises string HTML', () => {
    const el = document.createElement('div');
    renderer('richText').render(
      makeTarget(el),
      '<p>safe</p><script>alert(1)</script>',
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<p>safe</p>');
    expect(el.innerHTML).not.toContain('<script>');
  });
});

describe('html renderer', () => {
  it('strips dangerous tags', () => {
    const el = document.createElement('div');
    renderer('html').render(makeTarget(el), '<p>safe</p><script>bad</script>', emptyContext());
    expect(el.innerHTML).not.toContain('<script>');
  });

  it('clears element for null', () => {
    const el = document.createElement('div');
    el.textContent = 'old';
    renderer('html').render(makeTarget(el), null, emptyContext());
    expect(el.textContent).toBe('');
  });
});

describe('url renderer', () => {
  it('sets text and href on anchors', () => {
    const el = document.createElement('a');
    renderer('url').render(makeTarget(el), 'https://example.com', emptyContext());
    expect(el.textContent).toBe('https://example.com');
    expect(el.href).toBe('https://example.com/');
  });

  it('pulls href from sibling field when hrefField is set', () => {
    const el = document.createElement('a');
    renderer('url').render(
      makeTarget(el, { hrefField: 'linkTo' }),
      'Visit',
      emptyContext({ linkTo: 'https://example.com' }),
    );
    expect(el.textContent).toBe('Visit');
    expect(el.href).toBe('https://example.com/');
  });

  it('writes plain text on non-anchors', () => {
    const el = document.createElement('p');
    renderer('url').render(makeTarget(el), 'https://example.com', emptyContext());
    expect(el.textContent).toBe('https://example.com');
  });

  it('refuses unsafe URLs when reading hrefField', () => {
    const el = document.createElement('a');
    el.href = 'https://before.example.com/';
    renderer('url').render(
      makeTarget(el, { hrefField: 'linkTo' }),
      'Visit',
      emptyContext({ linkTo: 'javascript:alert(1)' }),
    );
    expect(el.getAttribute('href')).toBe('https://before.example.com/');
  });
});

describe('image renderer', () => {
  it('sets src and alt from a media object', () => {
    const el = document.createElement('img');
    renderer('image').render(
      makeTarget(el),
      { url: 'https://cdn.example.com/a.jpg', alt: 'caption' },
      emptyContext(),
    );
    expect(el.src).toBe('https://cdn.example.com/a.jpg');
    expect(el.alt).toBe('caption');
  });

  it('pulls alt from sibling field when not on media object', () => {
    const el = document.createElement('img');
    renderer('image').render(
      makeTarget(el, { altField: 'caption' }),
      { url: 'https://cdn.example.com/a.jpg' },
      emptyContext({ caption: 'fallback' }),
    );
    expect(el.alt).toBe('fallback');
  });

  it('sets background-image on non-img elements', () => {
    const el = document.createElement('div');
    renderer('image').render(
      makeTarget(el),
      { url: 'https://cdn.example.com/a.jpg' },
      emptyContext(),
    );
    expect(el.style.backgroundImage).toMatch(
      /url\(["']?https:\/\/cdn\.example\.com\/a\.jpg["']?\)/,
    );
  });

  it('refuses unsafe urls', () => {
    const el = document.createElement('img');
    renderer('image').render(makeTarget(el), { url: 'javascript:alert(1)' }, emptyContext());
    expect(el.getAttribute('src')).toBeNull();
  });

  it('accepts plain string urls', () => {
    const el = document.createElement('img');
    renderer('image').render(makeTarget(el), 'https://cdn.example.com/x.jpg', emptyContext());
    expect(el.src).toBe('https://cdn.example.com/x.jpg');
  });
});

describe('upload renderer', () => {
  it('sets src on <img>', () => {
    const el = document.createElement('img');
    renderer('upload').render(
      makeTarget(el),
      { url: 'https://cdn.example.com/a.jpg', alt: 'x' },
      emptyContext(),
    );
    expect(el.src).toBe('https://cdn.example.com/a.jpg');
    expect(el.alt).toBe('x');
  });

  it('sets href + text on <a>', () => {
    const el = document.createElement('a');
    renderer('upload').render(
      makeTarget(el),
      { url: 'https://cdn.example.com/a.pdf', filename: 'a.pdf' },
      emptyContext(),
    );
    expect(el.href).toBe('https://cdn.example.com/a.pdf');
    expect(el.textContent).toBe('a.pdf');
  });

  it('renders a fallback anchor in other elements', () => {
    const el = document.createElement('div');
    renderer('upload').render(
      makeTarget(el),
      { url: 'https://cdn.example.com/a.pdf', filename: 'a.pdf' },
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<a href="https://cdn.example.com/a.pdf"');
  });
});

describe('relationship renderer', () => {
  it('picks the first available label', () => {
    const el = document.createElement('span');
    renderer('relationship').render(makeTarget(el), { title: 'Hello' }, emptyContext());
    expect(el.textContent).toBe('Hello');
  });

  it('joins has-many relationships', () => {
    const el = document.createElement('span');
    renderer('relationship').render(
      makeTarget(el),
      [{ title: 'A' }, { title: 'B' }],
      emptyContext(),
    );
    expect(el.textContent).toBe('A, B');
  });

  it('sets href on an anchor', () => {
    const el = document.createElement('a');
    renderer('relationship').render(
      makeTarget(el),
      { title: 'x', url: '/posts/x' },
      emptyContext(),
    );
    expect(el.getAttribute('href')).toBe('/posts/x');
    expect(el.textContent).toBe('x');
  });
});

describe('select renderer', () => {
  it('updates select value', () => {
    const el = document.createElement('select');
    const opt = document.createElement('option');
    opt.value = 'b';
    el.appendChild(opt);
    renderer('select').render(makeTarget(el), 'b', emptyContext());
    expect(el.value).toBe('b');
  });

  it('updates radio checked state', () => {
    const el = document.createElement('input');
    el.type = 'radio';
    el.value = 'yes';
    renderer('radio').render(makeTarget(el), 'yes', emptyContext());
    expect(el.checked).toBe(true);
    renderer('radio').render(makeTarget(el), 'no', emptyContext());
    expect(el.checked).toBe(false);
  });

  it('joins has-many values', () => {
    const el = document.createElement('span');
    renderer('select').render(makeTarget(el), ['a', 'b'], emptyContext());
    expect(el.textContent).toBe('a, b');
  });
});

describe('checkbox renderer', () => {
  it('updates checked on checkbox input', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    renderer('checkbox').render(makeTarget(el), true, emptyContext());
    expect(el.checked).toBe(true);
  });

  it('updates aria-checked on elements that have it', () => {
    const el = document.createElement('div');
    el.setAttribute('aria-checked', 'false');
    renderer('checkbox').render(makeTarget(el), true, emptyContext());
    expect(el.getAttribute('aria-checked')).toBe('true');
  });

  it('falls back to textContent for arbitrary elements', () => {
    const el = document.createElement('span');
    renderer('checkbox').render(makeTarget(el), true, emptyContext());
    expect(el.textContent).toBe('true');
  });
});

describe('date renderer', () => {
  it('formats date for <time> element with datetime attribute', () => {
    const el = document.createElement('time');
    renderer('date').render(makeTarget(el), '2025-06-15T12:34:56.000Z', emptyContext());
    expect(el.getAttribute('datetime')).toBe('2025-06-15T12:34:56.000Z');
    expect(el.textContent).not.toBe('');
  });

  it('formats date for plain element', () => {
    const el = document.createElement('span');
    renderer('date').render(makeTarget(el), '2025-06-15', emptyContext());
    expect(el.textContent).not.toBe('');
  });

  it('writes ISO short form into date input', () => {
    const el = document.createElement('input');
    el.type = 'date';
    renderer('date').render(makeTarget(el), '2025-06-15T12:34:56.000Z', emptyContext());
    expect(el.value).toBe('2025-06-15');
  });

  it('clears element when value is empty', () => {
    const el = document.createElement('time');
    el.setAttribute('datetime', 'x');
    el.textContent = 'x';
    renderer('date').render(makeTarget(el), null, emptyContext());
    expect(el.getAttribute('datetime')).toBeNull();
    expect(el.textContent).toBe('');
  });

  it('falls back to raw string when input is not parseable', () => {
    const el = document.createElement('span');
    renderer('date').render(makeTarget(el), 'not-a-date', emptyContext());
    expect(el.textContent).toBe('not-a-date');
  });
});

describe('number renderer', () => {
  it('formats numbers via Intl.NumberFormat', () => {
    const el = document.createElement('span');
    renderer('number').render(makeTarget(el), 1234.5, emptyContext({}));
    // en-US format includes thousands separator
    expect(el.textContent).toMatch(/1[.,]234/);
  });

  it('writes raw number to input', () => {
    const el = document.createElement('input');
    el.type = 'number';
    renderer('number').render(makeTarget(el), 42, emptyContext());
    expect(el.value).toBe('42');
  });

  it('falls back to string for NaN', () => {
    const el = document.createElement('span');
    renderer('number').render(makeTarget(el), 'oops', emptyContext());
    expect(el.textContent).toBe('oops');
  });

  it('clears empty values', () => {
    const el = document.createElement('span');
    el.textContent = '1';
    renderer('number').render(makeTarget(el), null, emptyContext());
    expect(el.textContent).toBe('');
  });
});

describe('array renderer', () => {
  it('joins primitives with separator', () => {
    const el = document.createElement('span');
    renderer('array').render(makeTarget(el), ['a', 'b', 'c'], emptyContext());
    expect(el.textContent).toBe('a, b, c');
  });

  it('uses custom separator', () => {
    const el = document.createElement('span');
    renderer('array').render(makeTarget(el, { arraySeparator: ' | ' }), ['a', 'b'], emptyContext());
    expect(el.textContent).toBe('a | b');
  });

  it('JSON-stringifies object items in fallback mode', () => {
    const el = document.createElement('span');
    renderer('array').render(makeTarget(el), [{ x: 1 }, { x: 2 }], emptyContext());
    expect(el.textContent).toBe('{"x":1}, {"x":2}');
  });

  it('renders items with template', () => {
    const el = document.createElement('ul');
    renderer('array').render(
      makeTarget(el, { arrayTemplate: '<li>{{title}}</li>' }),
      [{ title: 'one' }, { title: 'two' }],
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<li>one</li>');
    expect(el.innerHTML).toContain('<li>two</li>');
  });

  it('renders primitives via {{value}}', () => {
    const el = document.createElement('ul');
    renderer('array').render(
      makeTarget(el, { arrayTemplate: '<li>{{value}}</li>' }),
      ['a', 'b'],
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<li>a</li>');
    expect(el.innerHTML).toContain('<li>b</li>');
  });

  it('exposes {{index}}', () => {
    const el = document.createElement('div');
    renderer('array').render(
      makeTarget(el, { arrayTemplate: '<span>{{index}}</span>' }),
      ['a', 'b'],
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<span>0</span>');
    expect(el.innerHTML).toContain('<span>1</span>');
  });

  it('escapes template field values', () => {
    const el = document.createElement('div');
    renderer('array').render(
      makeTarget(el, { arrayTemplate: '<span>{{title}}</span>' }),
      [{ title: '<script>x</script>' }],
      emptyContext(),
    );
    expect(el.innerHTML).not.toContain('<script>');
    expect(el.innerHTML).toContain('&lt;script&gt;');
  });

  it('ignores non-array values', () => {
    const el = document.createElement('span');
    el.textContent = 'before';
    renderer('array').render(makeTarget(el), 'not-an-array', emptyContext());
    expect(el.textContent).toBe('before');
  });

  it('blocks share the array semantics', () => {
    const el = document.createElement('span');
    renderer('blocks').render(makeTarget(el), ['a', 'b'], emptyContext());
    expect(el.textContent).toBe('a, b');
  });
});

afterEach(() => {
  // No global state to reset — renderers are pure functions of element+value.
});
