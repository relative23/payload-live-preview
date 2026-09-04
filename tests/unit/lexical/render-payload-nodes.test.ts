import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lexicalToHtml } from '@lexical/render';
import { registerBlockRenderer, __resetBlockRegistryForTests } from '@lexical/blocks/registry';
import { setSanitizerPolicy } from '@security/sanitizer';
import { makeRoot, paragraphWith } from './helpers';

/** Node shapes as `@payloadcms/richtext-lexical` 3.x serialises them. */

const RAW = { sanitize: false } as const;

function payloadLink(
  fields: Record<string, unknown>,
  text = 'go',
): ReturnType<typeof paragraphWith> {
  return paragraphWith({ type: 'link', fields, children: [{ type: 'text', text }] });
}

beforeEach(() => {
  setSanitizerPolicy('strict');
});

afterEach(() => {
  __resetBlockRegistryForTests();
});

describe('Payload link nodes', () => {
  it('reads the custom URL from fields', () => {
    const html = lexicalToHtml(
      payloadLink({ linkType: 'custom', url: 'https://example.com/docs', newTab: false }),
      RAW,
    );
    expect(html).toBe(
      '<p><a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">go</a></p>',
    );
  });

  it('opens a same-origin link in a new tab only when newTab is set, always with noopener', () => {
    expect(
      lexicalToHtml(payloadLink({ linkType: 'custom', url: '/about', newTab: false }), RAW),
    ).toBe('<p><a href="/about">go</a></p>');
    expect(
      lexicalToHtml(payloadLink({ linkType: 'custom', url: '/about', newTab: true }), RAW),
    ).toBe('<p><a href="/about" target="_blank" rel="noopener noreferrer">go</a></p>');
  });

  it('drops the anchor for an unsafe custom URL and keeps the text', () => {
    expect(
      lexicalToHtml(
        payloadLink({ linkType: 'custom', url: 'javascript:alert(1)', newTab: true }),
        RAW,
      ),
    ).toBe('<p>go</p>');
  });

  it('resolves an internal link through the populated document url, then slug', () => {
    const byUrl = lexicalToHtml(
      payloadLink({
        linkType: 'internal',
        newTab: false,
        doc: { relationTo: 'pages', value: { id: '1', slug: 'about', url: '/company/about' } },
      }),
      RAW,
    );
    expect(byUrl).toBe('<p><a href="/company/about">go</a></p>');

    const bySlug = lexicalToHtml(
      payloadLink({
        linkType: 'internal',
        newTab: false,
        doc: { relationTo: 'pages', value: { id: '1', slug: 'about' } },
      }),
      RAW,
    );
    expect(bySlug).toBe('<p><a href="/about">go</a></p>');
  });

  it('renders only the children for an unpopulated internal link', () => {
    const html = lexicalToHtml(
      payloadLink({
        linkType: 'internal',
        newTab: false,
        doc: { relationTo: 'pages', value: 'abc123' },
      }),
      RAW,
    );
    expect(html).toBe('<p>go</p>');
  });

  it('ignores a stray url on an internal link', () => {
    const html = lexicalToHtml(
      payloadLink({
        linkType: 'internal',
        url: 'https://stale.example.com',
        newTab: false,
        doc: null,
      }),
      RAW,
    );
    expect(html).toBe('<p>go</p>');
  });

  it('keeps the vanilla top-level url when fields is absent', () => {
    const html = lexicalToHtml(
      paragraphWith({ type: 'link', url: '/legacy', children: [{ type: 'text', text: 'x' }] }),
      RAW,
    );
    expect(html).toBe('<p><a href="/legacy">x</a></p>');
  });
});

describe('inlineBlock nodes', () => {
  it('renders an inline placeholder with the slug class', () => {
    const html = lexicalToHtml(
      paragraphWith(
        { type: 'text', text: 'Hi ' },
        { type: 'inlineBlock', fields: { blockType: 'mention', id: 'a', user: 'jane' } },
      ),
      RAW,
    );
    expect(html).toBe('<p>Hi <span class="lp-inline-block lp-inline-block--mention"></span></p>');
  });

  it('uses a registered block renderer for the slug', () => {
    registerBlockRenderer('mention', (fields) => `<b>@${String(fields['user'])}</b>`);
    const html = lexicalToHtml(
      paragraphWith({ type: 'inlineBlock', fields: { blockType: 'mention', user: 'jane' } }),
      RAW,
    );
    expect(html).toBe('<p><b>@jane</b></p>');
  });
});

describe('table nodes', () => {
  const table = makeRoot([
    {
      type: 'table',
      children: [
        {
          type: 'tablerow',
          children: [
            {
              type: 'tablecell',
              headerState: 1,
              children: [{ type: 'paragraph', children: [{ type: 'text', text: 'A' }] }],
            },
            {
              type: 'tablecell',
              headerState: 1,
              colSpan: 2,
              children: [{ type: 'text', text: 'B' }],
            },
          ],
        },
        {
          type: 'tablerow',
          children: [
            { type: 'tablecell', headerState: 2, children: [{ type: 'text', text: 'r' }] },
            {
              type: 'tablecell',
              headerState: 0,
              rowSpan: 2,
              children: [{ type: 'text', text: '1' }],
            },
            { type: 'tablecell', headerState: 3, children: [{ type: 'text', text: 'both' }] },
          ],
        },
      ],
    },
  ]);

  it('renders table, rows, header and data cells with spans', () => {
    expect(lexicalToHtml(table, RAW)).toBe(
      '<table><tbody>' +
        '<tr><th scope="col"><p>A</p></th><th scope="col" colspan="2">B</th></tr>' +
        '<tr><th scope="row">r</th><td rowspan="2">1</td><th>both</th></tr>' +
        '</tbody></table>',
    );
  });

  it('keeps spans and scope through the strict sanitizer', () => {
    const html = lexicalToHtml(table);
    expect(html).toContain('<th scope="col" colspan="2">B</th>');
    expect(html).toContain('<td rowspan="2">1</td>');
  });
});
