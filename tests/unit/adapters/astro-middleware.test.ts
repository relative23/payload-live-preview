import { describe, expect, it, vi } from 'vitest';
import {
  createLivePreviewMiddleware,
  AUTHORIZATION_OUTCOME_LOCALS_KEY,
  NONCE_LOCALS_KEY,
  renderLivePreviewScript,
} from '@adapters/astro/index';

const ADMIN = 'https://admin.example.com';

function context(url: string) {
  return { request: new Request(url), locals: {} as Record<string, unknown> };
}
const preview = () => context('https://example.com/page?preview=true');
const plain = () => context('https://example.com/page');

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

describe('createLivePreviewMiddleware', () => {
  it('writes a nonce to locals on every request', async () => {
    const middleware = createLivePreviewMiddleware({ defaults: 'v1' });
    const ctx = plain();
    await middleware(ctx, () => Promise.resolve(htmlResponse('<html><head></head></html>')));
    expect(typeof ctx.locals[NONCE_LOCALS_KEY]).toBe('string');
    expect((ctx.locals[NONCE_LOCALS_KEY] as string).length).toBeGreaterThan(10);
  });

  it('skips prerendered contexts entirely (Astro 5 build-time middleware)', async () => {
    const middleware = createLivePreviewMiddleware({ defaults: 'v1' });
    const ctx = { ...preview(), isPrerendered: true };
    const original = htmlResponse('<html><head></head></html>');
    const response = await middleware(ctx, () => Promise.resolve(original));
    expect(response).toBe(original);
    expect(await response.text()).not.toContain('<script');
  });

  it('publishes the authorization outcome for the page', async () => {
    const middleware = createLivePreviewMiddleware({
      allowedOrigins: [ADMIN],
      authorizePreview: () => ({ authorized: false, outcome: 'expired', context: null }),
    });
    const ctx = preview();
    await middleware(ctx, () => Promise.resolve(htmlResponse('<html><head></head></html>')));
    expect(ctx.locals[AUTHORIZATION_OUTCOME_LOCALS_KEY]).toBe('expired');
  });

  it('adds strict-dynamic only when explicitly requested', async () => {
    const middleware = createLivePreviewMiddleware({
      defaults: 'v1',
      manageCsp: 'full',
      strictDynamic: true,
    });
    const response = await middleware(preview(), () =>
      Promise.resolve(htmlResponse('<html><head></head></html>')),
    );
    expect(response.headers.get('content-security-policy')).toContain("'strict-dynamic'");
  });

  it('parses CSP ASCII whitespace and ignores duplicate directive relaxations', async () => {
    const middleware = createLivePreviewMiddleware({ defaults: 'v1', allowedOrigins: [ADMIN] });
    const response = await middleware(preview(), () =>
      Promise.resolve(
        new Response('<html><head></head></html>', {
          headers: {
            'content-type': 'text/html',
            'content-security-policy':
              "default-src\t'self'; frame-ancestors 'none'; FRAME-ANCESTORS *",
          },
        }),
      ),
    );
    expect(response.headers.get('content-security-policy')).toBe(
      `default-src 'self'; frame-ancestors 'self' ${ADMIN}`,
    );
  });

  it('skips injection for fragment responses without a <head> (server islands)', async () => {
    const middleware = createLivePreviewMiddleware({ defaults: 'v1' });
    const response = await middleware(preview(), () => Promise.resolve(htmlResponse('<p>x</p>')));
    const body = await response.text();
    expect(body).not.toContain('<script');
    expect(body).toBe('<p>x</p>');
  });

  it.each([[304], [204]])('passes a %d response through untouched', async (status) => {
    const middleware = createLivePreviewMiddleware({ defaults: 'v1', allowedOrigins: [ADMIN] });
    const original = new Response(null, { status, headers: { 'content-type': 'text/html' } });
    const response = await middleware(preview(), () => Promise.resolve(original));
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
  });

  it('drops content-encoding and etag with content-length after injecting', async () => {
    const middleware = createLivePreviewMiddleware({ defaults: 'v1' });
    const response = await middleware(preview(), () =>
      Promise.resolve(
        new Response('<html><head></head></html>', {
          headers: {
            'content-type': 'text/html',
            'content-length': '26',
            'content-encoding': 'br',
            etag: 'W/"1"',
          },
        }),
      ),
    );
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('etag')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('survives responses with immutable headers', async () => {
    const middleware = createLivePreviewMiddleware({
      defaults: 'v1',
      allowedOrigins: [ADMIN],
      autoInject: false,
    });
    const immutable = htmlResponse('<html><head></head></html>');
    const set = immutable.headers.set.bind(immutable.headers);
    vi.spyOn(immutable.headers, 'set').mockImplementation((name, value) => {
      if (name === 'content-security-policy') throw new TypeError('immutable');
      set(name, value);
    });
    const response = await middleware(preview(), () => Promise.resolve(immutable));
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
  });
});

describe('renderLivePreviewScript', () => {
  it('returns a complete <script> tag', () => {
    const html = renderLivePreviewScript({ allowedOrigins: [ADMIN] });
    // String comparison, not a pattern: the generator emits exactly this casing,
    // and a regex here reads like a tag filter that forgot about `<SCRIPT>`.
    expect(html.startsWith('<script>')).toBe(true);
    expect(html.endsWith('</script>')).toBe(true);
    expect(html).toContain('admin.example.com');
  });

  it('adds the nonce when provided', () => {
    expect(renderLivePreviewScript({ nonce: 'abc123' })).toContain('nonce="abc123"');
  });

  it('rejects malformed nonces', () => {
    expect(() => renderLivePreviewScript({ nonce: 'bad"injection' })).toThrow();
  });
});
