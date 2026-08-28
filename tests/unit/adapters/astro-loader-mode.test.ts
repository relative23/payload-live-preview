import { describe, expect, it, vi } from 'vitest';
import { livePreview } from '@adapters/astro/index';

/** Loader mode: a bootstrap in the page, the runtime as a hashed asset served identically in dev and build. */

const ADMIN = 'https://admin.example.com';
const RUNTIME_PATH = /"(\/_payload-live-preview\/runtime\.[0-9a-f]{16}\.js)"/u;

type DevHandler = (
  req: { url?: string | undefined },
  res: { statusCode: number; setHeader: (n: string, v: string) => void; end: (b?: string) => void },
  next: () => void,
) => void;

interface LoaderPlugin {
  name: string;
  generateBundle?: (this: {
    emitFile: (file: { type: 'asset'; fileName: string; source: string }) => void;
  }) => void;
  configureServer?: (server: { middlewares: { use: (handler: DevHandler) => void } }) => void;
}

function makeLoaderContext(base?: string) {
  const injectScript = vi.fn();
  const plugins: LoaderPlugin[] = [];
  const updateConfig = vi.fn((config: { vite?: { plugins?: LoaderPlugin[] } }) => {
    plugins.push(...(config.vite?.plugins ?? []));
  });
  return {
    injectScript,
    updateConfig,
    plugins,
    ...(base === undefined ? {} : { config: { base } }),
  };
}

function setup(options: Parameters<typeof livePreview>[0], base?: string) {
  const ctx = makeLoaderContext(base);
  livePreview({ defaults: 'v1', mode: 'loader', ...options }).hooks['astro:config:setup'](ctx);
  const injected = (ctx.injectScript.mock.calls[0]?.[1] as string | undefined) ?? '';
  return { ctx, injected, urlPath: RUNTIME_PATH.exec(injected)?.[1] };
}

/** Drive the dev-server plugin and capture what it answers for one URL. */
function requestFromDevServer(plugin: LoaderPlugin, url: string) {
  const headers: Record<string, string> = {};
  let handled = false;
  let status: number | undefined;
  let body: string | undefined;
  plugin.configureServer?.({
    middlewares: {
      use(handler) {
        handler(
          { url },
          {
            set statusCode(value: number) {
              status = value;
            },
            setHeader(name, value) {
              headers[name] = value;
            },
            end(chunk) {
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
  });
  return { handled, status, headers, body };
}

describe('livePreview integration — loader mode', () => {
  it('injects the bootstrap instead of the runtime', () => {
    const { ctx, injected } = setup({ allowedOrigins: [ADMIN] });
    expect(ctx.injectScript).toHaveBeenCalledTimes(1);
    expect(injected).toContain(ADMIN);
    expect(injected).toContain('integrity');
    expect(injected).not.toContain('MutationObserver');
    expect(injected.length).toBeLessThan(2000);
  });

  it('points the bootstrap at a content-hashed path with an SRI hash', () => {
    const { injected } = setup({});
    expect(injected).toMatch(/_payload-live-preview\/runtime\.[0-9a-f]{16}\.js/u);
    expect(injected).toMatch(/sha384-[A-Za-z0-9+/=]+/u);
  });

  it('honours Astro base so a site under a subpath still finds the asset', () => {
    expect(setup({}, '/docs/').injected).toContain('/docs/_payload-live-preview/runtime.');
  });

  it('serves the runtime during astro dev from the same path it will be built to', () => {
    const { ctx, urlPath } = setup({});
    expect(urlPath).toBeDefined();
    const answer = requestFromDevServer(ctx.plugins[0]!, urlPath!);
    expect(answer.handled).toBe(true);
    expect(answer.status).toBe(200);
    expect(answer.headers['Content-Type']).toContain('javascript');
    expect(answer.body).toContain('MutationObserver');
  });

  it('ignores a query string so a cache-busting reload still resolves', () => {
    const { ctx, urlPath } = setup({});
    expect(requestFromDevServer(ctx.plugins[0]!, `${urlPath!}?v=2`).handled).toBe(true);
  });

  it('passes every other request through untouched', () => {
    const { ctx } = setup({});
    expect(requestFromDevServer(ctx.plugins[0]!, '/index.html').handled).toBe(false);
  });

  it('does nothing at all when autoInject is off', () => {
    const { ctx } = setup({ autoInject: false });
    expect(ctx.injectScript).not.toHaveBeenCalled();
    expect(ctx.plugins).toEqual([]);
  });

  it('emits the asset into the build output at the injected path', () => {
    const { ctx, urlPath } = setup({});
    const emitted: { fileName: string; source: string }[] = [];
    ctx.plugins[0]!.generateBundle?.call({
      emitFile: (file) => emitted.push({ fileName: file.fileName, source: file.source }),
    });
    expect(emitted).toHaveLength(1);
    expect(`/${emitted[0]!.fileName}`).toBe(urlPath);
    expect(emitted[0]!.source).toContain('MutationObserver');
  });

  it('refuses loudly when Astro cannot publish the asset', () => {
    // Without updateConfig the bootstrap would point at a URL that 404s only in a preview.
    expect(() =>
      livePreview({ defaults: 'v1', mode: 'loader' }).hooks['astro:config:setup']({
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
    expect(setup({}, base).injected).toContain(expected);
  });

  it('registers no asset plugin in the default inline mode', () => {
    const ctx = makeLoaderContext();
    livePreview({ defaults: 'v1' }).hooks['astro:config:setup'](ctx);
    expect(ctx.plugins).toEqual([]);
  });
});
