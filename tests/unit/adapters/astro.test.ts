/**
 * Astro adapter unit tests.
 *
 * The adapter is framework-agnostic enough that we can exercise the
 * integration, middleware, and component helpers via fake Astro types
 * — without booting an actual Astro project (that happens in the
 * end-to-end example in Phase 15).
 */
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  livePreview,
  createLivePreviewMiddleware,
  NONCE_LOCALS_KEY,
  renderLivePreviewScript,
} from '@adapters/astro/index';

function injectedConfig(script: string): unknown[] {
  const match = /var __LIVE_PREVIEW_CONFIG__=(\[[^;]*\]);/.exec(script);
  if (match?.[1] === undefined) throw new Error('injected config missing');
  const evaluated = runInNewContext(match[1], {}) as unknown;
  if (!Array.isArray(evaluated)) throw new Error('injected config is not an array');
  return evaluated;
}

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
    const config = injectedConfig(script);
    expect(config[4]).toBe(true);
    expect(config[5]).toBe(250);
    expect(config[7]).toBe(60_000);
  });

  it('forwards skipUnchanged into the trailing wire slot', () => {
    const injectScript = vi.fn();
    livePreview({ skipUnchanged: true }).hooks['astro:config:setup']({ injectScript });
    const config = injectedConfig(injectScript.mock.calls[0]![1] as string);
    expect(config[14]).toBe(true);
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

  it('skips prerendered contexts entirely (Astro 5 build-time middleware)', async () => {
    const middleware = createLivePreviewMiddleware();
    const ctx = { ...makePreviewContext(), isPrerendered: true };
    const original = makeHtmlResponse('<html><head></head></html>');
    const response = await middleware(ctx, () => Promise.resolve(original));
    expect(response).toBe(original);
    expect(await response.text()).not.toContain('<script');
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

  it('parses CSP ASCII whitespace and ignores duplicate directive relaxations', async () => {
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
              "default-src\t'self'; frame-ancestors 'none'; FRAME-ANCESTORS *",
          },
        }),
      ),
    );

    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'self'; frame-ancestors 'self' https://admin.example.com",
    );
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

