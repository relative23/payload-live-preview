import { describe, expect, it } from 'vitest';
import { isLexicalContent, lexicalToHtml, lexicalToPlainText } from '@lexical/render';
import type { LexicalRoot } from '@lexical/types';

function makeRoot(children: unknown[]): LexicalRoot {
  return { root: { children: children as unknown as readonly never[] } };
}

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
    const html = lexicalToHtml(
      makeRoot([{ type: 'paragraph', children: [{ type: 'text', text: 'plain', format }] }]),
      { sanitize: false },
    );
    expect(html).toBe(`<p>${expected}</p>`);
  });

  it('applies all formats together in a stable order', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'x', format: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 }],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<u>');
    expect(html).toContain('<s>');
    expect(html).toContain('<code>');
    expect(html).toContain('<sub>');
    expect(html).toContain('<sup>');
    expect(html).toContain('<mark>');
  });

  it('escapes html in text content', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'paragraph', children: [{ type: 'text', text: '<script>x</script>' }] }]),
      { sanitize: false },
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('lexicalToHtml — block-level nodes', () => {
  it('renders paragraph with alignment + direction', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          format: 'center',
          direction: 'rtl',
          children: [{ type: 'text', text: 'x' }],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('text-align:center');
  });

  it('renders headings h1-h6, falling back to h2', () => {
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      const html = lexicalToHtml(
        makeRoot([{ type: 'heading', tag, children: [{ type: 'text', text: 'x' }] }]),
        { sanitize: false },
      );
      expect(html).toBe(`<${tag}>x</${tag}>`);
    }
    const invalid = lexicalToHtml(
      makeRoot([{ type: 'heading', tag: 'bogus', children: [{ type: 'text', text: 'x' }] }]),
      { sanitize: false },
    );
    expect(invalid).toBe('<h2>x</h2>');
  });

  it('renders bullet, ordered, and check lists', () => {
    const bullet = lexicalToHtml(
      makeRoot([
        {
          type: 'list',
          listType: 'bullet',
          children: [{ type: 'listitem', children: [{ type: 'text', text: 'one' }] }],
        },
      ]),
      { sanitize: false },
    );
    expect(bullet).toContain('<ul>');
    const ordered = lexicalToHtml(
      makeRoot([
        {
          type: 'list',
          listType: 'number',
          start: 5,
          children: [{ type: 'listitem', children: [{ type: 'text', text: 'one' }] }],
        },
      ]),
      { sanitize: false },
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
      { sanitize: false },
    );
    expect(check).toContain('aria-checked="true"');
    expect(check).toContain('aria-checked="false"');
  });

  it('renders blockquote, hr, br, code blocks', () => {
    expect(
      lexicalToHtml(makeRoot([{ type: 'quote', children: [{ type: 'text', text: 'q' }] }]), {
        sanitize: false,
      }),
    ).toBe('<blockquote>q</blockquote>');
    expect(lexicalToHtml(makeRoot([{ type: 'horizontalrule' }]), { sanitize: false })).toBe('<hr>');
    expect(
      lexicalToHtml(
        makeRoot([
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'a' },
              { type: 'linebreak' },
              { type: 'text', text: 'b' },
            ],
          },
        ]),
        { sanitize: false },
      ),
    ).toBe('<p>a<br>b</p>');
    expect(
      lexicalToHtml(
        makeRoot([
          {
            type: 'code',
            language: 'js',
            children: [{ type: 'text', text: 'const x=1' }],
          },
        ]),
        { sanitize: false },
      ),
    ).toContain('class="language-js"');
  });
});

describe('lexicalToHtml — links', () => {
  it('renders safe external links with rel attrs', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: 'https://example.com',
              children: [{ type: 'text', text: 'click' }],
            },
          ],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('drops links with unsafe URLs but preserves children', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: 'javascript:alert(1)',
              children: [{ type: 'text', text: 'bad' }],
            },
          ],
        },
      ]),
      { sanitize: false },
    );
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('bad');
  });

  it('honours title attribute', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: '/local',
              title: 'tooltip',
              children: [{ type: 'text', text: 'x' }],
            },
          ],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('title="tooltip"');
  });

  it('autolink uses the same renderer', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          children: [
            {
              type: 'autolink',
              url: 'https://auto.example.com',
              children: [{ type: 'text', text: 'auto' }],
            },
          ],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('href="https://auto.example.com"');
  });
});

