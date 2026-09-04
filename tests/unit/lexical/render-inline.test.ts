import { describe, expect, it } from 'vitest';
import { isLexicalContent, lexicalToHtml, lexicalToPlainText } from '@lexical/render';
import type { LexicalRoot } from '@lexical/types';
import { makeRoot, paragraphWith } from './helpers';

const RAW = { sanitize: false } as const;

describe('isLexicalContent', () => {
  it('accepts a minimal Lexical root', () => {
    expect(isLexicalContent({ root: { children: [] } })).toBe(true);
  });

  it.each([null, undefined, 'string', 42, true, {}, { root: null }, { root: { children: 'no' } }])(
    'rejects %s',
    (value) => {
      expect(isLexicalContent(value)).toBe(false);
    },
  );
});

describe('lexicalToHtml — text formatting', () => {
  it.each([
    [0, 'plain'],
    [1, '<strong>plain</strong>'],
    [2, '<em>plain</em>'],
    [4, '<s>plain</s>'],
    [8, '<u>plain</u>'],
    [16, '<code>plain</code>'],
    [32, '<sub>plain</sub>'],
    [64, '<sup>plain</sup>'],
    [128, '<mark>plain</mark>'],
  ])('renders format=%i', (format, expected) => {
    const html = lexicalToHtml(paragraphWith({ type: 'text', text: 'plain', format }), RAW);
    expect(html).toBe(`<p>${expected}</p>`);
  });

  it('applies all formats together in a stable order', () => {
    const html = lexicalToHtml(
      paragraphWith({ type: 'text', text: 'x', format: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 }),
      RAW,
    );
    for (const tag of ['strong', 'em', 'u', 's', 'code', 'sub', 'sup', 'mark']) {
      expect(html).toContain(`<${tag}>`);
    }
  });

  it('escapes html in text content', () => {
    const html = lexicalToHtml(paragraphWith({ type: 'text', text: '<script>x</script>' }), RAW);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('lexicalToHtml — vanilla Lexical links', () => {
  it('renders safe external links with rel attrs', () => {
    const html = lexicalToHtml(
      paragraphWith({
        type: 'link',
        url: 'https://example.com',
        children: [{ type: 'text', text: 'click' }],
      }),
      RAW,
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('drops links with unsafe URLs but preserves children', () => {
    const html = lexicalToHtml(
      paragraphWith({
        type: 'link',
        url: 'javascript:alert(1)',
        children: [{ type: 'text', text: 'bad' }],
      }),
      RAW,
    );
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('bad');
  });

  it('honours title attribute', () => {
    const html = lexicalToHtml(
      paragraphWith({
        type: 'link',
        url: '/local',
        title: 'tooltip',
        children: [{ type: 'text', text: 'x' }],
      }),
      RAW,
    );
    expect(html).toContain('title="tooltip"');
  });

  it('autolink uses the same renderer', () => {
    const html = lexicalToHtml(
      paragraphWith({
        type: 'autolink',
        url: 'https://auto.example.com',
        children: [{ type: 'text', text: 'auto' }],
      }),
      RAW,
    );
    expect(html).toContain('href="https://auto.example.com"');
  });

  it('honours a non-blank explicit target', () => {
    const html = lexicalToHtml(
      paragraphWith({
        type: 'link',
        url: '/local',
        target: '_top',
        children: [{ type: 'text', text: 'x' }],
      }),
      RAW,
    );
    expect(html).toContain('target="_top"');
  });

  it('rewrites target=_blank to include noopener', () => {
    const html = lexicalToHtml(
      paragraphWith({
        type: 'link',
        url: '/local',
        target: '_blank',
        children: [{ type: 'text', text: 'x' }],
      }),
      RAW,
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('lexicalToHtml — code-highlight', () => {
  it('renders inline code-highlight tokens with token class', () => {
    const html = lexicalToHtml(
      paragraphWith(
        { type: 'code-highlight', text: 'const', highlightType: 'keyword' },
        { type: 'text', text: ' x' },
      ),
      RAW,
    );
    expect(html).toContain('<span class="token-keyword">const</span>');
  });

  it('renders code-highlight without highlightType as plain span', () => {
    const html = lexicalToHtml(paragraphWith({ type: 'code-highlight', text: 'plain' }), RAW);
    expect(html).toContain('<span>plain</span>');
  });

  it('extracts text from nested code children', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'code',
          children: [
            { type: 'code-highlight', text: 'a' },
            { type: 'code-highlight', text: 'b' },
          ],
        },
      ]),
      RAW,
    );
    expect(html).toBe('<pre><code>ab</code></pre>');
  });

  it('reduces a language to a safe class fragment', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'code', language: 'C++ "x"', children: [{ type: 'text', text: 'y' }] }]),
      RAW,
    );
    expect(html).toContain('class="language-c----x-"');
  });
});

describe('lexicalToHtml — fallback behaviour', () => {
  it('renders children for unknown block types', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'unknown-thing', children: [{ type: 'text', text: 'salvaged' }] }]),
      RAW,
    );
    expect(html).toBe('salvaged');
  });

  it('returns empty string for unknown leaf nodes', () => {
    expect(lexicalToHtml(makeRoot([{ type: 'unknown-leaf' }]), RAW)).toBe('');
  });

  it('returns empty string for invalid input', () => {
    expect(lexicalToHtml({} as LexicalRoot)).toBe('');
  });
});

describe('lexicalToPlainText', () => {
  it('returns the concatenated text content', () => {
    const text = lexicalToPlainText(
      makeRoot([
        { type: 'paragraph', children: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', children: [{ type: 'text', text: 'two' }] },
      ]),
    );
    expect(text).toBe('one\ntwo');
  });

  it('renders linebreaks as \\n', () => {
    const text = lexicalToPlainText(
      paragraphWith(
        { type: 'text', text: 'a' },
        { type: 'linebreak' },
        { type: 'text', text: 'b' },
      ),
    );
    expect(text).toBe('a\nb');
  });

  it('returns empty string for invalid input', () => {
    expect(lexicalToPlainText({} as LexicalRoot)).toBe('');
  });
});