describe('livePreview integration — middleware mode', () => {
  function makeSetupContext() {
    const injectScript = vi.fn();
    const addMiddleware = vi.fn();
    // Mirrors the integration's own shim: `resolveId`/`load` belong to the
    // middleware mode's virtual module, `configureServer` to the loader
    // mode's dev route, and no plugin carries all three.
    const plugins: {
      name: string;
      resolveId?: (id: string) => string | undefined;
      load?: (id: string) => string | undefined;
      configureServer?: (server: {
        middlewares: {
          use: (
            handler: (
              req: { url?: string | undefined },
              res: {
                statusCode: number;
                setHeader: (n: string, v: string) => void;
                end: (b?: string) => void;
              },
              next: () => void,
            ) => void,
          ) => void;
        };
      }) => void;
    }[] = [];
    const updateConfig = vi.fn((config: { vite?: { plugins?: typeof plugins } }) => {
      plugins.push(...(config.vite?.plugins ?? []));
    });
    return { injectScript, addMiddleware, updateConfig, plugins };
  }

  it('registers the middleware entrypoint and serves options via the virtual module', () => {
    const ctx = makeSetupContext();
    const integration = livePreview({
      mode: 'middleware',
      allowedOrigins: ['https://admin.example.com'],
      serverURL: 'https://admin.example.com',
    });
    integration.hooks['astro:config:setup'](ctx);

    expect(ctx.injectScript).not.toHaveBeenCalled();
    expect(ctx.addMiddleware).toHaveBeenCalledWith({
      entrypoint: 'payload-live-preview/astro/middleware-entry',
      order: 'pre',
    });

    const plugin = ctx.plugins[0]!;
    const resolved = plugin.resolveId!('virtual:payload-live-preview/options')!;
    const moduleSource = plugin.load!(resolved)!;
    expect(moduleSource).toContain('https://admin.example.com');
    expect(moduleSource).toMatch(/^export default \{/);
    // The mode marker itself must not leak into the middleware options.
    expect(moduleSource).not.toContain('"mode"');
  });

  it('rejects shouldInject in middleware mode (not serializable)', () => {
    const ctx = makeSetupContext();
    const integration = livePreview({ mode: 'middleware', shouldInject: () => true });
    expect(() => {
      integration.hooks['astro:config:setup'](ctx);
    }).toThrow(/shouldInject/);
  });

  it('escapes </script>-breaking sequences in the serialized options', () => {
    const ctx = makeSetupContext();
    const integration = livePreview({
      mode: 'middleware',
      previewQueryParams: ['x</script><script>'],
    });
    integration.hooks['astro:config:setup'](ctx);
    const plugin = ctx.plugins[0]!;
    const source = plugin.load!(plugin.resolveId!('virtual:payload-live-preview/options')!)!;
    expect(source).not.toContain('</script>');
  });
});

describe('livePreview integration — loader mode', () => {
  function makeLoaderContext(base?: string) {
    const injectScript = vi.fn();
    const plugins: {
      name: string;
      generateBundle?: (this: {
        emitFile: (file: { type: 'asset'; fileName: string; source: string }) => void;
      }) => void;
      configureServer?: (server: {
        middlewares: {
          use: (
            handler: (
              req: { url?: string | undefined },
              res: {
                statusCode: number;
                setHeader: (n: string, v: string) => void;
                end: (b?: string) => void;
              },
              next: () => void,
            ) => void,
          ) => void;
        };
      }) => void;
    }[] = [];
    const updateConfig = vi.fn((config: { vite?: { plugins?: typeof plugins } }) => {
      plugins.push(...(config.vite?.plugins ?? []));
    });
    return {
      injectScript,
      updateConfig,
      plugins,
      ...(base === undefined ? {} : { config: { base } }),
    };
  }

  /** Drive the dev-server plugin and capture what it answers for one URL. */
  function requestFromDevServer(
    plugin: { configureServer?: (server: never) => void },
    url: string,
  ): { handled: boolean; status?: number; headers: Record<string, string>; body?: string } {
    const headers: Record<string, string> = {};
    let handled = false;
    let status: number | undefined;
    let body: string | undefined;
    const server = {
      middlewares: {
        use(handler: (req: unknown, res: unknown, next: () => void) => void) {
          handler(
            { url },
            {
              set statusCode(value: number) {
                status = value;
              },
              setHeader(name: string, value: string) {
                headers[name] = value;
              },
              end(chunk?: string) {
                handled = true;
                body = chunk;
              },
            },
            () => {
              handled = false;
            },
          );
        },
      },
    };
    plugin.configureServer?.(server as never);
    return {
      handled,
      ...(status === undefined ? {} : { status }),
      headers,
      ...(body === undefined ? {} : { body }),
    };
  }

  it('injects the bootstrap instead of the runtime', () => {
    const ctx = makeLoaderContext();
    livePreview({ mode: 'loader', allowedOrigins: ['https://admin.example.com'] }).hooks[
      'astro:config:setup'
    ](ctx);

    const injected = ctx.injectScript.mock.calls[0]?.[1] as string;
    expect(ctx.injectScript).toHaveBeenCalledTimes(1);
    expect(injected).toContain('https://admin.example.com');
    expect(injected).toContain('integrity');
    // The saving only exists if the runtime body stays out of the page.
    expect(injected).not.toContain('MutationObserver');
    expect(injected.length).toBeLessThan(2000);
  });

  it('points the bootstrap at a content-hashed path with an SRI hash', () => {
    const ctx = makeLoaderContext();
    livePreview({ mode: 'loader' }).hooks['astro:config:setup'](ctx);
    const injected = ctx.injectScript.mock.calls[0]?.[1] as string;

    expect(injected).toMatch(/_payload-live-preview\/runtime\.[0-9a-f]{16}\.js/u);
    expect(injected).toMatch(/sha384-[A-Za-z0-9+/=]+/u);
  });

  it('honours Astro base so a site under a subpath still finds the asset', () => {
    const ctx = makeLoaderContext('/docs/');
    livePreview({ mode: 'loader' }).hooks['astro:config:setup'](ctx);
    const injected = ctx.injectScript.mock.calls[0]?.[1] as string;
    expect(injected).toContain('/docs/_payload-live-preview/runtime.');
  });

  it('serves the runtime during astro dev from the same path it will be built to', () => {
    const ctx = makeLoaderContext();
    livePreview({ mode: 'loader' }).hooks['astro:config:setup'](ctx);
    const injected = ctx.injectScript.mock.calls[0]?.[1] as string;
    const urlPath = /"(\/_payload-live-preview\/runtime\.[0-9a-f]{16}\.js)"/u.exec(injected)?.[1];
    expect(urlPath).toBeDefined();

    const answer = requestFromDevServer(ctx.plugins[0]!, urlPath!);
    expect(answer.handled).toBe(true);
    expect(answer.status).toBe(200);
    expect(answer.headers['Content-Type']).toContain('javascript');
    expect(answer.body).toContain('MutationObserver');
  });

  it('ignores a query string so a cache-busting reload still resolves', () => {
    const ctx = makeLoaderContext();
    livePreview({ mode: 'loader' }).hooks['astro:config:setup'](ctx);
    const injected = ctx.injectScript.mock.calls[0]?.[1] as string;
    const urlPath = /"(\/_payload-live-preview\/runtime\.[0-9a-f]{16}\.js)"/u.exec(injected)?.[1];

    expect(requestFromDevServer(ctx.plugins[0]!, `${urlPath!}?v=2`).handled).toBe(true);
  });

  it('passes every other request through untouched', () => {
    const ctx = makeLoaderContext();
    livePreview({ mode: 'loader' }).hooks['astro:config:setup'](ctx);
    expect(requestFromDevServer(ctx.plugins[0]!, '/index.html').handled).toBe(false);
  });

  it('does nothing at all when autoInject is off', () => {
    const ctx = makeLoaderContext();
    livePreview({ mode: 'loader', autoInject: false }).hooks['astro:config:setup'](ctx);
    expect(ctx.injectScript).not.toHaveBeenCalled();
    expect(ctx.plugins).toEqual([]);
  });

  it('emits the asset into the build output at the injected path', () => {
    const ctx = makeLoaderContext();
    livePreview({ mode: 'loader' }).hooks['astro:config:setup'](ctx);
    const injected = ctx.injectScript.mock.calls[0]?.[1] as string;
    const urlPath = /"(\/_payload-live-preview\/runtime\.[0-9a-f]{16}\.js)"/u.exec(injected)?.[1];

    const emitted: { fileName: string; source: string }[] = [];
    ctx.plugins[0]!.generateBundle?.call({
      emitFile: (file) => emitted.push({ fileName: file.fileName, source: file.source }),
    });

    // The bootstrap requests exactly this path. If the two ever disagree the
    // preview 404s in production and nowhere else.
    expect(emitted).toHaveLength(1);
    expect(`/${emitted[0]!.fileName}`).toBe(urlPath);
    expect(emitted[0]!.source).toContain('MutationObserver');
  });

  it('refuses loudly when Astro cannot publish the asset', () => {
    // Without updateConfig there is no Vite plugin, so nothing emits the asset
    // and nothing serves it — while the bootstrap is injected anyway and points
    // at a URL that 404s. Ordinary pages look fine and only the preview stays
    // dead, with no message anywhere. Middleware mode already refuses this.
    expect(() =>
      livePreview({ mode: 'loader' }).hooks['astro:config:setup']({
        injectScript: vi.fn(),
      }),
    ).toThrow(/updateConfig/u);
  });

  it.each([
    ['/', '/_payload-live-preview/'],
    ['', '/_payload-live-preview/'],
    ['/docs/', '/docs/_payload-live-preview/'],
    ['/docs', '/docs/_payload-live-preview/'],
    ['docs', '/docs/_payload-live-preview/'],
    ['//docs//', '/docs/_payload-live-preview/'],
    ['/a/b/', '/a/b/_payload-live-preview/'],
  ])('normalises base %j to %j', (base, expected) => {
    // A wrong URL here is a 404 nobody sees: the page renders, the preview
    // simply never wakes up.
    const ctx = makeLoaderContext(base);
    livePreview({ mode: 'loader' }).hooks['astro:config:setup'](ctx);
    expect(ctx.injectScript.mock.calls[0]?.[1] as string).toContain(expected);
  });

  it('registers no asset plugin in the default inline mode', () => {
    // The emitter is armed only by loader mode; an inline build must not grow
    // a second copy of the runtime beside the one already in its pages.
    const ctx = makeLoaderContext();
    livePreview({}).hooks['astro:config:setup'](ctx);
    expect(ctx.plugins).toEqual([]);
  });
});
