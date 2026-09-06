import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSanitizerPolicy } from '@security/sanitizer';
import { registerBlockRenderer } from '@lexical/blocks/registry';
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

/** Keep LP0410 out of the test output while a case is about something else. */
function silenceWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

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

  // A block renderer is a project's own code, and nothing here can see whether
  // it escaped the fields it interpolated. `lexicalToHtml` sanitises its own
  // output, which is what keeps that from reaching the page; this pins it at
  // the sink, where the guarantee has to hold.
  it('sanitises what a custom block renderer returns', () => {
    registerBlockRenderer('unescaped-block', (fields) => `<p>${String(fields['text'])}</p>`);
    const el = document.createElement('div');
    rendererNamed('richText').render(
      makeTarget(el),
      {
        root: {
          children: [
            {
              type: 'block',
              fields: { blockType: 'unescaped-block', text: '<img src=x onerror=alert(1)>' },
            },
          ],
        },
      },
      emptyContext(),
    );
    expect(el.innerHTML).not.toContain('onerror');
    expect(el.querySelector('img')?.hasAttribute('onerror') ?? false).toBe(false);
  });

  // LP-2: the empty placeholder for a block without a renderer used to be
  // written over markup the server had already rendered for that block.
  describe('a block the registry cannot render', () => {
    // LP0410 goes to the console, warn-once per block type; these cases are
    // about the DOM, and `render-blocks.test.ts` is about the warning.
    let warn: ReturnType<typeof silenceWarn>;
    beforeEach(() => {
      warn = silenceWarn();
    });
    afterEach(() => {
      warn.mockRestore();
    });

    const mediaDocument = {
      root: {
        children: [
          { type: 'paragraph', children: [{ type: 'text', text: 'intro' }] },
          { type: 'block', fields: { blockType: 'mediaBlock' } },
          { type: 'paragraph', children: [{ type: 'text', text: 'outro' }] },
        ],
      },
    };

    it("keeps the server's element in its place", () => {
      const el = document.createElement('div');
      el.innerHTML =
        '<p>old</p><figure class="wide"><img src="https://cdn.example.com/a.jpg"></figure><p>old</p>';
      const figure = el.querySelector('figure');
      rendererNamed('richText').render(makeTarget(el), mediaDocument, emptyContext());
      expect(el.querySelector('figure')).toBe(figure);
      expect(el.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/a.jpg');
      expect(el.querySelectorAll('p')[0]?.textContent).toBe('intro');
    });

    it('writes the placeholder when the two do not line up', () => {
      const el = document.createElement('div');
      el.innerHTML =
        '<div><p>old</p><figure><img src="https://cdn.example.com/a.jpg"></figure></div>';
      rendererNamed('richText').render(makeTarget(el), mediaDocument, emptyContext());
      expect(el.querySelector('img')).toBeNull();
      expect(el.querySelector('.lp-block')?.outerHTML).toBe(
        '<div class="lp-block lp-block--mediablock"></div>',
      );
    });

    it('keeps both when two blocks have no renderer', () => {
      const el = document.createElement('div');
      el.innerHTML =
        '<figure id="one"><img src="https://cdn.example.com/1.jpg"></figure>' +
        '<p>old</p>' +
        '<figure id="two"><img src="https://cdn.example.com/2.jpg"></figure>';
      rendererNamed('richText').render(
        makeTarget(el),
        {
          root: {
            children: [
              { type: 'block', fields: { blockType: 'mediaBlock' } },
              { type: 'paragraph', children: [{ type: 'text', text: 'between' }] },
              { type: 'block', fields: { blockType: 'mediaBlock' } },
            ],
          },
        },
        emptyContext(),
      );
      expect([...el.querySelectorAll('figure')].map((f) => f.id)).toEqual(['one', 'two']);
      expect(el.querySelector('p')?.textContent).toBe('between');
    });

    it('keeps an inline block nested inside a paragraph', () => {
      const el = document.createElement('div');
      el.innerHTML = '<p>text <abbr title="kept">PLP</abbr> more</p>';
      const abbr = el.querySelector('abbr');
      rendererNamed('richText').render(
        makeTarget(el),
        {
          root: {
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'text', text: 'text ' },
                  { type: 'inlineBlock', fields: { blockType: 'badge' } },
                  { type: 'text', text: ' more' },
                ],
              },
            ],
          },
        },
        emptyContext(),
      );
      expect(el.querySelector('abbr')).toBe(abbr);
    });
  });

  it('leaves the built-in Lexical output untouched', () => {
    const el = document.createElement('div');
    rendererNamed('richText').render(
      makeTarget(el),
      {
        root: {
          children: [
            { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Title' }] },
            {
              type: 'paragraph',
              format: 'center',
              children: [
                { type: 'text', text: 'bold', format: 1 },
                {
                  type: 'link',
                  fields: { url: '/p' },
                  children: [{ type: 'text', text: 'link' }],
                },
              ],
            },
          ],
        },
      },
      emptyContext(),
    );
    expect(el.innerHTML).toContain('<h2>Title</h2>');
    expect(el.innerHTML).toContain('<strong>bold</strong>');
    expect(el.innerHTML).toContain('href="/p"');
    expect(el.innerHTML).toContain('lp-align-center');
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
