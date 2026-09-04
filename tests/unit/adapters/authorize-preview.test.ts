import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLivePreviewMiddleware as nextMiddleware } from '@adapters/nextjs/adapter';
import { livePreviewHandle } from '@adapters/sveltekit/adapter';
import { livePreviewNitroPlugin } from '@adapters/nuxt/adapter';
import { createLivePreviewMiddleware as astroMiddleware } from '@adapters/astro/middleware';
import { resetDevWarnings } from '@adapters/shared/dev-warning';
import {
  authorizePreviewRequest,
  PreviewConfigurationError,
  type AuthorizedPreviewContext,
} from '@security/preview-authorization';

/** ADR 0006 gate, per adapter: nothing changes after authorization returns false. */

const ADMIN = 'https://admin.example.com';
const PAGE = '<html><head></head><body>hi</body></html>';
const INTENT = 'https://site.example.com/page?preview=true';

let context: AuthorizedPreviewContext;
const refuse = vi.fn(() => null);
const allow = vi.fn(() => context);

beforeEach(async () => {
  process.env['NODE_ENV'] = 'development';
  resetDevWarnings();
  refuse.mockClear();
  allow.mockClear();
  const result = await authorizePreviewRequest(new Request(INTENT), {
    type: 'verifier',
    verify: () => ({ subject: 'editor' }),
  });
  if (!result.authorized) throw new Error('expected authorization');
  context = result.context;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Next.js', () => {
  const html = () =>
    new Response(PAGE, { headers: { 'content-type': 'text/html', 'x-marker': 'untouched' } });

  it('leaves a refused preview byte-identical and header-identical', async () => {
    const middleware = nextMiddleware({ allowedOrigins: [ADMIN], authorizePreview: refuse });
    const response = await middleware(new Request(INTENT), html());
    expect(await response.text()).toBe(PAGE);
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect(response.headers.get('cache-control')).toBeNull();
    expect(refuse).toHaveBeenCalledOnce();
  });

  it('injects and sets CSP once authorized, with one nonce for tag and header', async () => {
    const middleware = nextMiddleware({
      allowedOrigins: [ADMIN],
      authorizePreview: allow,
      manageCsp: 'full',
    });
    const response = await middleware(new Request(INTENT), html());
    const body = await response.text();
    const nonce = /nonce="([^"]+)"/u.exec(body)?.[1];
    expect(body).toContain('__LIVE_PREVIEW_CONFIG__');
    expect(response.headers.get('content-security-policy')).toContain(`'nonce-${String(nonce)}'`);
    expect(response.headers.get('x-live-preview-nonce')).toBeNull();
  });

  it('never calls the hook for a request without intent', async () => {
    const middleware = nextMiddleware({ allowedOrigins: [ADMIN], authorizePreview: refuse });
    await middleware(new Request('https://site.example.com/'), html());
    expect(refuse).not.toHaveBeenCalled();
  });
});

describe('SvelteKit', () => {
  function resolve() {
    return vi.fn(
      async (
        _event: unknown,
        opts: {
          transformPageChunk?: (c: { html: string; done: boolean }) => string | undefined;
        } = {},
      ) => {
        const transformed = opts.transformPageChunk?.({ html: PAGE, done: true });
        const body = opts.transformPageChunk === undefined ? PAGE : (transformed ?? '');
        return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/html' } }));
      },
    );
  }

  it('leaves a refused preview untouched and withholds the nonce from locals', async () => {
    const handle = livePreviewHandle({ allowedOrigins: [ADMIN], authorizePreview: refuse });
    const event = { request: new Request(INTENT), locals: {} as Record<string, unknown> };
    const response = await handle({ event, resolve: resolve() });
    expect(await response.text()).toBe(PAGE);
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect(event.locals['livePreviewNonce']).toBeUndefined();
    expect(event.locals['livePreviewAuthorizationOutcome']).toBe('invalid');
  });

  it('injects, sets CSP and exposes the nonce once authorized', async () => {
    const handle = livePreviewHandle({ allowedOrigins: [ADMIN], authorizePreview: allow });
    const event = { request: new Request(INTENT), locals: {} as Record<string, unknown> };
    const response = await handle({ event, resolve: resolve() });
    const body = await response.text();
    expect(body).toContain('__LIVE_PREVIEW_CONFIG__');
    expect(body).toContain(`nonce="${String(event.locals['livePreviewNonce'])}"`);
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
    expect(event.locals['livePreviewAuthorization']).toBe(context);
    expect(event.locals['livePreviewAuthorizationOutcome']).toBe('authorized');
  });

  it('still exposes the nonce to ordinary requests, which never asked for a preview', async () => {
    const handle = livePreviewHandle({ allowedOrigins: [ADMIN], authorizePreview: refuse });
    const event = {
      request: new Request('https://site.example.com/'),
      locals: {} as Record<string, unknown>,
    };
    await handle({ event, resolve: resolve() });
    expect(typeof event.locals['livePreviewNonce']).toBe('string');
    expect(event.locals['livePreviewAuthorizationOutcome']).toBeUndefined();
    expect(refuse).not.toHaveBeenCalled();
  });
});

