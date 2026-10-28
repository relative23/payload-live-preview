import { afterEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { JSDOM } from 'jsdom';
import {
  sanitizeHtml,
  setSanitizerDocument,
  SanitizerEnvironmentError,
  type SanitizerDocument,
} from '@security/sanitizer';

/**
 * The documents a server hands the sanitizer, run for real. linkedom's
 * `template.content` is a copy of the template's children, made on first read,
 * so writing the template back returned the parse and not what was cleaned:
 * up to 1.8.1 every call with a linkedom document returned its input (1.8.2).
 */

const VECTOR =
  '<p>ok</p><img src="x" onerror="alert(1)"><script>alert(2)</script>' +
  '<a href="javascript:alert(3)">x</a><div style="color:red" data-x="1">y</div>';

const SANITIZED = '<p>ok</p><img src="x"><a>x</a><div data-x="1">y</div>';

const EMPTY_PAGE = '<!doctype html><html><body></body></html>';

function linkedomDocument(): SanitizerDocument {
  return parseHTML(EMPTY_PAGE).document;
}

function jsdomDocument(): SanitizerDocument {
  return new JSDOM(EMPTY_PAGE).window.document;
}

afterEach(() => {
  setSanitizerDocument(null);
});

describe.each([
  ['linkedom', linkedomDocument],
  ['jsdom', jsdomDocument],
])('a %s document', (_name, create) => {
  it('given to setSanitizerDocument() returns what it cleaned, not its input', () => {
    setSanitizerDocument(create());
    expect(sanitizeHtml(VECTOR)).toBe(SANITIZED);
  });

  it('as the global document returns what it cleaned, not its input', () => {
    const original = globalThis.document;
    globalThis.document = create() as Document;
    try {
      expect(sanitizeHtml(VECTOR)).toBe(SANITIZED);
    } finally {
      globalThis.document = original;
    }
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
    setSanitizerDocument(detachedDocument((parsed) => parsed.cloneNode(true) as DocumentFragment));
    expect(sanitizeHtml(VECTOR)).toBe(SANITIZED);
  });

  it('returns nothing when content never holds the parse', () => {
    setSanitizerDocument(detachedDocument(() => document.createDocumentFragment()));
    expect(sanitizeHtml(VECTOR)).toBe('');
  });

  it('throws the environment error when the cleaned nodes do not reach the writer', () => {
    // A fragment whose document hands out an element that ignores what is
    // appended: whatever it writes is not what was cleaned.
    setSanitizerDocument(
      detachedDocument((parsed) => {
        const copy = parsed.cloneNode(true) as DocumentFragment;
        Object.defineProperty(copy, 'ownerDocument', {
          value: {
            createElement: () => ({ append: () => undefined, firstChild: null, innerHTML: VECTOR }),
          },
        });
        return copy;
      }),
    );
    expect(() => sanitizeHtml(VECTOR)).toThrow(SanitizerEnvironmentError);
    expect(() => sanitizeHtml(VECTOR)).toThrow('could not write what it cleaned');
  });

  it('throws the environment error when the fragment has no document to write through', () => {
    setSanitizerDocument(
      detachedDocument((parsed) => {
        const copy = parsed.cloneNode(true) as DocumentFragment;
        Object.defineProperty(copy, 'ownerDocument', { value: null });
        return copy;
      }),
    );
    expect(() => sanitizeHtml(VECTOR)).toThrow(SanitizerEnvironmentError);
  });

  it('throws the environment error when content is no node at all', () => {
    // A facade with neither `ownerDocument` nor `firstChild`: nothing to write
    // through, and nothing to compare a writer with.
    setSanitizerDocument({
      createElement: () => ({
        innerHTML: '',
        content: { childNodes: [] } as unknown as ParentNode,
      }),
    });
    expect(() => sanitizeHtml(VECTOR)).toThrow(SanitizerEnvironmentError);
  });
});
