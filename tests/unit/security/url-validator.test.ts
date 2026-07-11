import { describe, expect, it } from 'vitest';
import { isSafeUrl, isExternalHttpUrl, SAFE_URL_PROTOCOLS } from '@security/url-validator';

describe('isSafeUrl — allowed forms', () => {
  it.each([
    'http://localhost:3000',
    'https://example.com',
    'https://example.com:8080/path',
    'https://user:pass@example.com',
    'mailto:hello@example.com',
    'tel:+1234567890',
    '//example.com/path',
    '/absolute/path',
    './relative/path',
    '../parent/path',
    'plain/path',
    '#fragment',
    '?query=1',
  ])('returns true for %s', (input) => {
    expect(isSafeUrl(input)).toBe(true);
  });
});

describe('isSafeUrl — denied forms', () => {
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'jAvAsCrIpT:alert(1)',
    ' javascript:alert(1)',
    '\tjavascript:alert(1)',
    'data:text/html,<script>',
    'Data:text/html,<script>',
    'vbscript:msgbox()',
    'VBSCRIPT:msgbox()',
    'file:///etc/passwd',
    'blob:http://example.com/abc',
    'about:blank',
  ])('returns false for %s', (input) => {
    expect(isSafeUrl(input)).toBe(false);
  });

  it('returns false for empty string (security tightening from legacy behavior)', () => {
    expect(isSafeUrl('')).toBe(false);
  });

  it('returns false for whitespace-only input', () => {
    expect(isSafeUrl('   ')).toBe(false);
  });

  it.each([null, undefined, 42, true, {}, [], Symbol('s')])(
    'returns false for non-string %s',
    (input) => {
      expect(isSafeUrl(input)).toBe(false);
    },
  );

  it('returns false for unknown custom schemes', () => {
    expect(isSafeUrl('myapp://foo')).toBe(false);
  });

  it('returns false for ftp:', () => {
    expect(isSafeUrl('ftp://example.com')).toBe(false);
  });
});

describe('isExternalHttpUrl', () => {
  it.each([
    ['https://example.com', true],
    ['http://example.com', true],
    ['HTTPS://EXAMPLE.COM', true],
    ['/relative', false],
    ['mailto:foo@example.com', false],
    ['tel:123', false],
    ['javascript:alert(1)', false],
    ['', false],
  ] as const)('classifies %s correctly', (input, expected) => {
    expect(isExternalHttpUrl(input)).toBe(expected);
  });
});

describe('SAFE_URL_PROTOCOLS', () => {
  it('contains exactly the four expected protocols', () => {
    expect(SAFE_URL_PROTOCOLS.size).toBe(4);
    expect(SAFE_URL_PROTOCOLS.has('http:')).toBe(true);
    expect(SAFE_URL_PROTOCOLS.has('https:')).toBe(true);
    expect(SAFE_URL_PROTOCOLS.has('mailto:')).toBe(true);
    expect(SAFE_URL_PROTOCOLS.has('tel:')).toBe(true);
  });
});
