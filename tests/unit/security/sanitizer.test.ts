import { afterEach, describe, expect, it } from 'vitest';
import {
  sanitizeHtml,
  setSanitizerDocument,
  SanitizerEnvironmentError,
  SANITIZER_POLICY,
} from '@security/sanitizer';

describe('sanitizeHtml — allow-list', () => {
  it('keeps allowed tags and structure', () => {
    const result = sanitizeHtml('<p>hello <strong>world</strong></p>');
    expect(result).toBe('<p>hello <strong>world</strong></p>');
  });

  it('keeps headings and lists', () => {
    const html = '<h2>Title</h2><ul><li>one</li><li>two</li></ul>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('keeps img with safe src and validated attributes', () => {
    const result = sanitizeHtml('<img src="https://example.com/a.jpg" alt="x" width="100" />');
    expect(result).toContain('src="https://example.com/a.jpg"');
    expect(result).toContain('alt="x"');
    expect(result).toContain('width="100"');
  });

  it('unwraps disallowed tags but keeps their text content', () => {
    const result = sanitizeHtml('<custom>kept</custom>');
    expect(result).toBe('kept');
  });

  it('handles empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });
});

describe('sanitizeHtml — dangerous content removal', () => {
  it('removes <script> entirely', () => {
    const result = sanitizeHtml('<p>safe</p><script>alert(1)</script>');
    expect(result).toBe('<p>safe</p>');
  });

  it('removes <style> entirely', () => {
    const result = sanitizeHtml('<p>safe</p><style>body{}</style>');
    expect(result).toBe('<p>safe</p>');
  });

  it('removes <iframe>, <object>, <embed>, <link>, <meta>', () => {
    const result = sanitizeHtml('<iframe src="x"></iframe><object></object><embed><link><meta>');
    expect(result).toBe('');
  });

  it('removes <form> and form controls entirely', () => {
    const result = sanitizeHtml(
      '<form><input><button>x</button><select></select><textarea></textarea></form>',
    );
    expect(result).toBe('');
  });

  it('strips event-handler attributes from allowed tags', () => {
    const result = sanitizeHtml('<p onclick="alert(1)" onmouseover="x()">x</p>');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onmouseover');
    expect(result).toContain('<p>x</p>');
  });

  it('strips inline style attribute (CSS-injection vector)', () => {
    const result = sanitizeHtml('<p style="background:url(javascript:1)">x</p>');
    expect(result).toBe('<p>x</p>');
  });

  it('strips unknown attributes from allowed tags', () => {
    const result = sanitizeHtml('<a href="https://example.com" formaction="x">link</a>');
    expect(result).toContain('href="https://example.com"');
    expect(result).not.toContain('formaction');
  });

  it('strips javascript: from href', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('>x</a>');
  });

  it('strips javascript: from img src', () => {
    const result = sanitizeHtml('<img src="javascript:alert(1)" alt="x">');
    expect(result).not.toContain('javascript:');
    expect(result).toContain('alt="x"');
  });

  it('removes HTML comments', () => {
    const result = sanitizeHtml('<p>a</p><!-- evil --><p>b</p>');
    expect(result).toBe('<p>a</p><p>b</p>');
  });
});

describe('sanitizeHtml — link hardening', () => {
  it('adds rel="noopener noreferrer" and target="_blank" to external links', () => {
    const result = sanitizeHtml('<a href="https://example.com">x</a>');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });

  it('does not harden internal links', () => {
    const result = sanitizeHtml('<a href="/internal">x</a>');
    expect(result).not.toContain('target="_blank"');
    expect(result).not.toContain('rel=');
  });

  it('preserves explicit target on external links', () => {
    const result = sanitizeHtml('<a href="https://example.com" target="_self">x</a>');
    expect(result).toContain('target="_self"');
    expect(result).toContain('rel="noopener noreferrer"');
  });
});

describe('sanitizeHtml — global, ARIA, data-* attributes', () => {
  it('keeps global attributes', () => {
    const html =
      '<span id="x" class="c" lang="de" dir="ltr" title="t" role="status" tabindex="0">y</span>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('keeps aria-* attributes', () => {
    const result = sanitizeHtml('<button aria-label="x">y</button>');
    // button is removed entirely — verify on a div instead
    expect(result).toBe('');
    const divResult = sanitizeHtml('<div aria-label="x">y</div>');
    expect(divResult).toContain('aria-label="x"');
  });

  it('keeps data-* attributes', () => {
    const result = sanitizeHtml('<span data-test="x" data-payload-field="y">z</span>');
    expect(result).toContain('data-test="x"');
    expect(result).toContain('data-payload-field="y"');
  });
});

