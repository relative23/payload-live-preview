import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lexicalToHtml } from '@lexical/render';
import { registerBlockRenderer, __resetBlockRegistryForTests } from '@lexical/blocks/registry';
import { setSanitizerPolicy } from '@security/sanitizer';
import { makeRoot, paragraphWith } from './helpers';

const RAW = { sanitize: false } as const;

/** Keep LP0410 out of the test output while a case is about something else. */
function silenceWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

beforeEach(() => {
  setSanitizerPolicy('strict');
});

afterEach(() => {
  setSanitizerPolicy('strict');
});

describe('lexicalToHtml — block-level nodes', () => {
  it('renders paragraph direction', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'paragraph', direction: 'rtl', children: [{ type: 'text', text: 'x' }] }]),
      RAW,
    );
    expect(html).toBe('<p dir="rtl">x</p>');
  });

  it('renders headings h1-h6, falling back to h2', () => {
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      const html = lexicalToHtml(
        makeRoot([{ type: 'heading', tag, children: [{ type: 'text', text: 'x' }] }]),
        RAW,
      );
      expect(html).toBe(`<${tag}>x</${tag}>`);
    }
    const invalid = lexicalToHtml(
      makeRoot([{ type: 'heading', tag: 'bogus', children: [{ type: 'text', text: 'x' }] }]),
      RAW,
    );
    expect(invalid).toBe('<h2>x</h2>');
  });

  it('renders bullet, ordered, and check lists', () => {
    const item = { type: 'listitem', children: [{ type: 'text', text: 'one' }] };
    expect(
      lexicalToHtml(makeRoot([{ type: 'list', listType: 'bullet', children: [item] }]), RAW),
    ).toContain('<ul>');
    const ordered = lexicalToHtml(
      makeRoot([{ type: 'list', listType: 'number', start: 5, children: [item] }]),
      RAW,
    );
    expect(ordered).toContain('<ol');
    expect(ordered).toContain('start="5"');
    const check = lexicalToHtml(
      makeRoot([
        {
          type: 'list',
          listType: 'check',
          children: [
            { type: 'listitem', checked: true, children: [{ type: 'text', text: 'done' }] },
            { type: 'listitem', checked: false, children: [{ type: 'text', text: 'todo' }] },
          ],
        },
      ]),
      RAW,
    );
    expect(check).toContain('aria-checked="true"');
    expect(check).toContain('aria-checked="false"');
  });

  it('renders listitem with numeric value attribute', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'list',
          listType: 'number',
          children: [{ type: 'listitem', value: 7, children: [{ type: 'text', text: 'x' }] }],
        },
      ]),
      RAW,
    );
    expect(html).toContain('value="7"');
  });

  it('renders blockquote, hr, br, code blocks', () => {
    expect(
      lexicalToHtml(makeRoot([{ type: 'quote', children: [{ type: 'text', text: 'q' }] }]), RAW),
    ).toBe('<blockquote>q</blockquote>');
    expect(lexicalToHtml(makeRoot([{ type: 'horizontalrule' }]), RAW)).toBe('<hr>');
    expect(
      lexicalToHtml(
        paragraphWith(
          { type: 'text', text: 'a' },
          { type: 'linebreak' },
          { type: 'text', text: 'b' },
        ),
        RAW,
      ),
    ).toBe('<p>a<br>b</p>');
    expect(
      lexicalToHtml(
        makeRoot([
          { type: 'code', language: 'js', children: [{ type: 'text', text: 'const x=1' }] },
        ]),
        RAW,
      ),
    ).toContain('class="language-js"');
  });
});

