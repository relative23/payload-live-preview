/**
 * Astro adapter unit tests.
 *
 * The adapter is framework-agnostic enough that we can exercise the
 * integration, middleware, and component helpers via fake Astro types
 * — without booting an actual Astro project (that happens in the
 * end-to-end example in Phase 15).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  livePreview,
  createLivePreviewMiddleware,
  NONCE_LOCALS_KEY,
  renderLivePreviewScript,
} from '@adapters/astro/index';

describe('livePreview integration', () => {
  it('returns an integration with the expected name', () => {
    const integration = livePreview();
    expect(integration.name).toBe('payload-live-preview');
  });

  it('injects the script via head-inline by default', () => {
    const injectScript = vi.fn();
    const integration = livePreview({ allowedOrigins: ['https://admin.example.com'] });
    integration.hooks['astro:config:setup']({ injectScript });
    expect(injectScript).toHaveBeenCalledOnce();
    const call = injectScript.mock.calls[0]!;
    const stage = call[0] as string;
    const script = call[1] as string;
    expect(stage).toBe('head-inline');
    expect(script).toContain('admin.example.com');
  });

  it('honours autoInject: false', () => {
    const injectScript = vi.fn();
    const integration = livePreview({ autoInject: false });
    integration.hooks['astro:config:setup']({ injectScript });
    expect(injectScript).not.toHaveBeenCalled();
  });

  it('forwards debounce, heartbeat, and debug options into the injected script', () => {
    const injectScript = vi.fn();
    const integration = livePreview({
      debug: true,
      debounceMs: 250,
      heartbeatMs: 60_000,
    });
    integration.hooks['astro:config:setup']({ injectScript });
    const script = injectScript.mock.calls[0]![1] as string;
    expect(script).toContain('"debug":true');
    expect(script).toContain('"debounceMs":250');
    expect(script).toContain('"heartbeatMs":60000');
  });
});

describe('createLivePreviewMiddleware', () => {
  function makeContext(): {
    request: Request;
    locals: Record<string, unknown>;
  } {
    return {
      request: new Request('https://example.com/page'),
      locals: {},
    };
  }

  function makeHtmlResponse(html: string, status = 200): Response {
    return new Response(html, {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  it('writes a nonce to locals on every request', async () => {
    const middleware = createLivePreviewMiddleware();
    const ctx = makeContext();
    await middleware(ctx, () => Promise.resolve(makeHtmlResponse('<html><head></head></html>')));
    expect(typeof ctx.locals[NONCE_LOCALS_KEY]).toBe('string');
    expect((ctx.locals[NONCE_LOCALS_KEY] as string).length).toBeGreaterThan(10);
  });

  it('injects the live preview script into the <head> of HTML responses', async () => {
    const middleware = createLivePreviewMiddleware({
      allowedOrigins: ['https://admin.example.com'],
    });
    const ctx = makeContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head><title>x</title></head><body></body></html>')),
    );
    const body = await response.text();
    expect(body).toContain('<script nonce=');
    expect(body).toContain('admin.example.com');
    expect(body.indexOf('<script')).toBeLessThan(body.indexOf('<title>'));
  });

  it('does not inject for non-HTML responses', async () => {
    const middleware = createLivePreviewMiddleware();
    const ctx = makeContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(new Response('{"x":1}', { headers: { 'content-type': 'application/json' } })),
    );
    const body = await response.text();
    expect(body).toBe('{"x":1}');
  });

  it('honours autoInject: false', async () => {
    const middleware = createLivePreviewMiddleware({ autoInject: false });
    const ctx = makeContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head></html>')),
    );
    expect(await response.text()).toBe('<html><head></head></html>');
  });

  it('honours shouldInject predicate', async () => {
    const middleware = createLivePreviewMiddleware({
      shouldInject: (req) => !req.url.endsWith('/excluded'),
    });
    const ctx = {
      request: new Request('https://example.com/excluded'),
      locals: {} as Record<string, unknown>,
    };
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head></html>')),
    );
    expect(await response.text()).toBe('<html><head></head></html>');
  });

  it('sets Content-Security-Policy with frame-ancestors and script-src', async () => {
    const middleware = createLivePreviewMiddleware({
      allowedOrigins: ['https://admin.example.com'],
    });
    const ctx = makeContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head></html>')),
    );
    const csp = response.headers.get('content-security-policy');
    expect(csp).toMatch(/frame-ancestors\s+'self' https:\/\/admin\.example\.com/);
    expect(csp).toMatch(/script-src\s+'self' 'nonce-[A-Za-z0-9_-]+' 'strict-dynamic'/);
  });

  it('merges with an existing CSP header without dropping unrelated directives', async () => {
    const middleware = createLivePreviewMiddleware({
      allowedOrigins: ['https://admin.example.com'],
    });
    const ctx = makeContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(
        new Response('<html><head></head></html>', {
          headers: {
            'content-type': 'text/html',
            'content-security-policy': "default-src 'self'; img-src https:",
          },
        }),
      ),
    );
    const csp = response.headers.get('content-security-policy')!;
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/img-src https:/);
    expect(csp).toMatch(/frame-ancestors/);
    expect(csp).toMatch(/script-src/);
  });

  it('skips CSP when manageCsp is false', async () => {
    const middleware = createLivePreviewMiddleware({ manageCsp: false });
    const ctx = makeContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head></html>')),
    );
    expect(response.headers.get('content-security-policy')).toBeNull();
  });

  it('falls back to prepending the script when <head> is absent', async () => {
    const middleware = createLivePreviewMiddleware();
    const ctx = makeContext();
    const response = await middleware(ctx, () => Promise.resolve(makeHtmlResponse('<p>x</p>')));
    const body = await response.text();
    expect(body.startsWith('<script')).toBe(true);
  });
});

describe('renderLivePreviewScript', () => {
  it('returns a complete <script> tag', () => {
    const html = renderLivePreviewScript({ allowedOrigins: ['https://admin.example.com'] });
    expect(html).toMatch(/^<script>/);
    expect(html).toMatch(/<\/script>$/);
    expect(html).toContain('admin.example.com');
  });

  it('adds the nonce when provided', () => {
    const html = renderLivePreviewScript({ nonce: 'abc123' });
    expect(html).toContain('nonce="abc123"');
  });

  it('rejects malformed nonces', () => {
    expect(() => renderLivePreviewScript({ nonce: 'bad"injection' })).toThrow();
  });
});
