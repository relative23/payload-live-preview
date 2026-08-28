import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  escapeHtmlAttribute,
  escapeCssUrl,
  escapeAndLinebreak,
} from '@security/escape';

describe('escapeHtml', () => {
  it.each([
    ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;&#x2F;script&gt;'],
    ['foo & bar', 'foo &amp; bar'],
    ['"quoted"', '&quot;quoted&quot;'],
    ["it's fine", 'it&#x27;s fine'],
    ['back`tick', 'back&#x60;tick'],
    ['eq=sign', 'eq&#x3D;sign'],
    ['plain text', 'plain text'],
    ['', ''],
  ])('escapes %j correctly', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  it('escapes each occurrence', () => {
    expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
  });

  it('handles very long strings without truncation', () => {
    expect(escapeHtml('<'.repeat(10_000))).toBe('&lt;'.repeat(10_000));
  });

  it('does not re-escape already escaped entities', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('does not coerce non-strings — the docs say to String() them first', () => {
    expect(() => escapeHtml(123 as unknown as string)).toThrow(TypeError);
  });
});

describe('escapeHtmlAttribute', () => {
  it.each([
    ['a"b', 'a&quot;b'],
    ["a'b", 'a&#x27;b'],
    ['a<b>c', 'a&lt;b&gt;c'],
    ['a&b', 'a&amp;b'],
    ['', ''],
  ])('escapes %j so it cannot close a quoted attribute', (input, expected) => {
    expect(escapeHtmlAttribute(input)).toBe(expected);
  });

  it('leaves URL characters alone', () => {
    const url = 'https://example.com/a/b?x=1&y=2#frag=`';
    expect(escapeHtmlAttribute(url)).toBe('https://example.com/a/b?x=1&amp;y=2#frag=`');
  });

  it('does not block dangerous schemes — that is isSafeUrl()', () => {
    expect(escapeHtmlAttribute('javascript:alert(1)')).toBe('javascript:alert(1)');
  });

  it('escapes each occurrence', () => {
    expect(escapeHtmlAttribute('""')).toBe('&quot;&quot;');
  });
});

describe('escapeCssUrl', () => {
  it('escapes characters that can break out of url() literals', () => {
    expect(escapeCssUrl('a"b')).toBe('a\\"b');
    expect(escapeCssUrl("a'b")).toBe("a\\'b");
    expect(escapeCssUrl('a(b)c')).toBe('a\\(b\\)c');
    expect(escapeCssUrl('a\\b')).toBe('a\\\\b');
  });

  it('passes through safe characters', () => {
    expect(escapeCssUrl('https://example.com/path?q=1#fragment')).toBe(
      'https://example.com/path?q=1#fragment',
    );
  });

  it('handles empty input', () => {
    expect(escapeCssUrl('')).toBe('');
  });
});

describe('escapeAndLinebreak', () => {
  it('escapes html before inserting <br>', () => {
    expect(escapeAndLinebreak('<b>\nbold')).toBe('&lt;b&gt;<br>bold');
  });

  it('handles CR, LF, and CRLF identically', () => {
    expect(escapeAndLinebreak('a\nb\r\nc\rd')).toBe('a<br>b<br>c<br>d');
  });

  it('produces empty output for empty input', () => {
    expect(escapeAndLinebreak('')).toBe('');
  });

  it('does not insert <br> for text without newlines', () => {
    expect(escapeAndLinebreak('one line')).toBe('one line');
  });
});
