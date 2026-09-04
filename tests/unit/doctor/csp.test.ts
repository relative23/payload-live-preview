import { describe, expect, it } from 'vitest';
import { frameAncestorsAdmits, frameAncestorsOf } from '@doctor/csp';

const PAGE = 'https://example.com/blog/hello';

describe('frameAncestorsOf', () => {
  it('finds the directive wherever it sits and ignores look-alikes', () => {
    expect(frameAncestorsOf("default-src 'self'; frame-ancestors https://a; img-src *")).toBe(
      'frame-ancestors https://a',
    );
    expect(frameAncestorsOf('Frame-Ancestors https://a')).toBe('Frame-Ancestors https://a');
    expect(frameAncestorsOf("default-src 'self'; script-src 'self'")).toBeUndefined();
    expect(frameAncestorsOf('frame-ancestors-extra https://a')).toBeUndefined();
    expect(frameAncestorsOf(undefined)).toBeUndefined();
  });
});

describe('frameAncestorsAdmits', () => {
  it.each([
    ["frame-ancestors 'self' https://cms.example.com", 'https://cms.example.com', PAGE, true],
    ['frame-ancestors https://*.example.com', 'https://cms.example.com', PAGE, true],
    ['frame-ancestors https://*.example.com', 'https://a.b.example.com', PAGE, true],
    ['frame-ancestors https://*.example.com', 'https://example.com', PAGE, false],
    ['frame-ancestors https://cms.example.com', 'https://cms.example.com.evil.com', PAGE, false],
    ['frame-ancestors https://cms.example.com', 'https://evil-cms.example.com', PAGE, false],
    ['frame-ancestors https://cms.example.com', 'https://cms.example.com/admin', PAGE, true],
    ['frame-ancestors https://cms.example.com/admin/', 'https://cms.example.com', PAGE, true],
    ['frame-ancestors https://cms.example.com', 'https://cms.example.com:8443', PAGE, false],
    ['frame-ancestors https://cms.example.com:*', 'https://cms.example.com:8443', PAGE, true],
    ['frame-ancestors https://cms.example.com:443', 'https://cms.example.com', PAGE, true],
    ['frame-ancestors https://cms.example.com:8443', 'https://cms.example.com:8443', PAGE, true],
    ['frame-ancestors cms.example.com', 'https://cms.example.com', PAGE, true],
    ['frame-ancestors cms.example.com', 'http://cms.example.com', PAGE, false],
    ['frame-ancestors cms.example.com', 'https://cms.example.com', 'http://example.com/', true],
    ['frame-ancestors http://cms.example.com', 'https://cms.example.com', PAGE, true],
    ['frame-ancestors https://cms.example.com', 'http://cms.example.com', PAGE, false],
    ['frame-ancestors HTTPS://CMS.EXAMPLE.COM', 'https://cms.example.com', PAGE, true],
    ['frame-ancestors https:', 'https://anything.example', PAGE, true],
    ['frame-ancestors https:', 'http://anything.example', PAGE, false],
    ['frame-ancestors *', 'https://anything.example', PAGE, true],
    ["frame-ancestors 'none'", 'https://cms.example.com', PAGE, false],
    ['frame-ancestors', 'https://cms.example.com', PAGE, false],
    ["frame-ancestors 'self'", 'https://example.com', PAGE, true],
    ["frame-ancestors 'self'", 'https://example.com:8443', PAGE, false],
    ["frame-ancestors 'self'", 'https://cms.example.com', PAGE, false],
    ["frame-ancestors 'self'", 'https://example.com', 'http://example.com/', true],
    ["frame-ancestors 'unsafe-inline'", 'https://cms.example.com', PAGE, false],
    [
      'frame-ancestors http://localhost:3000',
      'http://localhost:3000',
      'http://localhost:4321/',
      true,
    ],
    [
      'frame-ancestors http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:4321/',
      false,
    ],
  ])('%s admits %s on %s → %s', (directive, admin, page, expected) => {
    expect(frameAncestorsAdmits(directive, new URL(admin), new URL(page))).toBe(expected);
  });
});
