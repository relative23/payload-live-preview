import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { JSDOM } from 'jsdom';
import {
  sanitizeHtml,
  SanitizerEnvironmentError,
  type SanitizeOptions,
  type SanitizerDocument,
} from '@security/sanitizer';
import { templateSanitizeOptions } from '@core/template-sanitize';
import { CORPUS, REGRESSIONS, type Vector } from './xss-corpus';
import { assertNoActiveContent, type CorpusPolicy } from './sanitizer-oracle';

/**
 * The documents a server hands the sanitizer, run for real. linkedom's
 * `template.content` is a copy of the template's children, made on first read,
 * so writing the template back returned the parse and not what was cleaned:
 * up to 2.2.0 every call with a linkedom document returned its input (2.2.1).
 * The oracle reads the output with the suite's jsdom, the way a browser parses
 * what the server sent.
 */

const VECTOR =
  '<p>ok</p><img src="x" onerror="alert(1)"><script>alert(2)</script>' +
  '<a href="javascript:alert(3)">x</a><div style="color:red" data-x="1">y</div>';

const SANITIZED = '<p>ok</p><img src="x"><a>x</a><div>y</div>';

const EMPTY_PAGE = '<!doctype html><html><body></body></html>';

function linkedomDocument(): SanitizerDocument {
  return parseHTML(EMPTY_PAGE).document;
}

function jsdomDocument(): SanitizerDocument {
  return new JSDOM(EMPTY_PAGE).window.document;
}

const POLICIES: readonly CorpusPolicy[] = [
  { name: 'strict', options: { policy: 'strict' } },
  { name: 'compat', options: { policy: 'compat' } },
  { name: 'template', options: undefined },
];

function optionsFor(policy: CorpusPolicy, input: string, document: SanitizerDocument) {
  const options: SanitizeOptions =
    policy.name === 'template'
      ? { ...templateSanitizeOptions(input), policy: 'strict' }
      : policy.options!;
  return { ...options, document };
}

function every(callback: (vector: Vector) => void): void {
  for (const group of CORPUS) for (const vector of group.vectors) callback(vector);
  for (const vector of REGRESSIONS) callback(vector);
}

describe.each([
  ['linkedom', linkedomDocument],
  ['jsdom', jsdomDocument],
])('a %s document passed per call', (_name, create) => {
  it('returns what it cleaned, not its input', () => {
    expect(sanitizeHtml(VECTOR, { document: create() })).toBe(SANITIZED);
  });

  it.each(POLICIES)('leaves nothing script-capable in any corpus vector under $name', (policy) => {
    const document = create();
    every((vector) => {
      const output = sanitizeHtml(vector.input, optionsFor(policy, vector.input, document));
      assertNoActiveContent(output, policy, vector.id);
    });
  });

  it.each(POLICIES)('is a fixed point on every corpus vector under $name', (policy) => {
    const document = create();
    every((vector) => {
      const options = optionsFor(policy, vector.input, document);
      const once = sanitizeHtml(vector.input, options);
      expect(sanitizeHtml(once, options), vector.id).toBe(once);
    });
  });
});

interface FakeTemplate {
  innerHTML: string;
  readonly content: ParentNode;
}

/**
 * A template that parses with jsdom but keeps `content` apart from itself, as
 * linkedom does: reading `innerHTML` back gives the markup it was handed, and
 * `content` is whatever `contentOf` makes of the parse on each read.
 */
function detachedDocument(contentOf: (parsed: DocumentFragment) => ParentNode): SanitizerDocument {
  return {
    createElement: (tagName): FakeTemplate => {
      const template = document.createElement(tagName) as HTMLTemplateElement;
      let source = '';
      return {
        get innerHTML() {
          return source;
        },
        set innerHTML(value: string) {
          source = value;
          template.innerHTML = value;
        },
        get content() {
          return contentOf(template.content);
        },
      };
    },
  };
}

describe('a document whose template content is detached from the template', () => {
  it('writes the copy it cleaned when each read of content is a new copy', () => {
    const copies = detachedDocument((parsed) => parsed.cloneNode(true) as DocumentFragment);
    expect(sanitizeHtml(VECTOR, { document: copies })).toBe(SANITIZED);
  });

  it('returns nothing when content never holds the parse', () => {
    const empty = detachedDocument(() => document.createDocumentFragment());
    expect(sanitizeHtml(VECTOR, { document: empty })).toBe('');
  });

  it('throws the environment error when the cleaned nodes do not reach the writer', () => {
    // A fragment whose document hands out an element that ignores what is
    // appended: whatever it writes is not what was cleaned.
    const stray = detachedDocument((parsed) => {
      const copy = parsed.cloneNode(true) as DocumentFragment;
      Object.defineProperty(copy, 'ownerDocument', {
        value: {
          createElement: () => ({ append: () => undefined, firstChild: null, innerHTML: VECTOR }),
        },
      });
      return copy;
    });
    expect(() => sanitizeHtml(VECTOR, { document: stray })).toThrow(SanitizerEnvironmentError);
  });

  it('throws the environment error when the fragment has no document to write through', () => {
    const orphan = detachedDocument((parsed) => {
      const copy = parsed.cloneNode(true) as DocumentFragment;
      Object.defineProperty(copy, 'ownerDocument', { value: null });
      return copy;
    });
    expect(() => sanitizeHtml(VECTOR, { document: orphan })).toThrow(SanitizerEnvironmentError);
  });

  it('throws the environment error when content is no node at all', () => {
    // A facade with neither `ownerDocument` nor `firstChild`: nothing to write
    // through, and nothing to compare a writer with.
    const facade: SanitizerDocument = {
      createElement: () => ({
        innerHTML: '',
        content: { childNodes: [] } as unknown as ParentNode,
      }),
    };
    expect(() => sanitizeHtml(VECTOR, { document: facade })).toThrow(SanitizerEnvironmentError);
  });
});
