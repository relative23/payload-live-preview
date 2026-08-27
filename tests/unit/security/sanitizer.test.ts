import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  sanitizeHtml,
  hasSanitizerDocument,
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

  it('does not invoke the HTML parser for empty input', () => {
    const createElement = vi.fn(() => {
      throw new Error('the empty-input fast path must not parse');
    });
    setSanitizerDocument({ createElement });

    try {
      expect(sanitizeHtml('')).toBe('');
      expect(createElement).not.toHaveBeenCalled();
    } finally {
      setSanitizerDocument(null);
    }
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

  it('does not let extension options re-enable event handlers or inline CSS', () => {
    const result = sanitizeHtml('<span onclick="alert(1)" style="color:red">x</span>', {
      additionalAllowedAttributes: { span: ['onclick', 'style'] },
    });

    expect(result).toBe('<span>x</span>');
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

  it('validates every built-in URL-bearing attribute', () => {
    const result = sanitizeHtml(
      '<a href="javascript:alert(1)">a</a>' +
        '<img src="javascript:alert(1)" alt="img">' +
        '<q cite="javascript:alert(1)">q</q>' +
        '<video poster="javascript:alert(1)"></video>',
    );

    expect(result).toBe('<a>a</a><img alt="img"><q>q</q><video></video>');
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

  it('leaves anchors without href unchanged', () => {
    expect(sanitizeHtml('<a rel="author">x</a>')).toBe('<a rel="author">x</a>');
  });

  it('does not apply anchor hardening to extension elements with URL attributes', () => {
    const result = sanitizeHtml(
      '<span href="https://example.com" rel="author" target="_self">x</span>',
      {
        additionalAllowedAttributes: { span: ['href', 'rel', 'target'] },
      },
    );

    expect(result).toBe('<span href="https://example.com" rel="author" target="_self">x</span>');
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

  it('merges additional attributes with the built-in per-tag policy', () => {
    const result = sanitizeHtml('<a href="/safe" data-custom="yes">x</a>', {
      additionalAllowedAttributes: { a: ['data-custom'] },
    });

    expect(result).toBe('<a href="/safe" data-custom="yes">x</a>');
  });

  it('does not interpret ordinary extension attributes as srcset URLs', () => {
    const result = sanitizeHtml('<span label="data:text/html,x">x</span>', {
      additionalAllowedAttributes: { span: ['label'] },
    });

    expect(result).toBe('<span label="data:text/html,x">x</span>');
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
  it('exposes the complete reviewed tag and URL-attribute policy', () => {
    expect([...SANITIZER_POLICY.allowedTags]).toEqual([
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'strike',
      'mark',
      'small',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'dl',
      'dt',
      'dd',
      'blockquote',
      'code',
      'pre',
      'kbd',
      'samp',
      'var',
      'a',
      'span',
      'div',
      'section',
      'article',
      'aside',
      'header',
      'footer',
      'nav',
      'figure',
      'figcaption',
      'img',
      'picture',
      'source',
      'audio',
      'video',
      'sub',
      'sup',
      'hr',
      'time',
      'abbr',
      'cite',
      'q',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'caption',
      'colgroup',
      'col',
    ]);
    expect([...SANITIZER_POLICY.removeCompletely]).toEqual([
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'link',
      'meta',
      'base',
      'form',
      'input',
      'button',
      'select',
      'textarea',
      'svg',
      'math',
      'template',
      'frame',
      'frameset',
      'noframes',
      'noscript',
    ]);
    expect([...SANITIZER_POLICY.globalAttributes]).toEqual([
      'id',
      'class',
      'lang',
      'dir',
      'title',
      'role',
      'tabindex',
    ]);
    expect([...SANITIZER_POLICY.urlAttributes]).toEqual(['href', 'src', 'cite', 'poster']);
  });

  it('exposes the complete reviewed per-tag attribute policy', () => {
    expect(
      Object.fromEntries(
        Object.entries(SANITIZER_POLICY.attributesByTag).map(([tag, attributes]) => [
          tag,
          [...attributes],
        ]),
      ),
    ).toEqual({
      a: ['href', 'target', 'rel', 'download', 'hreflang', 'type'],
      img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding'],
      picture: [],
      source: ['src', 'srcset', 'sizes', 'type', 'media'],
      audio: ['src', 'controls', 'autoplay', 'loop', 'muted', 'preload'],
      video: [
        'src',
        'poster',
        'controls',
        'autoplay',
        'loop',
        'muted',
        'preload',
        'width',
        'height',
        'playsinline',
      ],
      time: ['datetime'],
      abbr: ['title'],
      q: ['cite'],
      blockquote: ['cite'],
      table: ['summary'],
      th: ['colspan', 'rowspan', 'scope', 'headers', 'abbr'],
      td: ['colspan', 'rowspan', 'headers'],
      col: ['span'],
      colgroup: ['span'],
      ol: ['start', 'reversed', 'type'],
      li: ['value'],
      code: ['class'],
      pre: ['class'],
    });
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
      expect(hasSanitizerDocument()).toBe(true);
      const result = sanitizeHtml('<p>hi <script>x</script></p>');
      expect(result).toBe('<p>hi </p>');
    } finally {
      globalThis.document = originalDocument;
    }
  });

  it('uses an injected document without relying on a global Node constructor', () => {
    const originalDocument = globalThis.document;
    const originalNode = globalThis.Node;
    const surrogate = {
      createElement: (tag: string): { innerHTML: string; readonly content: ParentNode } =>
        originalDocument.createElement(tag) as unknown as {
          innerHTML: string;
          readonly content: ParentNode;
        },
    };

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
      expect(hasSanitizerDocument()).toBe(false);
      expect(() => sanitizeHtml('<p>x</p>')).toThrow(SanitizerEnvironmentError);
    } finally {
      globalThis.document = originalDocument;
    }
  });
});

describe('sanitizeHtml — srcset validation', () => {
  it('keeps srcset when every candidate URL is safe', () => {
    const out = sanitizeHtml(
      '<img src="https://a.example/1.jpg" srcset="https://a.example/1.jpg 1x, https://a.example/2.jpg 2x">',
    );
    expect(out).toContain('srcset');
  });

  it('drops srcset containing an unsafe candidate', () => {
    const out = sanitizeHtml('<img src="/ok.jpg" srcset="javascript:alert(1) 1x">');
    expect(out).not.toContain('srcset');
    expect(out).toContain('src="/ok.jpg"');
  });

  it('drops srcset when any of several candidates is unsafe', () => {
    const out = sanitizeHtml(
      '<img src="/ok.jpg" srcset="https://a.example/1.jpg 1x, data:text/html,x 2x">',
    );
    expect(out).not.toContain('srcset');
  });

  it('validates srcset on source elements as well as images', () => {
    const out = sanitizeHtml(
      '<picture><source srcset="javascript:alert(1) 1x"><img src="/fallback.jpg" alt="x"></picture>',
    );

    expect(out).toBe('<picture><source><img src="/fallback.jpg" alt="x"></picture>');
  });

  it('ignores empty candidates while validating every populated candidate', () => {
    const out = sanitizeHtml('<img srcset=", /safe.jpg 1x,   " alt="x">');

    expect(out).toContain('srcset=", /safe.jpg 1x,   "');
  });
});

describe('sanitizeHtml — protocol-relative anchor hardening', () => {
  it('forces rel=noopener on protocol-relative external links', () => {
    const out = sanitizeHtml('<a href="//evil.example/x" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe('sanitizeHtml — allowFormControls (author templates only)', () => {
  it('drops form controls by default and keeps them when the caller vouches for the markup', () => {
    const html =
      '<div><input type="text" onfocus="x()"><button>b</button><textarea>t</textarea></div>';
    // Dropped completely, content included — a control is never text.
    expect(sanitizeHtml(html)).toBe('<div></div>');
    expect(
      sanitizeHtml(html, {
        allowFormControls: true,
        additionalAllowedAttributes: { input: ['type'] },
      }),
    ).toBe('<div><input type="text"><button>b</button><textarea>t</textarea></div>');
  });

  it('never un-drops form itself, and still strips handlers and unsafe URLs', () => {
    const out = sanitizeHtml(
      '<form action="javascript:x()"><p>inside</p></form><input onclick="y()"><a href="javascript:z()">l</a>',
      { allowFormControls: true },
    );
    expect(out).not.toContain('<form');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<input>');
  });
});
