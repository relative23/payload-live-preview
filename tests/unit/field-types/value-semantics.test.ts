import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { setSanitizerPolicy } from '@security/sanitizer';
import { emptyContext, makeTarget, rendererNamed } from './helpers';

/**
 * The one value contract (docs/renderers.md, "Value semantics"): an empty
 * value clears and counts as a write; an unsafe URL clears the URL attribute
 * and warns once; a value with no usable URL is left alone.
 */

let warn: MockInstance<(typeof console)['warn']>;

beforeEach(() => {
  setSanitizerPolicy('strict');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  setSanitizerPolicy('strict');
});

describe('empty values clear, and a clear is a write', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('url on an anchor: %s removes href and text', (_label, value) => {
    const el = document.createElement('a');
    el.href = 'https://example.com/';
    el.textContent = 'old';
    expect(rendererNamed('url').render(makeTarget(el), value, emptyContext())).toBeUndefined();
    expect(el.hasAttribute('href')).toBe(false);
    expect(el.textContent).toBe('');
  });

  it('email on an anchor removes href and text', () => {
    const el = document.createElement('a');
    el.href = 'mailto:x@example.com';
    el.textContent = 'x@example.com';
    rendererNamed('email').render(makeTarget(el), null, emptyContext());
    expect(el.hasAttribute('href')).toBe(false);
    expect(el.textContent).toBe('');
  });

  it('relationship on an anchor removes href and text', () => {
    const el = document.createElement('a');
    el.href = '/posts/x';
    el.textContent = 'x';
    rendererNamed('relationship').render(makeTarget(el), null, emptyContext());
    expect(el.hasAttribute('href')).toBe(false);
    expect(el.textContent).toBe('');
  });

  it('image on <img> removes src, srcset and sizes', () => {
    const el = document.createElement('img');
    el.src = 'https://cdn.example.com/a.jpg';
    el.setAttribute('srcset', 'https://cdn.example.com/a-400.jpg 400w');
    el.setAttribute('sizes', '100vw');
    expect(rendererNamed('image').render(makeTarget(el), null, emptyContext())).toBeUndefined();
    expect(el.hasAttribute('src')).toBe(false);
    expect(el.hasAttribute('srcset')).toBe(false);
    expect(el.hasAttribute('sizes')).toBe(false);
  });

  it('image on a block clears the background image', () => {
    const el = document.createElement('div');
    el.style.backgroundImage = 'url("https://cdn.example.com/a.jpg")';
    rendererNamed('image').render(makeTarget(el), '', emptyContext());
    expect(el.style.backgroundImage).toBe('');
  });

  it('upload on <img>, <a> and a block clears each one', () => {
    const img = document.createElement('img');
    img.src = 'https://cdn.example.com/a.jpg';
    const a = document.createElement('a');
    a.href = 'https://cdn.example.com/a.pdf';
    a.textContent = 'a.pdf';
    const div = document.createElement('div');
    div.innerHTML = '<a href="https://cdn.example.com/a.pdf">a.pdf</a>';
    const upload = rendererNamed('upload');

    expect(upload.render(makeTarget(img), null, emptyContext())).toBeUndefined();
    upload.render(makeTarget(a), undefined, emptyContext());
    upload.render(makeTarget(div), '', emptyContext());

    expect(img.hasAttribute('src')).toBe(false);
    expect(a.hasAttribute('href')).toBe(false);
    expect(a.textContent).toBe('');
    expect(div.innerHTML).toBe('');
  });

  it('richText, html and array empty their element', () => {
    const rich = document.createElement('div');
    rich.innerHTML = '<p>old</p>';
    const html = document.createElement('div');
    html.innerHTML = '<p>old</p>';
    const list = document.createElement('ul');
    list.innerHTML = '<li>old</li>';
    const joined = document.createElement('span');
    joined.textContent = 'a, b';

    expect(
      rendererNamed('richText').render(makeTarget(rich), null, emptyContext()),
    ).toBeUndefined();
    rendererNamed('html').render(makeTarget(html), '', emptyContext());
    expect(
      rendererNamed('array').render(
        makeTarget(list, { arrayTemplate: '<li>{{title}}</li>' }),
        null,
        emptyContext(),
      ),
    ).toBeUndefined();
    rendererNamed('array').render(makeTarget(joined), undefined, emptyContext());

    expect(rich.innerHTML).toBe('');
    expect(html.innerHTML).toBe('');
    expect(list.innerHTML).toBe('');
    expect(joined.textContent).toBe('');
  });

  it('structural-array removes every item', () => {
    const el = document.createElement('ul');
    const structural = rendererNamed('structural-array');
    const target = makeTarget(el, {
      fieldType: 'structural-array',
      arrayTemplate: '<li>{{title}}</li>',
    });
    structural.render(
      target,
      [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
      emptyContext(),
    );
    expect(el.children).toHaveLength(2);

    expect(structural.render(target, null, emptyContext())).toBeUndefined();
    expect(el.children).toHaveLength(0);
  });

  it('text, textarea, number, date, select and checkbox clear their control', () => {
    const text = document.createElement('input');
    text.value = 'x';
    const textarea = document.createElement('textarea');
    textarea.value = 'x';
    const number = document.createElement('input');
    number.type = 'number';
    number.value = '3';
    const date = document.createElement('input');
    date.type = 'date';
    date.value = '2025-06-15';
    const select = document.createElement('select');
    const option = document.createElement('option');
    option.value = 'a';
    select.appendChild(option);
    select.value = 'a';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;

    rendererNamed('text').render(makeTarget(text), null, emptyContext());
    rendererNamed('textarea').render(makeTarget(textarea), null, emptyContext());
    rendererNamed('number').render(makeTarget(number), '', emptyContext());
    rendererNamed('date').render(makeTarget(date), undefined, emptyContext());
    rendererNamed('select').render(makeTarget(select), null, emptyContext());
    rendererNamed('checkbox').render(makeTarget(checkbox), null, emptyContext());

    expect(text.value).toBe('');
    expect(textarea.value).toBe('');
    expect(number.value).toBe('');
    expect(date.value).toBe('');
    expect(select.value).toBe('');
    expect(checkbox.checked).toBe(false);
  });
});

