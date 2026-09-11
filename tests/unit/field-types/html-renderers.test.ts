import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSanitizerPolicy } from '@security/sanitizer';
import { registerBlockRenderer } from '@lexical/blocks/registry';
import { __resetBlockWarningsForTests } from '@field-types/rich-text';
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
    // LP0410 and LP0413 go to the console, warn-once per block type and
    // verdict; most cases here are about the DOM, and the last three about
    // the verdict the write speaks once it knows it.
    let warn: ReturnType<typeof silenceWarn>;
    beforeEach(() => {
      __resetBlockWarningsForTests();
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
      // The server dropped the empty outro paragraph: two children against three.
      el.innerHTML = '<p>old</p><figure><img src="https://cdn.example.com/a.jpg"></figure>';
      rendererNamed('richText').render(makeTarget(el), mediaDocument, emptyContext());
      expect(el.querySelector('img')).toBeNull();
      expect(el.querySelector('.lp-block')?.outerHTML).toBe(
        '<div class="lp-block lp-block--mediablock"></div>',
      );
    });

    // Z29: the template's wrapper around the field — `<div class="prose">` —
    // is where the blocks are, so that is where the pairing runs, and it stays.
    describe('inside the wrapper a template puts around the field', () => {
      it('pairs inside the wrapper and keeps it', () => {
        const el = document.createElement('div');
        el.innerHTML =
          '<div class="prose"><p>old</p><figure><img src="https://cdn.example.com/a.jpg"></figure><p>old</p></div>';
        const wrapper = el.firstElementChild;
        const figure = el.querySelector('figure');
        rendererNamed('richText').render(makeTarget(el), mediaDocument, emptyContext());
        expect(el.firstElementChild).toBe(wrapper);
        expect(el.children).toHaveLength(1);
        expect(wrapper?.querySelector('figure')).toBe(figure);
        expect(wrapper?.children[0]?.textContent).toBe('intro');
      });

      it('does not take a lone paragraph for a wrapper when the document gains a second', () => {
        const el = document.createElement('div');
        el.innerHTML = '<p>only</p>';
        rendererNamed('richText').render(
          makeTarget(el),
          {
            root: {
              children: [
                { type: 'paragraph', children: [{ type: 'text', text: 'one' }] },
                { type: 'paragraph', children: [{ type: 'text', text: 'two' }] },
              ],
            },
          },
          emptyContext(),
        );
        expect(el.innerHTML).toBe('<p>one</p><p>two</p>');
      });

      it('does not take a block it rendered itself for a wrapper', () => {
        // The default `cta` block renders a `<div>`; the editor types a paragraph after it.
        registerBlockRenderer('cta', () => '<div class="lp-block-cta">go</div>');
        const el = document.createElement('div');
        el.innerHTML = '<div class="lp-block-cta">go</div>';
        rendererNamed('richText').render(
          makeTarget(el),
          {
            root: {
              children: [
                { type: 'block', fields: { blockType: 'cta' } },
                { type: 'paragraph', children: [{ type: 'text', text: 'after' }] },
              ],
            },
          },
          emptyContext(),
        );
        expect(el.innerHTML).toBe('<div class="lp-block-cta">go</div><p>after</p>');
      });

      it('leaves a wrapper that carries a binding of its own alone', () => {
        const el = document.createElement('div');
        el.innerHTML = '<div class="prose" data-payload-field="other"><p>old</p><p>old</p></div>';
        rendererNamed('richText').render(
          makeTarget(el),
          {
            root: {
              children: [
                { type: 'paragraph', children: [{ type: 'text', text: 'one' }] },
                { type: 'paragraph', children: [{ type: 'text', text: 'two' }] },
              ],
            },
          },
          emptyContext(),
        );
        expect(el.innerHTML).toBe('<p>one</p><p>two</p>');
      });

      it('does not descend for a document of one element', () => {
        // One live block-shaped element against one rendered placeholder is the
        // positional pairing's own case: the server's `<div class="callout">` is kept whole.
        const el = document.createElement('div');
        el.innerHTML = '<div class="callout"><strong>Heads up</strong><p>body</p></div>';
        const callout = el.firstElementChild;
        rendererNamed('richText').render(
          makeTarget(el),
          { root: { children: [{ type: 'block', fields: { blockType: 'callout' } }] } },
          emptyContext(),
        );
        expect(el.firstElementChild).toBe(callout);
        expect(el.querySelector('strong')?.textContent).toBe('Heads up');
      });
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

    // Z30: the verdict is spoken by the write, after it. Before, the renderer
    // said "keeping" while the write was about to lose the block.
    it('reports a block it lost through the context, once the write is done', () => {
      const el = document.createElement('div');
      // The server dropped the empty outro paragraph: two children against three.
      el.innerHTML = '<p>old</p><figure><img src="https://cdn.example.com/a.jpg"></figure>';
      const seen: string[] = [];
      const reportUnfaithful = vi.fn((_target: unknown, reason: string) => {
        seen.push(`${reason} | ${el.innerHTML}`);
      });
      rendererNamed('richText').render(makeTarget(el), mediaDocument, {
        ...emptyContext(),
        reportUnfaithful,
      });
      expect(reportUnfaithful).toHaveBeenCalledTimes(1);
      // At the time of the report the placeholder already stands on the page.
      expect(seen[0]).toBe(
        'lost the markup the server drew for block "mediaBlock" | ' +
          '<p>intro</p><div class="lp-block lp-block--mediablock"></div><p>outro</p>',
      );
      const warned = warn.mock.calls.map(String).join(' ');
      expect(warned).toContain('LP0413');
      expect(warned).not.toContain('LP0410');
    });

    it('reports nothing for a container the page left empty', () => {
      const el = document.createElement('div');
      const reportUnfaithful = vi.fn();
      rendererNamed('richText').render(makeTarget(el), mediaDocument, {
        ...emptyContext(),
        reportUnfaithful,
      });
      expect(el.querySelector('.lp-block')).not.toBeNull();
      expect(reportUnfaithful).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it('does not call a placeholder answered by an earlier placeholder "kept"', () => {
      const el = document.createElement('div');
      el.innerHTML = '<p>old</p><div class="lp-block lp-block--mediablock"></div><p>old</p>';
      const reportUnfaithful = vi.fn();
      rendererNamed('richText').render(makeTarget(el), mediaDocument, {
        ...emptyContext(),
        reportUnfaithful,
      });
      expect(reportUnfaithful).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
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
