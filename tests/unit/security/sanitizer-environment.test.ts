import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeHtml, hasSanitizerDocument, SanitizerEnvironmentError } from '@security/sanitizer';

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

describe('a call that names no document', () => {
  it('has the global one where there is one', () => {
    expect(hasSanitizerDocument()).toBe(true);
    expect(sanitizeHtml('<p onclick="x()">a</p>')).toBe('<p>a</p>');
  });

  it('does not read the realm slot that setSanitizerDocument() filled until 3.0 (ADR 0007, row 16)', () => {
    // A 2.x copy of the package in the same process can still put its document there.
    const originalDocument = globalThis.document;
    const slot = Symbol.for('payload-live-preview.sanitizer-document');
    (globalThis as Record<symbol, unknown>)[slot] = surrogateFor(originalDocument);
    // @ts-expect-error — simulating a server
    delete globalThis.document;
    try {
      expect(hasSanitizerDocument()).toBe(false);
      expect(() => sanitizeHtml('<p>x</p>')).toThrow(SanitizerEnvironmentError);
    } finally {
      globalThis.document = originalDocument;
      Reflect.deleteProperty(globalThis, slot);
    }
  });
});

describe('the inline-build branches', () => {
  // `__INLINE_BUILD__` is a bundler define, folded away in the shipped runtime.
  // Unbundled it is an ordinary global, so stubbing it reaches the branch the
  // browser takes: the short message.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws the short error', () => {
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
  it('wins over the global document, and only for its own call', () => {
    let perCall = 0;
    const own = surrogateFor(document, () => {
      perCall += 1;
    });
    // A rewritten input takes two parses, a canonical one a single parse.
    expect(sanitizeHtml('<p onclick="x()">a</p>', { document: own })).toBe('<p>a</p>');
    expect(perCall).toBe(2);
    expect(sanitizeHtml('<p>b</p>')).toBe('<p>b</p>');
    expect(perCall).toBe(2);
  });

  it('needs no global Node constructor', () => {
    const originalDocument = globalThis.document;
    const originalNode = globalThis.Node;
    const own = surrogateFor(originalDocument);
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'Node');
    try {
      expect(
        sanitizeHtml('<p>Hello<!-- hidden --></p><script>bad()</script>', { document: own }),
      ).toBe('<p>Hello</p>');
    } finally {
      globalThis.document = originalDocument;
      globalThis.Node = originalNode;
    }
  });

  it('serves without a global document', () => {
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
