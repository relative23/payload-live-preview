/**
 * Server-side preview-request detection shared by every adapter.
 */
import { describe, expect, it } from 'vitest';
import { hasPreviewIntent } from '@adapters/shared/preview-request';

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

  it('treats Sec-Fetch-Dest: iframe as a preview signal', () => {
    const request = new Request('https://x.test/p', {
      headers: { 'sec-fetch-dest': 'iframe' },
    });
    expect(hasPreviewIntent(request)).toBe(true);
    expect(hasPreviewIntent(request, { checkFetchDest: false })).toBe(false);
  });

  it('matches referers against admin origins', () => {
    const request = new Request('https://x.test/p', {
      headers: { referer: 'https://cms.example.com/admin/collections/posts/1' },
    });
    expect(hasPreviewIntent(request, { adminOrigins: ['https://cms.example.com'] })).toBe(true);
    expect(hasPreviewIntent(request, { adminOrigins: ['https://other.example'] })).toBe(false);
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
    expect(hasPreviewIntent(request, { adminOrigins: ['also not a url'] })).toBe(false);
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
        adminOrigins: ['https://cms.example.com'],
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
        adminOrigins: ['https://cms.example.com'],
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
    expect(() => hasPreviewIntent(bogus, { adminOrigins: [] })).not.toThrow();
    expect(hasPreviewIntent(bogus, { adminOrigins: [] })).toBe(false);

    const iframe = {
      url: '::::',
      headers: new Headers({ 'sec-fetch-dest': 'iframe' }),
    } as unknown as Request;
    expect(hasPreviewIntent(iframe, { adminOrigins: [] })).toBe(true);
  });
});
