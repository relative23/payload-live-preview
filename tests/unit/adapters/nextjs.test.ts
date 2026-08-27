import { describe, expect, it } from 'vitest';
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

describe('createLivePreviewMiddleware — responses it must not corrupt', () => {
  it('leaves a fragment response without a <head> byte-for-byte intact', async () => {
    // Next.js serves RSC and partial responses that are HTML but have no head.
    // Prepending a script there would put it ahead of the fragment's own markup.
    const fragment = '<div id="card">just a fragment</div>';
    const middleware = createLivePreviewMiddleware({ defaults: 'v1', inject: 'always' });
    const result = await middleware(request(), htmlResponse(fragment));

    expect(await result.text()).toBe(fragment);
    expect(result.status).toBe(200);
  });

  it('preserves status and statusText when it rewrites the body', async () => {
    const middleware = createLivePreviewMiddleware({ defaults: 'v1', inject: 'always' });
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
    const middleware = createLivePreviewMiddleware({ defaults: 'v1', inject: 'always' });
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
      defaults: 'v1',
      inject: 'always',
      autoInject: false,
      allowedOrigins: [ADMIN],
    });
    const result = await middleware(request(), withFrozenHeaders(htmlResponse('<p>body</p>')));

    expect(result.headers.get('content-security-policy')).toContain('frame-ancestors');
    expect(await result.text()).toBe('<p>body</p>');
  });
});
