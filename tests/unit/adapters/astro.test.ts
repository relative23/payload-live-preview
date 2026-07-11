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
  /** A request that carries the `?preview=true` preview signal. */
  function makePreviewContext(): {
    request: Request;
    locals: Record<string, unknown>;
  } {
    return {
      request: new Request('https://example.com/page?preview=true'),
      locals: {},
    };
  }

  /** A plain production request without any preview signal. */
  function makePlainContext(): {
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
    const ctx = makePlainContext();
    await middleware(ctx, () => Promise.resolve(makeHtmlResponse('<html><head></head></html>')));
    expect(typeof ctx.locals[NONCE_LOCALS_KEY]).toBe('string');
    expect((ctx.locals[NONCE_LOCALS_KEY] as string).length).toBeGreaterThan(10);
  });

  it('leaves non-preview responses completely untouched', async () => {
    const middleware = createLivePreviewMiddleware({
      allowedOrigins: ['https://admin.example.com'],
    });
    const ctx = makePlainContext();
    const original = makeHtmlResponse('<html><head></head><body></body></html>');
    const response = await middleware(ctx, () => Promise.resolve(original));
    expect(response).toBe(original);
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect(await response.text()).not.toContain('<script');
  });

  it('injects the script into preview requests detected via query param', async () => {
    const middleware = createLivePreviewMiddleware({
      allowedOrigins: ['https://admin.example.com'],
    });
    const ctx = makePreviewContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head><title>x</title></head><body></body></html>')),
    );
    const body = await response.text();
    expect(body).toContain('<script nonce=');
    expect(body).toContain('admin.example.com');
    expect(body.indexOf('<script')).toBeLessThan(body.indexOf('<title>'));
  });

  it('injects when the request is an iframe load (Sec-Fetch-Dest)', async () => {
    const middleware = createLivePreviewMiddleware();
    const ctx = {
      request: new Request('https://example.com/page', {
        headers: { 'sec-fetch-dest': 'iframe' },
      }),
      locals: {} as Record<string, unknown>,
    };
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head><body></body></html>')),
    );
    expect(await response.text()).toContain('<script nonce=');
  });

  it('injects into every HTML response with inject: "always"', async () => {
    const middleware = createLivePreviewMiddleware({ inject: 'always' });
    const ctx = makePlainContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head><body></body></html>')),
    );
    expect(await response.text()).toContain('<script nonce=');
  });

  it('does not inject for non-HTML responses', async () => {
    const middleware = createLivePreviewMiddleware();
    const ctx = makePreviewContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(new Response('{"x":1}', { headers: { 'content-type': 'application/json' } })),
    );
    const body = await response.text();
    expect(body).toBe('{"x":1}');
  });

  it('honours autoInject: false', async () => {
    const middleware = createLivePreviewMiddleware({ autoInject: false });
    const ctx = makePreviewContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head></html>')),
    );
    expect(await response.text()).toBe('<html><head></head></html>');
  });

  it('honours shouldInject predicate', async () => {
    const middleware = createLivePreviewMiddleware({
      shouldInject: (req) => !new URL(req.url).pathname.endsWith('/excluded'),
    });
    const ctx = {
      request: new Request('https://example.com/excluded?preview=true'),
      locals: {} as Record<string, unknown>,
    };
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head></html>')),
    );
    expect(await response.text()).toBe('<html><head></head></html>');
  });

  it('skips prerendered contexts entirely (Astro 5 build-time middleware)', async () => {
    const middleware = createLivePreviewMiddleware();
    const ctx = { ...makePreviewContext(), isPrerendered: true };
    const original = makeHtmlResponse('<html><head></head></html>');
    const response = await middleware(ctx, () => Promise.resolve(original));
    expect(response).toBe(original);
    expect(await response.text()).not.toContain('<script');
  });

  it('manages only frame-ancestors by default (no script-src meddling)', async () => {
    const middleware = createLivePreviewMiddleware({
      allowedOrigins: ['https://admin.example.com'],
    });
    const ctx = makePreviewContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head></html>')),
    );
    const csp = response.headers.get('content-security-policy');
    expect(csp).toMatch(/frame-ancestors\s+'self' https:\/\/admin\.example\.com/);
    expect(csp).not.toMatch(/script-src/);
  });

  it('adds a nonce-based script-src with manageCsp: "full" (no strict-dynamic by default)', async () => {
    const middleware = createLivePreviewMiddleware({
      allowedOrigins: ['https://admin.example.com'],
      manageCsp: 'full',
    });
    const ctx = makePreviewContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head></html>')),
    );
    const csp = response.headers.get('content-security-policy')!;
    expect(csp).toMatch(/script-src\s+'self' 'nonce-[A-Za-z0-9_-]+'/);
    expect(csp).not.toContain("'strict-dynamic'");
  });

  it('adds strict-dynamic only when explicitly requested', async () => {
    const middleware = createLivePreviewMiddleware({
      manageCsp: 'full',
      strictDynamic: true,
    });
    const ctx = makePreviewContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head></html>')),
    );
    expect(response.headers.get('content-security-policy')).toContain("'strict-dynamic'");
  });

  it('merges with an existing CSP header without dropping or clobbering directives', async () => {
    const middleware = createLivePreviewMiddleware({
      allowedOrigins: ['https://admin.example.com'],
    });
    const ctx = makePreviewContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(
        new Response('<html><head></head></html>', {
          headers: {
            'content-type': 'text/html',
            'content-security-policy':
              "default-src 'self'; img-src https:; frame-ancestors https://other.example",
          },
        }),
      ),
    );
    const csp = response.headers.get('content-security-policy')!;
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/img-src https:/);
    // Union merge: the pre-existing frame-ancestors source survives.
    expect(csp).toContain('https://other.example');
    expect(csp).toContain('https://admin.example.com');
  });

  it('skips CSP when manageCsp is false', async () => {
    const middleware = createLivePreviewMiddleware({ manageCsp: false });
    const ctx = makePreviewContext();
    const response = await middleware(ctx, () =>
      Promise.resolve(makeHtmlResponse('<html><head></head></html>')),
    );
    expect(response.headers.get('content-security-policy')).toBeNull();
  });

  it('skips injection for fragment responses without a <head> (server islands)', async () => {
    const middleware = createLivePreviewMiddleware();
    const ctx = makePreviewContext();
    const response = await middleware(ctx, () => Promise.resolve(makeHtmlResponse('<p>x</p>')));
    const body = await response.text();
    expect(body).not.toContain('<script');
    expect(body).toBe('<p>x</p>');
  });

  it('survives responses with immutable headers', async () => {
    const middleware = createLivePreviewMiddleware({
      allowedOrigins: ['https://admin.example.com'],
      autoInject: false,
    });
    const ctx = makePreviewContext();
    const immutable = makeHtmlResponse('<html><head></head></html>');
    const set = immutable.headers.set.bind(immutable.headers);
    vi.spyOn(immutable.headers, 'set').mockImplementation((name, value) => {
      if (name === 'content-security-policy') throw new TypeError('immutable');
      set(name, value);
    });
    const response = await middleware(ctx, () => Promise.resolve(immutable));
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
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
