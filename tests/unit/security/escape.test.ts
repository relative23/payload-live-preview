import { describe, expect, it } from 'vitest';
import { escapeHtml, escapeCssUrl, escapeAndLinebreak } from '@security/escape';

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

  it('handles unicode escape sequences', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('handles very long strings without truncation', () => {
    const input = '<'.repeat(10_000);
    const result = escapeHtml(input);
    expect(result).toBe('&lt;'.repeat(10_000));
  });

  it('does not re-escape already escaped entities', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
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