describe('Astro', () => {
  const next = () =>
    Promise.resolve(new Response(PAGE, { headers: { 'content-type': 'text/html' } }));

  it('leaves a refused preview untouched and withholds the nonce from locals', async () => {
    const middleware = astroMiddleware({ allowedOrigins: [ADMIN], authorizePreview: refuse });
    const locals: Record<string, unknown> = {};
    const response = await middleware({ request: new Request(INTENT), locals }, next);
    expect(await response.text()).toBe(PAGE);
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect(locals['livePreviewNonce']).toBeUndefined();
    expect(locals['livePreviewAuthorization']).toBeUndefined();
    expect(locals['livePreviewAuthorizationOutcome']).toBe('invalid');
  });

  it('decides before rendering, so the page sees the nonce it is injected with', async () => {
    const middleware = astroMiddleware({ allowedOrigins: [ADMIN], authorizePreview: allow });
    const locals: Record<string, unknown> = {};
    let nonceDuringRender: unknown;
    const response = await middleware({ request: new Request(INTENT), locals }, () => {
      nonceDuringRender = locals['livePreviewNonce'];
      return next();
    });
    expect(typeof nonceDuringRender).toBe('string');
    expect(await response.text()).toContain(`nonce="${String(nonceDuringRender)}"`);
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
    expect(locals['livePreviewAuthorization']).toBe(context);
  });

  it('does not consult the hook while prerendering', async () => {
    const middleware = astroMiddleware({ allowedOrigins: [ADMIN], authorizePreview: refuse });
    const locals: Record<string, unknown> = {};
    await middleware({ request: new Request(INTENT), locals, isPrerendered: true }, next);
    expect(refuse).not.toHaveBeenCalled();
    expect(typeof locals['livePreviewNonce']).toBe('string');
  });

  it('re-throws a strategy configuration error instead of serving the page as refused', async () => {
    const middleware = astroMiddleware({
      allowedOrigins: [ADMIN],
      authorizePreview: (request) =>
        authorizePreviewRequest(request, {
          type: 'signed-token',
          secret: 'short',
          audience: 'https://site.example.com',
        }),
    });
    await expect(middleware({ request: new Request(INTENT), locals: {} }, next)).rejects.toThrow(
      PreviewConfigurationError,
    );
  });
});

describe('Nuxt', () => {
  function nitro() {
    let hook:
      ((h: { head: string[] }, c: { event: FakeEvent }) => void | Promise<void>) | undefined;
    return {
      app: {
        hooks: {
          hook(_name: 'render:html', fn: NonNullable<typeof hook>) {
            hook = fn;
          },
        },
      },
      async render(event: FakeEvent) {
        const head: string[] = [];
        await hook?.({ head }, { event });
        return head;
      },
    };
  }
  interface FakeEvent {
    readonly path: string;
    readonly context: Record<string, unknown>;
    readonly node: {
      readonly req: { readonly url: string; readonly headers: Record<string, string> };
      readonly res: {
        getHeader: (name: string) => string | undefined;
        setHeader: (name: string, value: string) => void;
      };
    };
  }
  function event(path = '/page?preview=true') {
    const headers: Record<string, string> = {};
    return {
      event: {
        path,
        context: {} as Record<string, unknown>,
        node: {
          req: { url: path, headers: { host: 'site.example.com' } },
          res: {
            getHeader: (name: string) => headers[name],
            setHeader: (name: string, value: string) => {
              headers[name] = value;
            },
          },
        },
      },
      headers,
    };
  }

  it('leaves a refused preview without script, CSP, or a context nonce', async () => {
    const app = nitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN], authorizePreview: refuse })(app.app);
    const { event: ev, headers } = event();
    const head = await app.render(ev);
    expect(head).toEqual([]);
    expect(headers['content-security-policy']).toBeUndefined();
    expect(ev.context['livePreviewNonce']).toBeUndefined();
    expect(ev.context['livePreviewAuthorizationOutcome']).toBe('invalid');
    expect(refuse).toHaveBeenCalledOnce();
  });

  it('injects, sets CSP and exposes the nonce once authorized', async () => {
    const app = nitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN], authorizePreview: allow })(app.app);
    const { event: ev, headers } = event();
    const head = await app.render(ev);
    expect(head).toHaveLength(1);
    expect(head[0]).toContain(`nonce="${String(ev.context['livePreviewNonce'])}"`);
    expect(headers['content-security-policy']).toContain('frame-ancestors');
    expect(ev.context['livePreviewAuthorization']).toBe(context);
  });

  it('hands the hook the same request shape the intent check saw', async () => {
    const seen = vi.fn<(request: { readonly url: string }) => null>(() => null);
    const app = nitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN], authorizePreview: seen })(app.app);
    await app.render(event().event);
    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0]?.[0].url).toBe('http://site.example.com/page?preview=true');
  });
});
