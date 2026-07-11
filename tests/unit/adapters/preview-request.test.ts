/**
 * Server-side preview-request detection shared by every adapter.
 */
import { describe, expect, it } from 'vitest';
import { isPreviewRequest } from '@adapters/shared/preview-request';

describe('isPreviewRequest', () => {
  it('detects the default preview query params', () => {
    expect(isPreviewRequest(new Request('https://x.test/p?preview=true'))).toBe(true);
    expect(isPreviewRequest(new Request('https://x.test/p?draft=1'))).toBe(true);
    expect(isPreviewRequest(new Request('https://x.test/p?livePreview=true'))).toBe(true);
  });

  it('requires the value to be true or 1', () => {
    expect(isPreviewRequest(new Request('https://x.test/p?preview=false'))).toBe(false);
    expect(isPreviewRequest(new Request('https://x.test/p?preview='))).toBe(false);
  });

  it('treats Sec-Fetch-Dest: iframe as a preview signal', () => {
    const request = new Request('https://x.test/p', {
      headers: { 'sec-fetch-dest': 'iframe' },
    });
    expect(isPreviewRequest(request)).toBe(true);
    expect(isPreviewRequest(request, { checkFetchDest: false })).toBe(false);
  });

  it('matches referers against admin origins', () => {
    const request = new Request('https://x.test/p', {
      headers: { referer: 'https://cms.example.com/admin/collections/posts/1' },
    });
    expect(isPreviewRequest(request, { adminOrigins: ['https://cms.example.com'] })).toBe(true);
    expect(isPreviewRequest(request, { adminOrigins: ['https://other.example'] })).toBe(false);
    expect(isPreviewRequest(request)).toBe(false);
  });

  it('honours custom query params', () => {
    const request = new Request('https://x.test/p?vorschau=true');
    expect(isPreviewRequest(request, { queryParams: ['vorschau'] })).toBe(true);
    expect(isPreviewRequest(request)).toBe(false);
  });

  it('returns false for a plain production request', () => {
    expect(isPreviewRequest(new Request('https://x.test/'))).toBe(false);
  });

  it('accepts a minimal request-like shim (Nitro/H3 adapters)', () => {
    const shim = {
      url: 'http://localhost/p?draft=true',
      headers: { get: () => null },
    };
    expect(isPreviewRequest(shim)).toBe(true);
  });

  it('ignores malformed referers and configured origins', () => {
    const request = new Request('https://x.test/p', {
      headers: { referer: 'not a url' },
    });
    expect(isPreviewRequest(request, { adminOrigins: ['also not a url'] })).toBe(false);
  });
});

describe('isPreviewRequest — signal restriction', () => {
  it("signals: ['query'] ignores fetch-dest and referer", () => {
    const iframeLoad = new Request('https://x.test/p', {
      headers: {
        'sec-fetch-dest': 'iframe',
        referer: 'https://cms.example.com/admin',
      },
    });
    expect(
      isPreviewRequest(iframeLoad, {
        signals: ['query'],
        adminOrigins: ['https://cms.example.com'],
      }),
    ).toBe(false);
    expect(
      isPreviewRequest(new Request('https://x.test/p?preview=true'), { signals: ['query'] }),
    ).toBe(true);
  });

  it("signals: ['referer'] ignores query and fetch-dest", () => {
    expect(
      isPreviewRequest(new Request('https://x.test/p?preview=true'), { signals: ['referer'] }),
    ).toBe(false);
    const fromAdmin = new Request('https://x.test/p', {
      headers: { referer: 'https://cms.example.com/admin' },
    });
    expect(
      isPreviewRequest(fromAdmin, {
        signals: ['referer'],
        adminOrigins: ['https://cms.example.com'],
      }),
    ).toBe(true);
  });
});
