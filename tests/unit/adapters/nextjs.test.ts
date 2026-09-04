import { describe, expect, it } from 'vitest';
import { createLivePreviewMiddleware, renderLivePreviewScript } from '@adapters/nextjs/index';

const ADMIN = 'https://admin.example.com';

interface HtmlInit extends Omit<ResponseInit, 'headers'> {
  readonly headers?: Record<string, string>;
}

function htmlResponse(
  body: string | null = '<html><head></head><body></body></html>',
  init: HtmlInit = {},
) {
  return new Response(body, {
    ...init,
    headers: { 'content-type': 'text/html; charset=utf-8', ...(init.headers ?? {}) },
  });
}

function request(url = 'https://site.example.com/', headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

const always = () => createLivePreviewMiddleware({ defaults: 'v1', inject: 'always' });

describe('renderLivePreviewScript', () => {
  it('returns a script tag carrying the configuration', () => {
    const tag = renderLivePreviewScript({ allowedOrigins: [ADMIN] });
    expect(tag).toMatch(/^<script/u);
    expect(tag).toContain('__LIVE_PREVIEW_CONFIG__');
    expect(tag).toContain(ADMIN);
  });

  it('carries a nonce when one is supplied, and none otherwise', () => {
    expect(renderLivePreviewScript({ allowedOrigins: [ADMIN], nonce: 'abc123' })).toContain(
      'nonce="abc123"',
    );
    expect(renderLivePreviewScript({ allowedOrigins: [ADMIN] })).not.toContain('nonce=');
  });
});

describe('createLivePreviewMiddleware — responses it must not corrupt', () => {
  it('leaves a fragment response without a <head> byte-for-byte intact', async () => {
    const fragment = '<div id="card">just a fragment</div>';
    const result = await always()(request(), htmlResponse(fragment));
    expect(await result.text()).toBe(fragment);
    expect(result.status).toBe(200);
  });

  it('preserves status and statusText when it rewrites the body', async () => {
    const result = await always()(
      request(),
      htmlResponse(undefined, { status: 201, statusText: 'Created' }),
    );
    expect(result.status).toBe(201);
    expect(result.statusText).toBe('Created');
    expect(await result.text()).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('drops the headers that described the old body: length, encoding, ETag', async () => {
    const body = '<html><head></head><body></body></html>';
    const result = await always()(
      request(),
      htmlResponse(body, {
        headers: {
          'content-length': String(body.length),
          'content-encoding': 'gzip',
          etag: '"abc"',
          'x-keep': 'yes',
        },
      }),
    );
    expect(result.headers.get('content-length')).toBeNull();
    expect(result.headers.get('content-encoding')).toBeNull();
    expect(result.headers.get('etag')).toBeNull();
    expect(result.headers.get('x-keep')).toBe('yes');
  });

  it.each([
    ['304 Not Modified', 304],
    ['204 No Content', 204],
    ['a HEAD response', 200],
  ])('passes a null-body response through untouched (%s)', async (_name, status) => {
    const response = htmlResponse(null, { status });
    const result = await always()(request(), response);
    expect(result).toBe(response);
    expect(result.status).toBe(status);
    expect(result.body).toBeNull();
  });

  it('returns the response object itself when it changes nothing', async () => {
    const response = htmlResponse();
    const plain = await createLivePreviewMiddleware({ defaults: 'v1' })(request(), response);
    expect(plain).toBe(response);
    const untouched = await createLivePreviewMiddleware({
      defaults: 'v1',
      inject: 'always',
      autoInject: false,
      manageCsp: false,
    })(request(), response);
    expect(untouched).toBe(response);
    expect(untouched.headers.get('cache-control')).toBeNull();
  });
});

describe('createLivePreviewMiddleware — the nonce', () => {
  it('never travels through a response header; the tag and script-src share one value', async () => {
    const middleware = createLivePreviewMiddleware({
      defaults: 'v1',
      inject: 'always',
      manageCsp: 'full',
    });
    const result = await middleware(request(), htmlResponse());
    const nonce = /nonce="([^"]+)"/u.exec(await result.text())?.[1];
    expect(nonce).toBeTruthy();
    expect(result.headers.get('content-security-policy')).toContain(`'nonce-${String(nonce)}'`);
    expect(result.headers.get('x-live-preview-nonce')).toBeNull();
  });

  it('ignores a nonce header an upstream response tries to smuggle in', async () => {
    const middleware = createLivePreviewMiddleware({
      defaults: 'v1',
      inject: 'always',
      manageCsp: 'full',
    });
    const result = await middleware(
      request(),
      htmlResponse(undefined, { headers: { 'x-live-preview-nonce': 'attacker' } }),
    );
    expect(await result.text()).not.toContain('nonce="attacker"');
    expect(result.headers.get('content-security-policy')).not.toContain('attacker');
  });
});

describe('createLivePreviewMiddleware — a runtime that refuses header mutation', () => {
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