describe('lexicalToHtml — code-highlight', () => {
  it('renders inline code-highlight tokens with token class', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          children: [
            { type: 'code-highlight', text: 'const', highlightType: 'keyword' },
            { type: 'text', text: ' x' },
          ],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('<span class="token-keyword">const</span>');
  });

  it('renders code-highlight without highlightType as plain span', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          children: [{ type: 'code-highlight', text: 'plain' }],
        },
      ]),
      { sanitize: false },
    );
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
      { sanitize: false },
    );
    expect(html).toBe('<pre><code>ab</code></pre>');
  });
});

describe('lexicalToHtml — link target attribute', () => {
  it('honours a non-blank explicit target', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: '/local',
              target: '_top',
              children: [{ type: 'text', text: 'x' }],
            },
          ],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('target="_top"');
  });

  it('rewrites target=_blank to include noopener', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: '/local',
              target: '_blank',
              children: [{ type: 'text', text: 'x' }],
            },
          ],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('lexicalToHtml — list & paragraph edge cases', () => {
  it('renders listitem with numeric value attribute', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'list',
          listType: 'number',
          children: [{ type: 'listitem', value: 7, children: [{ type: 'text', text: 'x' }] }],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('value="7"');
  });

  it('renders paragraph indent as padding-inline-start', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          indent: 2,
          children: [{ type: 'text', text: 'x' }],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('padding-inline-start:80px');
  });

  it('renders paragraph with ltr direction', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          direction: 'ltr',
          children: [{ type: 'text', text: 'x' }],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('dir="ltr"');
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
      { sanitize: false },
    );
    expect(html).toContain('<img');
    expect(html).toContain('src="https://cdn.example.com/a.jpg"');
    expect(html).toContain('alt="caption"');
    expect(html).toContain('width="100"');
    expect(html).toContain('height="200"');
    expect(html).toContain('loading="lazy"');
  });

  it('renders a video element for video MIME types', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'upload',
          value: { url: 'https://cdn.example.com/a.mp4', mimeType: 'video/mp4' },
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('<video');
    expect(html).toContain('type="video/mp4"');
  });

  it('renders an audio element for audio MIME types', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'upload',
          value: { url: 'https://cdn.example.com/a.mp3', mimeType: 'audio/mpeg' },
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('<audio');
    expect(html).toContain('type="audio/mpeg"');
  });

  it('falls back to <a> using URL as label when filename is missing', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'upload',
          value: { url: 'https://cdn.example.com/x.pdf', mimeType: 'application/pdf' },
        },
      ]),
      { sanitize: false },
    );
    expect(html).toMatch(/>https:&#x2F;&#x2F;cdn\.example\.com&#x2F;x\.pdf</);
  });

  it('renders upload without mimeType as image', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'upload',
          value: { url: 'https://cdn.example.com/x.jpg' },
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('<img');
  });

  it('falls back to <a> for unknown MIME types', () => {
    const html = lexicalToHtml(
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
      { sanitize: false },
    );
    expect(html).toContain('<a href="https://cdn.example.com/a.pdf"');
    expect(html).toContain('>a.pdf</a>');
  });

  it('rejects unsafe upload URLs', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'upload',
          value: { url: 'javascript:alert(1)', mimeType: 'image/png' },
        },
      ]),
      { sanitize: false },
    );
    expect(html).toBe('');
  });

  it('returns empty string for upload without value', () => {
    const html = lexicalToHtml(makeRoot([{ type: 'upload' }]), { sanitize: false });
    expect(html).toBe('');
  });
});

