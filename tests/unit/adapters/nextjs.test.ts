import { describe, expect, it, vi } from 'vitest';
import { createLivePreviewMiddleware, renderLivePreviewScript } from '@adapters/nextjs/index';

/**
 * The Next.js adapter had no unit tests. Four browser fixtures drive it end to
 * end, which proves the happy path works but says nothing about the branches
 * around it: a JSON response, a CSP that already exists, an intent signal that
 * should not count. Those are cheap to get wrong and invisible until a
 * consumer hits them.
 */

const ADMIN = 'https://admin.example.com';

interface HtmlInit extends Omit<ResponseInit, 'headers'> {
  readonly headers?: Record<string, string>;
}

function htmlResponse(body = '<html><head></head><body></body></html>', init: HtmlInit = {}) {
  return new Response(body, {
    ...init,
    headers: { 'content-type': 'text/html; charset=utf-8', ...(init.headers ?? {}) },
  });
}

function request(url = 'https://site.example.com/', headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

const IFRAME = { 'sec-fetch-dest': 'iframe' } as const;

describe('createLivePreviewMiddleware — when it injects', () => {
  it('leaves an ordinary request completely untouched', async () => {
    const middleware = createLivePreviewMiddleware({ allowedOrigins: [ADMIN] });
    const original = htmlResponse();
    const result = await middleware(request(), original);

    expect(result).toBe(original);
    expect(await result.text()).not.toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('injects for a query-parameter intent signal', async () => {
    const middleware = createLivePreviewMiddleware({ allowedOrigins: [ADMIN] });
    const result = await middleware(
      request('https://site.example.com/?preview=true'),
      htmlResponse(),
    );
    expect(await result.text()).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('injects for an iframe load', async () => {
    const middleware = createLivePreviewMiddleware({ allowedOrigins: [ADMIN] });
    const result = await middleware(request('https://site.example.com/', IFRAME), htmlResponse());
    expect(await result.text()).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it("injects into every HTML response with inject: 'always'", async () => {
    const middleware = createLivePreviewMiddleware({ inject: 'always' });
    const result = await middleware(request(), htmlResponse());
    expect(await result.text()).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('never injects into a non-HTML response', async () => {
    // Injecting a script into JSON corrupts the payload for the caller and is
    // the kind of thing a browser fixture would never notice.
    const middleware = createLivePreviewMiddleware({ inject: 'always' });
    const json = new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
    });
    const result = await middleware(request(), json);
    expect(await result.text()).toBe('{"ok":true}');
  });

  it('honours autoInject: false while still managing CSP', async () => {
    const middleware = createLivePreviewMiddleware({
      inject: 'always',
      autoInject: false,
      allowedOrigins: [ADMIN],
    });
    const result = await middleware(request(), htmlResponse());
    expect(await result.text()).not.toContain('__LIVE_PREVIEW_CONFIG__');
    expect(result.headers.get('content-security-policy')).toContain('frame-ancestors');
  });

  it('honours a shouldInject predicate and passes it the request', async () => {
    const shouldInject = vi.fn((_request: Request) => false);
    const middleware = createLivePreviewMiddleware({ inject: 'always', shouldInject });
    const result = await middleware(request('https://site.example.com/private'), htmlResponse());

    expect(await result.text()).not.toContain('__LIVE_PREVIEW_CONFIG__');
    expect(shouldInject).toHaveBeenCalledOnce();
    expect(shouldInject.mock.calls[0]?.[0]?.url).toContain('/private');
  });
});

describe('createLivePreviewMiddleware — CSP', () => {
  it('adds frame-ancestors for the configured admin origin', async () => {
    const middleware = createLivePreviewMiddleware({ allowedOrigins: [ADMIN] });
    const result = await middleware(request('https://site.example.com/', IFRAME), htmlResponse());
    const csp = result.headers.get('content-security-policy') ?? '';

    expect(csp).toContain('frame-ancestors');
    expect(csp).toContain(ADMIN);
  });

  it('manages only frame-ancestors by default, leaving script-src alone', async () => {
    // Silently tightening script-src would break unrelated application scripts.
    const middleware = createLivePreviewMiddleware({ allowedOrigins: [ADMIN] });
    const result = await middleware(request('https://site.example.com/', IFRAME), htmlResponse());
    expect(result.headers.get('content-security-policy')).not.toContain('script-src');
  });

  it('keeps the directives an existing policy already declared', async () => {
    const middleware = createLivePreviewMiddleware({ allowedOrigins: [ADMIN] });
    const result = await middleware(
      request('https://site.example.com/', IFRAME),
      htmlResponse(undefined, {
        headers: { 'content-security-policy': "default-src 'self'; img-src *" },
      }),
    );
    const csp = result.headers.get('content-security-policy') ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('img-src *');
    expect(csp).toContain('frame-ancestors');
  });

  it('does not touch CSP when manageCsp is false', async () => {
    const middleware = createLivePreviewMiddleware({
      allowedOrigins: [ADMIN],
      manageCsp: false,
    });
    const result = await middleware(request('https://site.example.com/', IFRAME), htmlResponse());
    expect(result.headers.get('content-security-policy')).toBeNull();
  });

  it('leaves CSP untouched on a request with no preview intent', async () => {
    // The gate is intent, not content: an ordinary visitor's response must not
    // grow a frame-ancestors header it never had.
    const middleware = createLivePreviewMiddleware({ allowedOrigins: [ADMIN] });
    const result = await middleware(request(), htmlResponse());
    expect(result.headers.get('content-security-policy')).toBeNull();
  });
});

describe('renderLivePreviewScript', () => {
  it('returns a script tag carrying the configuration', () => {
    const tag = renderLivePreviewScript({ allowedOrigins: [ADMIN] });
    expect(tag).toMatch(/^<script/u);
    expect(tag).toContain('__LIVE_PREVIEW_CONFIG__');
    expect(tag).toContain(ADMIN);
  });

  it('carries a nonce when one is supplied', () => {
    const tag = renderLivePreviewScript({ allowedOrigins: [ADMIN], nonce: 'abc123' });
    expect(tag).toContain('nonce="abc123"');
  });

  it('omits the nonce attribute when none is supplied', () => {
    expect(renderLivePreviewScript({ allowedOrigins: [ADMIN] })).not.toContain('nonce=');
  });
});

describe('createLivePreviewMiddleware — CSP in full mode', () => {
  it('adds a nonce-based script-src and reuses it for the injected tag', async () => {
    // The nonce travels from the injection step to addCsp through the
    // x-live-preview-nonce header. If those two ever drifted apart, CSP would
    // reject the very script this adapter injected.
    const middleware = createLivePreviewMiddleware({ inject: 'always', manageCsp: 'full' });
    const result = await middleware(request(), htmlResponse());
    const csp = result.headers.get('content-security-policy') ?? '';
    const html = await result.text();

    const nonce = /nonce="([^"]+)"/u.exec(html)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain('script-src');
    expect(csp).toContain(`'nonce-${String(nonce)}'`);
  });

  it("keeps script-src out of the header in the default 'frame-ancestors' mode", async () => {
    const middleware = createLivePreviewMiddleware({ inject: 'always', manageCsp: true });
    const result = await middleware(request(), htmlResponse());
    expect(result.headers.get('content-security-policy')).not.toContain('script-src');
  });
});

describe('createLivePreviewMiddleware — responses it must not corrupt', () => {
  it('leaves a fragment response without a <head> byte-for-byte intact', async () => {
    // Next.js serves RSC and partial responses that are HTML but have no head.
    // Prepending a script there would put it ahead of the fragment's own markup.
    const fragment = '<div id="card">just a fragment</div>';
    const middleware = createLivePreviewMiddleware({ inject: 'always' });
    const result = await middleware(request(), htmlResponse(fragment));

    expect(await result.text()).toBe(fragment);
    expect(result.status).toBe(200);
  });

  it('preserves status and statusText when it rewrites the body', async () => {
    const middleware = createLivePreviewMiddleware({ inject: 'always' });
    const result = await middleware(
      request(),
      htmlResponse(undefined, { status: 201, statusText: 'Created' }),
    );

    expect(result.status).toBe(201);
    expect(result.statusText).toBe('Created');
    expect(await result.text()).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('drops a stale content-length after injecting', async () => {
    // The injected script makes the body longer. A surviving content-length
    // would truncate the page at the client.
    const body = '<html><head></head><body></body></html>';
    const middleware = createLivePreviewMiddleware({ inject: 'always' });
    const result = await middleware(
      request(),
      htmlResponse(body, { headers: { 'content-length': String(body.length) } }),
    );

    expect(result.headers.get('content-length')).toBeNull();
  });
});

describe('createLivePreviewMiddleware — a runtime that refuses header mutation', () => {
  /** Some runtimes hand back responses whose header guard is immutable. */
  function withFrozenHeaders(response: Response): Response {
    Object.defineProperty(response.headers, 'set', {
      value: () => {
        throw new TypeError('immutable');
      },
    });
    return response;
  }

  it('falls back to a fresh response instead of throwing', async () => {
    const middleware = createLivePreviewMiddleware({
      inject: 'always',
      autoInject: false,
      allowedOrigins: [ADMIN],
    });
    const result = await middleware(request(), withFrozenHeaders(htmlResponse('<p>body</p>')));

    expect(result.headers.get('content-security-policy')).toContain('frame-ancestors');
    expect(await result.text()).toBe('<p>body</p>');
  });
});
