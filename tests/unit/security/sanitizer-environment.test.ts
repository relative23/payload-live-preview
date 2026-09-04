import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  sanitizeHtml,
  hasSanitizerDocument,
  setSanitizerDocument,
  SanitizerEnvironmentError,
} from '@security/sanitizer';

interface TemplateLike {
  innerHTML: string;
  readonly content: ParentNode;
}

/** Borrow jsdom's `createElement` so the injected facade behaves like a real SSR DOM. */
function surrogateFor(doc: Document, onCreate?: () => void) {
  return {
    createElement: (tag: string): TemplateLike => {
      onCreate?.();
      return doc.createElement(tag) as unknown as TemplateLike;
    },
  };
}

describe('SanitizerEnvironmentError', () => {
  it('throws when no DOM is available', () => {
    const originalDocument = globalThis.document;
    // @ts-expect-error — testing SSR path
    delete globalThis.document;
    try {
      expect(() => sanitizeHtml('<p>x</p>')).toThrow(SanitizerEnvironmentError);
    } finally {
      globalThis.document = originalDocument;
    }
  });

  it('has the expected name', () => {
    expect(new SanitizerEnvironmentError('msg').name).toBe('SanitizerEnvironmentError');
  });
});

describe('setSanitizerDocument — SSR fallback', () => {
  afterEach(() => {
    setSanitizerDocument(null);
  });

  it('uses the injected document when globalThis.document is absent', () => {
    const originalDocument = globalThis.document;
    const surrogate = surrogateFor(originalDocument);
    // @ts-expect-error — simulating Node SSR without a DOM global
    delete globalThis.document;
    try {
      setSanitizerDocument(surrogate);
      expect(hasSanitizerDocument()).toBe(true);
      expect(sanitizeHtml('<p>hi <script>x</script></p>')).toBe('<p>hi </p>');
    } finally {
      globalThis.document = originalDocument;
    }
  });

  it('uses an injected document without relying on a global Node constructor', () => {
    const originalDocument = globalThis.document;
    const originalNode = globalThis.Node;
    const surrogate = surrogateFor(originalDocument);
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'Node');
    try {
      setSanitizerDocument(surrogate);
      expect(sanitizeHtml('<p>Hello<!-- hidden --></p><script>bad()</script>')).toBe(
        '<p>Hello</p>',
      );
    } finally {
      globalThis.document = originalDocument;
      globalThis.Node = originalNode;
    }
  });

  it('prefers the injected document over the global one', () => {
    let calls = 0;
    setSanitizerDocument(
      surrogateFor(globalThis.document, () => {
        calls += 1;
      }),
    );
    sanitizeHtml('<p>hi</p>');
    expect(calls).toBe(1);
  });

  it('clearing with null restores the global document fallback', () => {
    let calls = 0;
    setSanitizerDocument(
      surrogateFor(globalThis.document, () => {
        calls += 1;
      }),
    );
    sanitizeHtml('<p>x</p>');
    expect(calls).toBe(1);
    setSanitizerDocument(null);
    sanitizeHtml('<p>y</p>');
    expect(calls).toBe(1);
  });

  it('still throws when neither the override nor the global is available', () => {
    const originalDocument = globalThis.document;
    // @ts-expect-error — simulating absence
    delete globalThis.document;
    try {
      setSanitizerDocument(null);
      expect(hasSanitizerDocument()).toBe(false);
      expect(() => sanitizeHtml('<p>x</p>')).toThrow(SanitizerEnvironmentError);
    } finally {
      globalThis.document = originalDocument;
    }
  });
});

describe('the inline-build branches', () => {
  // `__INLINE_BUILD__` is a bundler define, folded away in the shipped runtime.
  // Unbundled it is an ordinary global, so stubbing it reaches the branch the
  // browser takes: the short message, and no injected-document support.
  afterEach(() => {
    vi.unstubAllGlobals();
    setSanitizerDocument(null);
  });

  it('throws the short error and ignores an injected document', () => {
    vi.stubGlobal('__INLINE_BUILD__', true);
    const parser = new DOMParser();
    setSanitizerDocument(parser.parseFromString('<html><body></body></html>', 'text/html'));
    const realDocument = globalThis.document;
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('__INLINE_BUILD__', true);
    try {
      expect(() => sanitizeHtml('<p>x</p>')).toThrow('sanitizeHtml needs a DOM');
      expect(hasSanitizerDocument()).toBe(false);
    } finally {
      vi.stubGlobal('document', realDocument);
    }
  });
});