describe('lexicalToHtml — upload', () => {
  it('renders an image for image MIME types', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'upload',
          relationTo: 'media',
          value: {
            url: 'https://cdn.example.com/a.jpg',
            alt: 'caption',
            width: 100,
            height: 200,
            mimeType: 'image/jpeg',
          },
        },
      ]),
      RAW,
    );
    expect(html).toBe(
      '<img src="https://cdn.example.com/a.jpg" alt="caption" width="100" height="200" loading="lazy" decoding="async">',
    );
  });

  it('renders video and audio elements by MIME type', () => {
    const video = lexicalToHtml(
      makeRoot([
        { type: 'upload', value: { url: 'https://cdn.example.com/a.mp4', mimeType: 'video/mp4' } },
      ]),
      RAW,
    );
    expect(video).toContain('<video');
    expect(video).toContain('type="video/mp4"');
    const audio = lexicalToHtml(
      makeRoot([
        { type: 'upload', value: { url: 'https://cdn.example.com/a.mp3', mimeType: 'audio/mpeg' } },
      ]),
      RAW,
    );
    expect(audio).toContain('<audio');
    expect(audio).toContain('type="audio/mpeg"');
  });

  it('falls back to <a> for unknown MIME types, using the URL when filename is missing', () => {
    const named = lexicalToHtml(
      makeRoot([
        {
          type: 'upload',
          value: {
            url: 'https://cdn.example.com/a.pdf',
            mimeType: 'application/pdf',
            filename: 'a.pdf',
          },
        },
      ]),
      RAW,
    );
    expect(named).toContain('<a href="https://cdn.example.com/a.pdf"');
    expect(named).toContain('>a.pdf</a>');
    const unnamed = lexicalToHtml(
      makeRoot([
        {
          type: 'upload',
          value: { url: 'https://cdn.example.com/x.pdf', mimeType: 'application/pdf' },
        },
      ]),
      RAW,
    );
    expect(unnamed).toMatch(/>https:&#x2F;&#x2F;cdn\.example\.com&#x2F;x\.pdf</);
  });

  it('renders upload without mimeType as image', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'upload', value: { url: 'https://cdn.example.com/x.jpg' } }]),
      RAW,
    );
    expect(html).toContain('<img');
  });

  it('renders nothing for an unsafe URL or a missing value', () => {
    expect(
      lexicalToHtml(
        makeRoot([
          { type: 'upload', value: { url: 'javascript:alert(1)', mimeType: 'image/png' } },
        ]),
        RAW,
      ),
    ).toBe('');
    expect(lexicalToHtml(makeRoot([{ type: 'upload' }]), RAW)).toBe('');
  });
});

describe('lexicalToHtml — relationship', () => {
  it('renders an anchor with a collection class when value has a safe url', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'relationship',
          relationTo: 'posts',
          value: { title: 'Hello', url: '/posts/hello' },
        },
      ]),
      RAW,
    );
    expect(html).toBe('<a href="/posts/hello" class="lp-relation lp-relation--posts">Hello</a>');
  });

  it('falls back to span when no URL is available', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'relationship', relationTo: 'posts', value: { title: 'Hello' } }]),
      RAW,
    );
    expect(html).toBe('<span class="lp-relation lp-relation--posts">Hello</span>');
  });

  it('picks name, slug or id when title is missing', () => {
    const name = lexicalToHtml(
      makeRoot([{ type: 'relationship', relationTo: 'posts', value: { name: 'Alice' } }]),
      RAW,
    );
    expect(name).toContain('>Alice</span>');
    const slug = lexicalToHtml(
      makeRoot([{ type: 'relationship', relationTo: 'tags', value: { slug: 'tag-1' } }]),
      RAW,
    );
    expect(slug).toContain('>tag-1</span>');
    const id = lexicalToHtml(
      makeRoot([{ type: 'relationship', relationTo: 'tags', value: { id: 42 } }]),
      RAW,
    );
    expect(id).toContain('>42</span>');
  });

  it('renders a fallback label with or without relationTo and value', () => {
    expect(lexicalToHtml(makeRoot([{ type: 'relationship', value: { title: 'X' } }]), RAW)).toBe(
      '<span class="lp-relation">X</span>',
    );
    expect(lexicalToHtml(makeRoot([{ type: 'relationship', relationTo: 'posts' }]), RAW)).toContain(
      '#posts',
    );
    expect(lexicalToHtml(makeRoot([{ type: 'relationship' }]), RAW)).toBe(
      '<span class="lp-relation">#</span>',
    );
    expect(
      lexicalToHtml(makeRoot([{ type: 'relationship', relationTo: 'posts', value: {} }]), RAW),
    ).toContain('#posts');
  });

  it('keeps its class under the strict sanitizer', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'relationship', relationTo: 'posts', value: { title: 'Hello' } }]),
    );
    expect(html).toBe('<span class="lp-relation lp-relation--posts">Hello</span>');
  });
});