describe('unsafe URLs clear the attribute and warn once per element', () => {
  it('url', () => {
    const el = document.createElement('a');
    el.href = 'https://example.com/';
    const url = rendererNamed('url');
    url.render(makeTarget(el), 'javascript:alert(1)', emptyContext());
    url.render(makeTarget(el), 'javascript:alert(2)', emptyContext());
    expect(el.hasAttribute('href')).toBe(false);
    expect(el.textContent).toBe('javascript:alert(2)');
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('LP0401');
  });

  it('relationship', () => {
    const el = document.createElement('a');
    el.href = '/posts/x';
    rendererNamed('relationship').render(
      makeTarget(el),
      { title: 'x', url: 'javascript:alert(1)' },
      emptyContext(),
    );
    expect(el.hasAttribute('href')).toBe(false);
    expect(el.textContent).toBe('x');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('image, as a write', () => {
    const el = document.createElement('img');
    el.src = 'https://cdn.example.com/a.jpg';
    el.setAttribute('srcset', 'https://cdn.example.com/a-400.jpg 400w');
    expect(
      rendererNamed('image').render(makeTarget(el), { url: 'javascript:alert(1)' }, emptyContext()),
    ).toBeUndefined();
    expect(el.hasAttribute('src')).toBe(false);
    expect(el.hasAttribute('srcset')).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('upload', () => {
    const el = document.createElement('a');
    el.href = 'https://cdn.example.com/a.pdf';
    expect(
      rendererNamed('upload').render(makeTarget(el), { url: 'data:text/html,x' }, emptyContext()),
    ).toBeUndefined();
    expect(el.hasAttribute('href')).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('values without a usable URL leave the element alone', () => {
  it('image and upload do not write for a media object without url', () => {
    const img = document.createElement('img');
    img.src = 'https://cdn.example.com/a.jpg';
    expect(rendererNamed('image').render(makeTarget(img), { alt: 'x' }, emptyContext())).toBe(
      false,
    );
    expect(rendererNamed('upload').render(makeTarget(img), { alt: 'x' }, emptyContext())).toBe(
      false,
    );
    expect(img.src).toBe('https://cdn.example.com/a.jpg');
    expect(warn).not.toHaveBeenCalled();
  });

  it('relationship writes the label and keeps href', () => {
    const el = document.createElement('a');
    el.setAttribute('href', '/posts/x');
    rendererNamed('relationship').render(makeTarget(el), { title: 'renamed' }, emptyContext());
    expect(el.getAttribute('href')).toBe('/posts/x');
    expect(el.textContent).toBe('renamed');
  });
});
