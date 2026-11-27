import { describe, expect, it } from 'vitest';
import { hasPreviewIntent, type PreviewRequestOptions } from '@adapters/shared/preview-request';

describe('hasPreviewIntent', () => {
  it('detects the default preview query params', () => {
    expect(hasPreviewIntent(new Request('https://x.test/p?preview=true'))).toBe(true);
    expect(hasPreviewIntent(new Request('https://x.test/p?draft=1'))).toBe(true);
    expect(hasPreviewIntent(new Request('https://x.test/p?livePreview=true'))).toBe(true);
  });

  it('requires the value to be true or 1', () => {
    expect(hasPreviewIntent(new Request('https://x.test/p?preview=false'))).toBe(false);
    expect(hasPreviewIntent(new Request('https://x.test/p?preview='))).toBe(false);
  });

  it('reads the last value of a repeated parameter, as a Next.js has-rule does', () => {
    // Next matches `has: [{ type: 'query' }]` against the last value of a
    // repeated key. The runtime and the cache header have to agree on
    // `?preview=true&preview=0`, or the page is injected yet cacheable.
    expect(hasPreviewIntent(new Request('https://x.test/p?preview=true&preview=0'))).toBe(false);
    expect(hasPreviewIntent(new Request('https://x.test/p?preview=0&preview=true'))).toBe(true);
  });

  it('treats Sec-Fetch-Dest: iframe as a preview signal', () => {
    const request = new Request('https://x.test/p', {
      headers: { 'sec-fetch-dest': 'iframe' },
    });
    expect(hasPreviewIntent(request)).toBe(true);
    expect(hasPreviewIntent(request, { signals: ['query', 'referer'] })).toBe(false);
  });

  it('matches referers against admin origins', () => {
    const request = new Request('https://x.test/p', {
      headers: { referer: 'https://cms.example.com/admin/collections/posts/1' },
    });
    expect(hasPreviewIntent(request, { allowedOrigins: ['https://cms.example.com'] })).toBe(true);
    expect(hasPreviewIntent(request, { allowedOrigins: ['https://other.example'] })).toBe(false);
    expect(hasPreviewIntent(request)).toBe(false);
  });

  it('honours custom query params', () => {
    const request = new Request('https://x.test/p?vorschau=true');
    expect(hasPreviewIntent(request, { queryParams: ['vorschau'] })).toBe(true);
    expect(hasPreviewIntent(request)).toBe(false);
  });

  it('returns false for a plain production request', () => {
    expect(hasPreviewIntent(new Request('https://x.test/'))).toBe(false);
  });

  it('accepts a minimal request-like shim (Nitro/H3 adapters)', () => {
    const shim = {
      url: 'http://localhost/p?draft=true',
      headers: { get: () => null },
    };
    expect(hasPreviewIntent(shim)).toBe(true);
  });

  it('ignores malformed referers and configured origins', () => {
    const request = new Request('https://x.test/p', {
      headers: { referer: 'not a url' },
    });
    expect(hasPreviewIntent(request, { allowedOrigins: ['also not a url'] })).toBe(false);
  });
});

describe('hasPreviewIntent — signal restriction', () => {
  it("signals: ['query'] ignores fetch-dest and referer", () => {
    const iframeLoad = new Request('https://x.test/p', {
      headers: {
        'sec-fetch-dest': 'iframe',
        referer: 'https://cms.example.com/admin',
      },
    });
    expect(
      hasPreviewIntent(iframeLoad, {
        signals: ['query'],
        allowedOrigins: ['https://cms.example.com'],
      }),
    ).toBe(false);
    expect(
      hasPreviewIntent(new Request('https://x.test/p?preview=true'), { signals: ['query'] }),
    ).toBe(true);
  });

  it("signals: ['referer'] ignores query and fetch-dest", () => {
    expect(
      hasPreviewIntent(new Request('https://x.test/p?preview=true'), { signals: ['referer'] }),
    ).toBe(false);
    const fromAdmin = new Request('https://x.test/p', {
      headers: { referer: 'https://cms.example.com/admin' },
    });
    expect(
      hasPreviewIntent(fromAdmin, {
        signals: ['referer'],
        allowedOrigins: ['https://cms.example.com'],
      }),
    ).toBe(true);
  });
});

describe('hasPreviewIntent — a url the URL parser rejects', () => {
  it('treats an unparseable url as "no query signal" rather than throwing', () => {
    // Adapters synthesise a Request-like object from framework events, and a
    // malformed one must not take the whole request down. The other signals
    // still have to work.
    const bogus = { url: 'not a url', headers: new Headers() } as unknown as Request;
    expect(() => hasPreviewIntent(bogus, { allowedOrigins: [] })).not.toThrow();
    expect(hasPreviewIntent(bogus, { allowedOrigins: [] })).toBe(false);

    const iframe = {
      url: '::::',
      headers: new Headers({ 'sec-fetch-dest': 'iframe' }),
    } as unknown as Request;
    expect(hasPreviewIntent(iframe, { allowedOrigins: [] })).toBe(true);
  });
});

describe('hasPreviewIntent — allowedOrigins is the one name for the admin origins', () => {
  const CMS = 'https://cms.example.com';
  const OTHER = 'https://other.example';
  const fromAdmin = () =>
    new Request('https://x.test/p', { headers: { referer: `${CMS}/admin/collections/posts/1` } });

  it.each([
    ['the admin origin', { allowedOrigins: [CMS] }, true],
    ['another origin', { allowedOrigins: [OTHER] }, false],
  ] as const)('%s decides the referer signal', (_label, options, expected) => {
    expect(hasPreviewIntent(fromAdmin(), options)).toBe(expected);
    expect(hasPreviewIntent(fromAdmin(), { ...options, signals: ['referer'] })).toBe(expected);
  });

  it('counts nothing for the referer signal where no origin is named', () => {
    expect(hasPreviewIntent(fromAdmin(), { signals: ['referer'] })).toBe(false);
    expect(hasPreviewIntent(fromAdmin(), { signals: ['referer'], allowedOrigins: [] })).toBe(false);
  });

  it('counts nothing for the referer signal where the request names no referer', () => {
    const withoutReferer = new Request('https://x.test/p');

    expect(hasPreviewIntent(withoutReferer, { signals: ['referer'], allowedOrigins: [CMS] })).toBe(
      false,
    );
  });

  it('does not read the 1.x key adminOrigins, which 3.0 removed (ADR 0007, row 13)', () => {
    const removed = { adminOrigins: [CMS] } as PreviewRequestOptions;

    expect(hasPreviewIntent(fromAdmin(), removed)).toBe(false);
    expect(hasPreviewIntent(fromAdmin(), { ...removed, signals: ['referer'] })).toBe(false);
  });
});