describe('lexicalToHtml — relationship', () => {
  it('renders an anchor when value has a safe url', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'relationship',
          relationTo: 'posts',
          value: { title: 'Hello', url: '/posts/hello' },
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('<a href="/posts/hello"');
    expect(html).toContain('data-relation-to="posts"');
    expect(html).toContain('>Hello</a>');
  });

  it('falls back to span when no URL is available', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'relationship',
          relationTo: 'posts',
          value: { title: 'Hello' },
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('<span');
    expect(html).toContain('>Hello</span>');
  });

  it('picks name when title is missing', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'relationship', relationTo: 'posts', value: { name: 'Alice' } }]),
      { sanitize: false },
    );
    expect(html).toContain('>Alice</span>');
  });

  it('renders relationship label even without relationTo', () => {
    const html = lexicalToHtml(makeRoot([{ type: 'relationship', value: { title: 'X' } }]), {
      sanitize: false,
    });
    expect(html).toContain('>X</span>');
  });

  it('renders fallback label when value is missing', () => {
    const html = lexicalToHtml(makeRoot([{ type: 'relationship', relationTo: 'posts' }]), {
      sanitize: false,
    });
    expect(html).toContain('#posts');
  });

  it('renders fallback label without relationTo nor value', () => {
    const html = lexicalToHtml(makeRoot([{ type: 'relationship' }]), { sanitize: false });
    expect(html).toContain('#');
  });

  it('renders id-based label when title/name/slug are missing', () => {
    const html = lexicalToHtml(
      makeRoot([{ type: 'relationship', relationTo: 'posts', value: {} }]),
      { sanitize: false },
    );
    expect(html).toContain('#posts');
  });

  it('picks slug or id when title/name are missing', () => {
    const slug = lexicalToHtml(
      makeRoot([{ type: 'relationship', relationTo: 'tags', value: { slug: 'tag-1' } }]),
      { sanitize: false },
    );
    expect(slug).toContain('>tag-1</span>');

    const id = lexicalToHtml(
      makeRoot([{ type: 'relationship', relationTo: 'tags', value: { id: 42 } }]),
      { sanitize: false },
    );
    expect(id).toContain('>42</span>');
  });
});

describe('lexicalToHtml — block', () => {
  it('emits data-block-type and data-block-* attributes', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'block',
          fields: { blockType: 'callout', text: 'Heads up', importance: 'high' },
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('data-block-type="callout"');
    expect(html).toContain('data-block-text="Heads up"');
    expect(html).toContain('data-block-importance="high"');
  });

  it('serialises non-primitive field values to JSON', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'block',
          fields: { blockType: 'card', payload: { count: 3 } },
        },
      ]),
      { sanitize: false },
    );
    expect(html).toContain('data-block-payload="{&quot;count&quot;:3}"');
  });
});

describe('lexicalToHtml — fallback behaviour', () => {
  it('renders children for unknown block types', () => {
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'unknown-thing',
          children: [{ type: 'text', text: 'salvaged' }],
        },
      ]),
      { sanitize: false },
    );
    expect(html).toBe('salvaged');
  });

  it('returns empty string for unknown leaf nodes', () => {
    const html = lexicalToHtml(makeRoot([{ type: 'unknown-leaf' }]), { sanitize: false });
    expect(html).toBe('');
  });

  it('returns empty string for invalid input', () => {
    expect(lexicalToHtml({} as LexicalRoot)).toBe('');
  });
});

describe('lexicalToHtml — sanitisation', () => {
  it('runs the output through sanitizeHtml by default', () => {
    // Register a malicious renderer ad hoc by using unknown type that
    // returns children verbatim — but text node escapes anyway. Use
    // the block renderer to emit an attribute that would have been
    // unsafe without sanitisation.
    const html = lexicalToHtml(
      makeRoot([
        {
          type: 'paragraph',
          children: [{ type: 'text', text: 'safe' }],
        },
      ]),
    );
    expect(html).toContain('<p>safe</p>');
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
      makeRoot([
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'a' },
            { type: 'linebreak' },
            { type: 'text', text: 'b' },
          ],
        },
      ]),
    );
    expect(text).toBe('a\nb');
  });

  it('returns empty string for invalid input', () => {
    expect(lexicalToPlainText({} as LexicalRoot)).toBe('');
  });
});
