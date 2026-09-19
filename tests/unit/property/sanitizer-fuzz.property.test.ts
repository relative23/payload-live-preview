import { describe, expect } from 'vitest';
import { fc, it } from '@fast-check/vitest';
import createDOMPurify from 'dompurify';
import { sanitizeHtml } from '@security/sanitizer';
import { templateSanitizeOptions } from '@core/template-sanitize';
import {
  assertNoActiveContent,
  missingFromPurify,
  purifyLikeOurs,
  type CorpusPolicy,
} from '../security/sanitizer-oracle';
import { propertyParameters } from './fast-check';

/**
 * Grammar-driven fuzzing of the sanitizer: markup assembled from the tags,
 * attributes and values an attacker reaches for — handlers, schemes with
 * their encodings, raw-text and foreign-content elements, quote and comment
 * breakouts, custom elements — nested a few levels deep. The same three
 * questions as the corpus (`sanitizer-corpus.test.ts`): nothing script-
 * capable survives, the output is a fixed point, and nothing we keep is
 * something DOMPurify drops. `security.property.test.ts` fuzzes with
 * arbitrary strings; this one aims.
 */

const purify = createDOMPurify(window);

const TAGS = fc.constantFrom(
  'p',
  'a',
  'img',
  'span',
  'div',
  'em',
  'strong',
  'ul',
  'li',
  'table',
  'tr',
  'td',
  'video',
  'source',
  'picture',
  'blockquote',
  'q',
  'details',
  'summary',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'label',
  'form',
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'mtext',
  'mglyph',
  'foreignobject',
  'template',
  'noscript',
  'noembed',
  'xmp',
  'plaintext',
  'title',
  'link',
  'meta',
  'base',
  'x-widget',
  'x-a',
);

const ATTRIBUTE_NAMES = fc.constantFrom(
  'href',
  'src',
  'srcset',
  'poster',
  'cite',
  'class',
  'title',
  'alt',
  'id',
  'name',
  'style',
  'onclick',
  'onerror',
  'onload',
  'onfocus',
  'ONMOUSEOVER',
  'srcdoc',
  'action',
  'formaction',
  'background',
  'ping',
  'xlink:href',
  'data-x',
  'data-payload-field',
  'aria-label',
  'tabindex',
  'contenteditable',
  'autofocus',
  'type',
  'value',
  'checked',
  'open',
  'rel',
  'target',
  'is',
  'slot',
);

const SCHEME = fc.constantFrom(
  'javascript',
  'JaVaScRiPt',
  'jav&#x09;ascript',
  'jav&#x0A;ascript',
  '&#106;avascript',
  'javascript&colon;',
  'vbscript',
  'data',
  'blob',
  'file',
  'about',
  'https',
  'http',
  'mailto',
  'tel',
  'foo',
);
const C0 = String.fromCharCode(1);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PREFIX = fc.constantFrom('', ' ', '\t', '\n', C0, LINE_SEPARATOR, '&#x20;', '&#9;');
const URL_VALUE = fc
  .tuple(
    PREFIX,
    SCHEME,
    fc.constantFrom(':', ' :', '&#58;', ''),
    fc.stringMatching(/^[a-z0-9/._-]{0,12}$/),
  )
  .map(([prefix, scheme, colon, rest]) => `${prefix}${scheme}${colon}${rest}`);
const BREAKOUT = fc.constantFrom(
  '"><img src=x onerror=alert(1)>',
  "'><script>alert(1)</script>",
  '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;',
  '</style><img src=x onerror=alert(1)>',
  '</script><script>alert(1)</script>',
  '--><img src=x onerror=alert(1)>',
  ']]><script>alert(1)</script>',
  'alert(1)',
  'expression(alert(1))',
  'url(javascript:alert(1))',
  'x',
);
const ATTRIBUTE_VALUE = fc.oneof(URL_VALUE, BREAKOUT, fc.stringMatching(/^[a-z0-9 _-]{0,10}$/));
const QUOTE = fc.constantFrom('"', "'", '');

const ATTRIBUTE = fc
  .tuple(ATTRIBUTE_NAMES, ATTRIBUTE_VALUE, QUOTE)
  .map(([name, value, quote]) => `${name}=${quote}${value}${quote}`);

const TEXT = fc.oneof(
  fc.stringMatching(/^[A-Za-z0-9 .,]{0,20}$/),
  fc.constantFrom(
    '<',
    '&',
    '&lt;script&gt;',
    '<!--',
    '-->',
    '<![CDATA[',
    ']]>',
    '</script>',
    '</style>',
    '</textarea>',
    '</title>',
    '<img src=x onerror=alert(1)>',
    '"',
    "'",
  ),
);

const { markup } = fc.letrec((tie) => ({
  markup: fc.array(
    fc.oneof(
      { depthSize: 'small', maxDepth: 3 },
      TEXT,
      fc
        .tuple(TAGS, fc.array(ATTRIBUTE, { maxLength: 3 }), tie('markup'), fc.boolean())
        .map(([tag, attributes, children, close]) => {
          const attrs = attributes.length === 0 ? '' : ` ${attributes.join(' ')}`;
          const inner = (children as string[]).join('');
          return close ? `<${tag}${attrs}>${inner}</${tag}>` : `<${tag}${attrs}>${inner}`;
        }),
    ),
    { maxLength: 4 },
  ),
}));
const MARKUP = markup.map((parts) => parts.join(''));

const POLICIES: readonly CorpusPolicy[] = [
  { name: 'strict', options: { policy: 'strict' } },
  { name: 'compat', options: { policy: 'compat' } },
  { name: 'template', options: undefined },
];

describe('the sanitizer, under aimed fuzzing', () => {
  it.prop([MARKUP], propertyParameters(0x53414e33, 200))(
    'leaves nothing script-capable, is a fixed point, and keeps nothing DOMPurify drops',
    (input) => {
      for (const policy of POLICIES) {
        const options =
          policy.name === 'template'
            ? { ...templateSanitizeOptions(input), policy: 'strict' as const }
            : policy.options!;
        const output = sanitizeHtml(input, options);
        assertNoActiveContent(output, policy, JSON.stringify(input));
        expect(sanitizeHtml(output, options), JSON.stringify(input)).toBe(output);
        if (policy.name !== 'compat') {
          const missing = missingFromPurify(output, purifyLikeOurs(purify, input), options, input);
          expect(
            missing,
            `${policy.name} keeps what DOMPurify drops for ${JSON.stringify(input)}`,
          ).toEqual([]);
        }
      }
    },
  );
});
