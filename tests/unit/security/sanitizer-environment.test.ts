/* eslint-disable @typescript-eslint/no-deprecated -- the process-wide document slot is exercised on purpose until 3.0 */
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
      expect(() => sanitizeHtml('<p>x</p>')).toThrow(
        'sanitizeHtml needs a DOM; pass one per call during SSR: { document } (linkedom, jsdom).',
      );
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

describe('one injected document for every copy of the sanitizer', () => {
  // Every package entry is its own bundle with its own copy of this module:
  // `payload-live-preview` and `payload-live-preview/lexical` share no module
  // state. A document supplied through one entry has to reach rich text rendered
  // through another, or `lexicalToHtml` from `/lexical` returns unsanitised HTML
  // on a server that did call `setSanitizerDocument()` (measured on 2.0.1).
  afterEach(() => {
    setSanitizerDocument(null);
    vi.resetModules();
  });

  it('reaches a second instance of the module', async () => {
    const originalDocument = globalThis.document;
    let calls = 0;
    const surrogate = surrogateFor(originalDocument, () => {
      calls += 1;
    });
    vi.resetModules();
    const other = await import('@security/sanitizer');
    expect(other.setSanitizerDocument).not.toBe(setSanitizerDocument);
    Reflect.deleteProperty(globalThis, 'document');
    try {
      setSanitizerDocument(surrogate);
      expect(other.hasSanitizerDocument()).toBe(true);
      expect(other.sanitizeHtml('<p>hi <script>x</script></p>')).toBe('<p>hi </p>');
      // Two parses: the rewritten output is parsed once more to confirm it settled.
      expect(calls).toBe(2);
      other.setSanitizerDocument(null);
      expect(hasSanitizerDocument()).toBe(false);
    } finally {
      globalThis.document = originalDocument;
    }
  });
});

describe('the registry key other copies of the package look up', () => {
  afterEach(() => {
    setSanitizerDocument(null);
  });

  it('holds the document under the documented registry name, and clears it there', () => {
    // A second installed build of the package has its own copy of this module
    // and finds the document only through this exact name; the name is the
    // contract between copies, not an implementation detail of one of them.
    const key = Symbol.for('payload-live-preview.sanitizer-document');
    const surrogate = surrogateFor(globalThis.document);
    setSanitizerDocument(surrogate);
    expect(Reflect.get(globalThis, key)).toBe(surrogate);
    setSanitizerDocument(null);
    expect(Reflect.get(globalThis, key)).toBeUndefined();
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
      // The short message and a plain Error: the SSR class and its remedy
      // are not in the browser build, and the text must not mention them.
      expect(() => sanitizeHtml('<p>x</p>')).toThrow(/^sanitizeHtml needs a DOM$/u);
      expect(() => sanitizeHtml('<p>x</p>')).not.toThrow(SanitizerEnvironmentError);
      expect(hasSanitizerDocument()).toBe(false);
    } finally {
      vi.stubGlobal('document', realDocument);
    }
  });
});

describe('a document named per call', () => {
  afterEach(() => {
    setSanitizerDocument(null);
  });

  it('wins over the injected slot and over the global document', () => {
    let perCall = 0;
    let slot = 0;
    const own = surrogateFor(document, () => {
      perCall += 1;
    });
    setSanitizerDocument(
      surrogateFor(document, () => {
        slot += 1;
      }),
    );
    // A rewritten input takes two parses, a canonical one a single parse.
    expect(sanitizeHtml('<p onclick="x()">a</p>', { document: own })).toBe('<p>a</p>');
    expect([perCall, slot]).toEqual([2, 0]);
    expect(sanitizeHtml('<p>b</p>')).toBe('<p>b</p>');
    expect([perCall, slot]).toEqual([2, 1]);
  });

  it('serves without any slot or global at all', () => {
    const originalDocument = globalThis.document;
    const own = surrogateFor(originalDocument);
    // @ts-expect-error — testing SSR path
    delete globalThis.document;
    try {
      expect(sanitizeHtml('<p>x<script>y()</script></p>', { document: own })).toBe('<p>x</p>');
      expect(() => sanitizeHtml('<p>x</p>')).toThrow(SanitizerEnvironmentError);
    } finally {
      globalThis.document = originalDocument;
    }
  });

  it('keeps two documents in flight apart: each call parses in its own', async () => {
    // Two SSR requests, each with its own DOM, interleaved across awaits: with
    // a process-wide slot the second would have overwritten the first's
    // document mid-request. Per call there is nothing to overwrite.
    const counts = { a: 0, b: 0 };
    const a = surrogateFor(document, () => {
      counts.a += 1;
    });
    const b = surrogateFor(document, () => {
      counts.b += 1;
    });
    const render = async (doc: typeof a, label: string): Promise<string[]> => {
      const out: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        await Promise.resolve();
        out.push(sanitizeHtml(`<p data-x="1">${label}${String(i)}</p>`, { document: doc }));
      }
      return out;
    };
    const [fromA, fromB] = await Promise.all([render(a, 'A'), render(b, 'B')]);
    expect(fromA).toEqual(['<p>A0</p>', '<p>A1</p>', '<p>A2</p>']);
    expect(fromB).toEqual(['<p>B0</p>', '<p>B1</p>', '<p>B2</p>']);
    // Each of the three inputs is rewritten, so each takes two parses in its own document.
    expect(counts).toEqual({ a: 6, b: 6 });
  });
});
