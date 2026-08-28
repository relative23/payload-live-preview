import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSanitizerPolicy } from '@security/sanitizer';
import type { RichTextRenderer } from '@core/types';
import { emptyContext, makeTarget, rendererNamed } from './helpers';

beforeEach(() => {
  setSanitizerPolicy('strict');
});

afterEach(() => {
  setSanitizerPolicy('strict');
});

const LEXICAL_DOC = {
  root: { children: [{ type: 'paragraph', children: [{ type: 'text', text: 'hi' }] }] },
};

describe('richText renderer', () => {
  it('renders Lexical content to HTML', () => {
    const el = document.createElement('div');
    rendererNamed('richText').render(makeTarget(el), LEXICAL_DOC, emptyContext());
    expect(el.innerHTML).toContain('<p>hi</p>');
  });

  it('sanitises string HTML', () => {
    const el = document.createElement('div');
    rendererNamed('richText').render(
      makeTarget(el),
      '<p>safe</p><script>alert(1)</script>',
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<p>safe</p>');
    expect(el.innerHTML).not.toContain('<script>');
  });

  it('sanitises a project renderer output too', () => {
    const el = document.createElement('div');
    const renderRichText: RichTextRenderer = () => '<em onclick="x()">custom</em>';
    rendererNamed('richText').render(makeTarget(el), LEXICAL_DOC, {
      ...emptyContext(),
      renderRichText,
    });
    expect(el.innerHTML).toBe('<em>custom</em>');
  });

  it('does not write for a value it cannot render', () => {
    const el = document.createElement('div');
    el.innerHTML = '<p>kept</p>';
    expect(rendererNamed('richText').render(makeTarget(el), 42, emptyContext())).toBe(false);
    expect(el.innerHTML).toBe('<p>kept</p>');
  });
});

describe('html renderer', () => {
  it('strips dangerous tags', () => {
    const el = document.createElement('div');
    rendererNamed('html').render(makeTarget(el), '<p>safe</p><script>bad</script>', emptyContext());
    expect(el.innerHTML).not.toContain('<script>');
  });

  it('clears element for null', () => {
    const el = document.createElement('div');
    el.textContent = 'old';
    rendererNamed('html').render(makeTarget(el), null, emptyContext());
    expect(el.textContent).toBe('');
  });
});

describe.each([['compat'], ['strict']])('HTML-writing renderers under the %s policy', (policy) => {
  beforeEach(() => {
    setSanitizerPolicy(policy as 'compat' | 'strict');
  });

  it('richText keeps Lexical markup and drops an event handler', () => {
    const el = document.createElement('div');
    rendererNamed('richText').render(
      makeTarget(el),
      '<p onclick="x()"><strong>bold</strong></p>',
      emptyContext(),
    );
    expect(el.innerHTML).toBe('<p><strong>bold</strong></p>');
  });

  it('richText renders a Lexical link with rel hardening', () => {
    const el = document.createElement('div');
    rendererNamed('richText').render(
      makeTarget(el),
      {
        root: {
          children: [
            {
              type: 'paragraph',
              children: [
                {
                  type: 'link',
                  fields: { linkType: 'custom', url: 'https://example.com', newTab: false },
                  children: [{ type: 'text', text: 'go' }],
                },
              ],
            },
          ],
        },
      },
      emptyContext(),
    );
    const anchor = el.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('html keeps allowed markup and drops a script', () => {
    const el = document.createElement('div');
    rendererNamed('html').render(
      makeTarget(el),
      '<ul><li class="x">a</li></ul><script>bad</script>',
      emptyContext(),
    );
    expect(el.innerHTML).toBe('<ul><li class="x">a</li></ul>');
  });

  it('array template mode keeps <details> and <button> the author wrote', () => {
    const el = document.createElement('div');
    rendererNamed('array').render(
      makeTarget(el, {
        arrayTemplate:
          '<details><summary>{{title}}</summary><button type="button">x</button></details>',
      }),
      [{ title: 'one' }],
      emptyContext(),
    );
    expect(el.querySelector('details > summary')?.textContent).toBe('one');
    expect(el.querySelector('details > button')?.getAttribute('type')).toBe('button');
  });

  it('array template mode still escapes the value and strips a handler', () => {
    const el = document.createElement('div');
    rendererNamed('array').render(
      makeTarget(el, { arrayTemplate: '<button onclick="x()">{{title}}</button>' }),
      [{ title: '<img src=x onerror=alert(1)>' }],
      emptyContext(),
    );
    const button = el.querySelector('button');
    expect(button?.hasAttribute('onclick')).toBe(false);
    expect(button?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
  });

  it('structural-array keeps the same template elements as array template mode', () => {
    const el = document.createElement('ul');
    rendererNamed('structural-array').render(
      makeTarget(el, {
        fieldType: 'structural-array',
        arrayTemplate:
          '<li><details><summary>{{title}}</summary><button type="button">x</button></details></li>',
      }),
      [{ id: 1, title: 'one' }],
      emptyContext(),
    );
    expect(el.querySelector('li > details > summary')?.textContent).toBe('one');
    expect(el.querySelector('li > details > button')).not.toBeNull();
  });
});
