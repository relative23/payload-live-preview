import { describe, expect, it, vi } from 'vitest';
import { emptyContext, makeTarget, rendererNamed } from './helpers';

describe('text renderer', () => {
  it('writes textContent for plain text', () => {
    const el = document.createElement('p');
    rendererNamed('text').render(makeTarget(el), 'hello', emptyContext());
    expect(el.textContent).toBe('hello');
  });

  it('switches to innerHTML with <br> for multi-line text', () => {
    const el = document.createElement('div');
    rendererNamed('text').render(makeTarget(el), 'a\nb', emptyContext());
    expect(el.innerHTML).toBe('a<br>b');
  });

  it('writes to input value', () => {
    const el = document.createElement('input');
    rendererNamed('text').render(makeTarget(el), 'val', emptyContext());
    expect(el.value).toBe('val');
  });

  it('flattens Lexical content to plain text', () => {
    const el = document.createElement('p');
    rendererNamed('text').render(
      makeTarget(el),
      { root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: 'rich' }] }] } },
      emptyContext(),
    );
    expect(el.textContent).toBe('rich');
  });

  it('handles null and number values', () => {
    const el = document.createElement('span');
    const text = rendererNamed('text');
    text.render(makeTarget(el), null, emptyContext());
    expect(el.textContent).toBe('');
    text.render(makeTarget(el), 42, emptyContext());
    expect(el.textContent).toBe('42');
  });

  it('keeps updating a multiline field after its own <br> made the element structured', () => {
    const el = document.createElement('blockquote');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = rendererNamed('text');

    text.render(makeTarget(el), 'first line\n\nsecond line', emptyContext());
    expect(el.querySelectorAll('br').length).toBeGreaterThan(0);

    text.render(makeTarget(el), 'replacement value', emptyContext());
    expect(el.textContent).toBe('replacement value');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still refuses when a consumer wraps the value after a multiline write', () => {
    const el = document.createElement('blockquote');
    const text = rendererNamed('text');
    text.render(makeTarget(el), 'first line\n\nsecond line', emptyContext());

    const wrapper = document.createElement('span');
    wrapper.textContent = 'consumer markup';
    el.replaceChildren(wrapper);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    text.render(makeTarget(el), 'replacement value', emptyContext());

    expect(el.firstElementChild?.textContent).toBe('consumer markup');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('protects a wrapper added after a single-line value replaced the breaks', () => {
    const el = document.createElement('blockquote');
    const text = rendererNamed('text');
    text.render(makeTarget(el), 'a\n\nb', emptyContext());
    text.render(makeTarget(el), 'plain', emptyContext());

    const inner = document.createElement('span');
    inner.textContent = 'consumer markup';
    el.append(inner);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    text.render(makeTarget(el), 'replacement', emptyContext());

    expect(el.lastElementChild?.textContent).toBe('consumer markup');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips elements with structured child elements (preserves styled markup)', () => {
    const el = document.createElement('h1');
    const inner1 = document.createElement('span');
    inner1.textContent = 'Brand';
    const inner2 = document.createElement('span');
    inner2.textContent = 'Tagline';
    el.append(inner1, inner2);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rendererNamed('text').render(makeTarget(el), 'replacement value', emptyContext());
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
    rendererNamed('text').render(makeTarget(el), 'forced replacement', emptyContext());
    expect(el.textContent).toBe('forced replacement');
    expect(el.children).toHaveLength(0);
  });

  it('warns only once per element across repeated updates', () => {
    const el = document.createElement('h1');
    el.appendChild(document.createElement('span'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const text = rendererNamed('text');
    text.render(makeTarget(el), 'a', emptyContext());
    text.render(makeTarget(el), 'b', emptyContext());
    text.render(makeTarget(el), 'c', emptyContext());
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('keeps rendering isolated when the structured-markup warning channel throws', () => {
    const el = document.createElement('h1');
    el.appendChild(document.createElement('span'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('hostile console');
    });

    expect(() => {
      rendererNamed('text').render(makeTarget(el), 'replacement', emptyContext());
    }).not.toThrow();
    expect(el.children).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('textarea renderer', () => {
  it('preserves newlines via <br>', () => {
    const el = document.createElement('div');
    rendererNamed('textarea').render(makeTarget(el), 'a\nb', emptyContext());
    expect(el.innerHTML).toBe('a<br>b');
  });

  it('writes to textarea element', () => {
    const el = document.createElement('textarea');
    rendererNamed('textarea').render(makeTarget(el), 'val', emptyContext());
    expect(el.value).toBe('val');
  });

  it('is the text renderer under another name, structured-children guard included', () => {
    const el = document.createElement('div');
    el.appendChild(document.createElement('span'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const textarea = rendererNamed('textarea');

    expect(textarea.name).toBe('textarea');
    textarea.render(makeTarget(el), 'replacement', emptyContext());
    expect(el.children).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