describe('sanitizeHtml — nested and deep content', () => {
  it('handles deeply nested allowed tags', () => {
    const result = sanitizeHtml('<p><strong><em><u>deep</u></em></strong></p>');
    expect(result).toBe('<p><strong><em><u>deep</u></em></strong></p>');
  });

  it('strips event handlers inside nested allowed tags', () => {
    const result = sanitizeHtml('<p><strong onclick="x()">y</strong></p>');
    expect(result).not.toContain('onclick');
  });

  it('does not allow svg or math', () => {
    const result = sanitizeHtml('<svg><rect /></svg><math></math>');
    expect(result).toBe('');
  });
});

describe('sanitizeHtml — option overrides', () => {
  it('honours additionalAllowedTags', () => {
    const result = sanitizeHtml('<custom>kept</custom>', {
      additionalAllowedTags: ['custom'],
    });
    expect(result).toBe('<custom>kept</custom>');
  });

  it('honours additionalAllowedAttributes', () => {
    const result = sanitizeHtml('<span foo="bar">x</span>', {
      additionalAllowedAttributes: { span: ['foo'] },
    });
    expect(result).toContain('foo="bar"');
  });
});

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
    const err = new SanitizerEnvironmentError('msg');
    expect(err.name).toBe('SanitizerEnvironmentError');
  });
});

describe('SANITIZER_POLICY', () => {
  it('exposes the resolved allow-list sets', () => {
    expect(SANITIZER_POLICY.allowedTags.has('p')).toBe(true);
    expect(SANITIZER_POLICY.removeCompletely.has('script')).toBe(true);
    expect(SANITIZER_POLICY.urlAttributes.has('href')).toBe(true);
  });
});

describe('setSanitizerDocument — SSR fallback', () => {
  afterEach(() => {
    setSanitizerDocument(null);
  });

  it('uses the injected document when globalThis.document is absent', () => {
    const originalDocument = globalThis.document;
    // jsdom-driven test env owns a real document — borrow its
    // `createElement` so the injected facade behaves identically to
    // the real one. This is exactly what a linkedom/jsdom user would
    // wire up on a real SSR server.
    const surrogate = {
      createElement: (tag: string): { innerHTML: string; readonly content: ParentNode } => {
        const el = originalDocument.createElement(tag);
        // The sanitizer relies on <template>.content as a ParentNode;
        // jsdom matches that shape exactly.
        return el as unknown as { innerHTML: string; readonly content: ParentNode };
      },
    };

    // @ts-expect-error — simulating Node SSR without a DOM global
    delete globalThis.document;
    try {
      setSanitizerDocument(surrogate);
      const result = sanitizeHtml('<p>hi <script>x</script></p>');
      expect(result).toBe('<p>hi </p>');
    } finally {
      globalThis.document = originalDocument;
    }
  });

  it('prefers the injected document over the global one', () => {
    let calls = 0;
    const realDocument = globalThis.document;
    setSanitizerDocument({
      createElement: (tag: string) => {
        calls += 1;
        return realDocument.createElement(tag) as unknown as {
          innerHTML: string;
          readonly content: ParentNode;
        };
      },
    });
    sanitizeHtml('<p>hi</p>');
    expect(calls).toBe(1);
  });

  it('clearing with null restores the global document fallback', () => {
    let calls = 0;
    const realDocument = globalThis.document;
    setSanitizerDocument({
      createElement: (tag: string) => {
        calls += 1;
        return realDocument.createElement(tag) as unknown as {
          innerHTML: string;
          readonly content: ParentNode;
        };
      },
    });
    sanitizeHtml('<p>x</p>');
    expect(calls).toBe(1);

    setSanitizerDocument(null);
    sanitizeHtml('<p>y</p>');
    expect(calls).toBe(1); // global document took over
  });

  it('still throws when neither the override nor the global is available', () => {
    const originalDocument = globalThis.document;
    // @ts-expect-error — simulating absence
    delete globalThis.document;
    try {
      setSanitizerDocument(null);
      expect(() => sanitizeHtml('<p>x</p>')).toThrow(SanitizerEnvironmentError);
    } finally {
      globalThis.document = originalDocument;
    }
  });
});