describe('lexicalToHtml — block', () => {
  let warn: ReturnType<typeof silenceWarn>;

  beforeEach(() => {
    __resetBlockRegistryForTests();
    warn = silenceWarn();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('emits a class-tagged placeholder for a slug without a renderer', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'block', fields: { blockType: 'callout', text: 'Heads up' } }]),
      RAW,
    );
    expect(html).toBe('<div class="lp-block lp-block--callout"></div>');
  });

  it('never serialises block fields into attributes', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'block', fields: { blockType: 'card', payload: { count: 3 } } }]),
      RAW,
    );
    expect(html).not.toContain('count');
    expect(html).not.toContain('data-');
  });

  it('sanitises the slug used in the class name', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'block', fields: { blockType: 'My Block"<x>' } }]),
      RAW,
    );
    expect(html).toBe('<div class="lp-block lp-block--my-block--x-"></div>');
  });

  it('survives the strict sanitizer', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'block', fields: { blockType: 'callout', text: 'Heads up' } }]),
    );
    expect(html).toBe('<div class="lp-block lp-block--callout"></div>');
  });

  // The verdict on a block nobody registered belongs to the write, which is
  // the one place that knows whether the server's markup survived (LP0410) or
  // not (LP0413). Rendering only names the slug — the real one, because the
  // class carries `sanitizeIdent(slug)` and a hint to register "mediablock"
  // would name a block that does not exist.
  it('names each block it has no renderer for, with the class its placeholder carries', () => {
    const seen: [string, string][] = [];
    const doc = makeRoot([
      { type: 'block', fields: { blockType: 'mediaBlock' } },
      { type: 'paragraph', children: [{ type: 'inlineBlock', fields: { blockType: 'Badge' } }] },
      { type: 'block', fields: { blockType: 'mediaBlock' } },
    ]);
    lexicalToHtml(doc, { ...RAW, onUnrenderedBlock: (type, cls) => seen.push([type, cls]) });
    expect(seen).toEqual([
      ['mediaBlock', 'lp-block lp-block--mediablock'],
      ['Badge', 'lp-inline-block lp-inline-block--badge'],
      ['mediaBlock', 'lp-block lp-block--mediablock'],
    ]);
  });

  it('reaches a block nested in what a registered one rendered', () => {
    registerBlockRenderer(
      'wrapper',
      (fields, ctx) => `<section>${ctx.renderChildren(fields['children'] as never)}</section>`,
    );
    const seen: string[] = [];
    lexicalToHtml(
      makeRoot([
        {
          type: 'block',
          fields: {
            blockType: 'wrapper',
            children: [{ type: 'block', fields: { blockType: 'inner' } }],
          },
        },
      ]),
      { ...RAW, onUnrenderedBlock: (type) => seen.push(type) },
    );
    expect(seen).toEqual(['inner']);
  });

  it('says nothing for a block it can render', () => {
    registerBlockRenderer('quoteBlock', () => '<blockquote>q</blockquote>');
    const seen: string[] = [];
    expect(
      lexicalToHtml(makeRoot([{ type: 'block', fields: { blockType: 'quoteBlock' } }]), {
        ...RAW,
        onUnrenderedBlock: (type) => seen.push(type),
      }),
    ).toBe('<blockquote>q</blockquote>');
    expect(seen).toEqual([]);
  });

  it('warns nothing itself, with or without a listener', () => {
    const doc = makeRoot([{ type: 'block', fields: { blockType: 'mediaBlock' } }]);
    lexicalToHtml(doc, RAW);
    lexicalToHtml(doc, { ...RAW, onUnrenderedBlock: () => {} });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe.each([['compat'], ['strict']])('lexicalToHtml sanitisation under %s', (policy) => {
  beforeEach(() => {
    setSanitizerPolicy(policy as 'compat' | 'strict');
  });

  it('runs the output through sanitizeHtml by default', () => {
    const html = lexicalToHtml(paragraphWith({ type: 'text', text: 'safe' }));
    expect(html).toBe('<p>safe</p>');
  });

  it('keeps table markup', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'table',
          children: [
            {
              type: 'tablerow',
              children: [
                { type: 'tablecell', headerState: 1, children: [{ type: 'text', text: 'h' }] },
              ],
            },
          ],
        },
      ]),
    );
    expect(html).toBe('<table><tbody><tr><th scope="col">h</th></tr></tbody></table>');
  });
});
