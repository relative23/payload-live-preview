import { describe, expect, it, vi } from 'vitest';
import { sanitizeHtml, setSanitizerDocument } from '@security/sanitizer';

describe('sanitizeHtml — allow-list', () => {
  it('keeps allowed tags and structure', () => {
    expect(sanitizeHtml('<p>hello <strong>world</strong></p>')).toBe(
      '<p>hello <strong>world</strong></p>',
    );
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
    expect(sanitizeHtml('<custom>kept</custom>')).toBe('kept');
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
    expect(sanitizeHtml('<p>safe</p><script>alert(1)</script>')).toBe('<p>safe</p>');
  });

  it('removes <style> entirely', () => {
    expect(sanitizeHtml('<p>safe</p><style>body{}</style>')).toBe('<p>safe</p>');
  });

  it('removes <iframe>, <object>, <embed>, <link>, <meta>', () => {
    expect(sanitizeHtml('<iframe src="x"></iframe><object></object><embed><link><meta>')).toBe('');
  });

  it('removes <form> and form controls entirely', () => {
    expect(
      sanitizeHtml('<form><input><button>x</button><select></select><textarea></textarea></form>'),
    ).toBe('');
  });

  it('strips event-handler attributes from allowed tags', () => {
    const result = sanitizeHtml('<p onclick="alert(1)" onmouseover="x()">x</p>');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onmouseover');
    expect(result).toContain('<p>x</p>');
  });

  it('strips inline style attribute (CSS-injection vector)', () => {
    expect(sanitizeHtml('<p style="background:url(javascript:1)">x</p>')).toBe('<p>x</p>');
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

  it('strips javascript: from href and img src', () => {
    const link = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(link).not.toContain('javascript:');
    expect(link).toContain('>x</a>');
    const img = sanitizeHtml('<img src="javascript:alert(1)" alt="x">');
    expect(img).not.toContain('javascript:');
    expect(img).toContain('alt="x"');
  });

  it('removes HTML comments', () => {
    expect(sanitizeHtml('<p>a</p><!-- evil --><p>b</p>')).toBe('<p>a</p><p>b</p>');
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
      { additionalAllowedAttributes: { span: ['href', 'rel', 'target'] } },
    );
    expect(result).toBe('<span href="https://example.com" rel="author" target="_self">x</span>');
  });

  it.each([
    ['//evil.example/x'],
    ['/\\evil.example/x'],
    ['\\\\evil.example/x'],
    ['\\/evil.example/x'],
  ])('forces rel=noopener on the protocol-relative form %s', (href) => {
    // Browsers resolve `\` as `/`, so each of these leaves the origin.
    const out = sanitizeHtml(`<a href="${href}">x</a>`);
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });
});

describe('sanitizeHtml — nested and deep content', () => {
  it('handles deeply nested allowed tags', () => {
    expect(sanitizeHtml('<p><strong><em><u>deep</u></em></strong></p>')).toBe(
      '<p><strong><em><u>deep</u></em></strong></p>',
    );
  });

  it('strips event handlers inside nested allowed tags', () => {
    expect(sanitizeHtml('<p><strong onclick="x()">y</strong></p>')).not.toContain('onclick');
  });

  it('does not allow svg or math', () => {
    expect(sanitizeHtml('<svg><rect /></svg><math></math>')).toBe('');
  });
});

describe('sanitizeHtml — option overrides', () => {
  it('honours additionalAllowedTags', () => {
    expect(sanitizeHtml('<custom>kept</custom>', { additionalAllowedTags: ['custom'] })).toBe(
      '<custom>kept</custom>',
    );
  });

  it('honours additionalAllowedAttributes', () => {
    const result = sanitizeHtml('<span foo="bar">x</span>', {
      additionalAllowedAttributes: { span: ['foo'] },
    });
    expect(result).toContain('foo="bar"');
  });

  it('merges additional attributes with the built-in per-tag policy', () => {
    const result = sanitizeHtml('<a href="/safe" data-custom="yes">x</a>', {
      policy: 'compat',
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

describe('sanitizeHtml — allowFormControls (author templates only)', () => {
  it('drops form controls by default and keeps them when the caller vouches for the markup', () => {
    const html =
      '<div><input type="text" onfocus="x()"><button>b</button><textarea>t</textarea></div>';
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
