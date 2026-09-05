import { describe, expect, it, vi } from 'vitest';
import {
  buildLivePreviewCsp,
  DECISION_CONTEXT_KEY,
  defineLivePreviewServerHandler,
  livePreviewNitroPlugin,
  renderLivePreviewScript,
} from '@adapters/nuxt/index';
import { createPreviewPolicy } from '@adapters/shared/policy';
import { withCspHeader } from '@adapters/shared/response';
import { authorizePreviewRequest } from '@security/preview-authorization';
import type { AuthorizedPreviewContext } from '@/types/authorized-preview';

const ADMIN = 'https://admin.example.com';

async function authorizedContext(): Promise<AuthorizedPreviewContext> {
  const result = await authorizePreviewRequest(
    new Request('https://site.example.com/page?preview=true'),
    { type: 'verifier', verify: () => ({ subject: 'editor' }) },
  );
  if (!result.authorized) throw new Error('expected authorization');
  return result.context;
}

interface FakeEvent {
  path?: string;
  headers?: Headers;
  node?: {
    req?: { url?: string; headers?: Record<string, string | string[] | undefined> };
    res?: {
      getHeader?: (name: string) => string | string[] | undefined;
      setHeader?: (name: string, value: string) => void;
    };
  };
  res?: { headers: Headers };
  context?: Record<string, unknown>;
}

/** A Nitro app that captures the `render:html` hook so a test can fire it. */
function fakeNitro() {
  let hook:
    ((html: { head: string[] }, ctx: { event: FakeEvent }) => void | Promise<void>) | undefined;
  return {
    app: {
      hooks: {
        hook(
          _name: 'render:html',
          fn: (h: { head: string[] }, c: { event: FakeEvent }) => void | Promise<void>,
        ) {
          hook = fn;
        },
      },
    },
    async render(event: FakeEvent): Promise<string[]> {
      const head: string[] = [];
      await hook?.({ head }, { event });
      return head;
    },
  };
}

function event(
  url = '/',
  headers: Record<string, string | string[] | undefined> = {},
  written: Record<string, string | string[]> = {},
): FakeEvent {
  return {
    path: url,
    context: {},
    node: {
      req: { url, headers },
      res: {
        getHeader: (name) => written[name.toLowerCase()],
        setHeader: (name, value) => {
          written[name.toLowerCase()] = value;
        },
      },
    },
  };
}

describe('livePreviewNitroPlugin — CSP', () => {
  it('detects intent when Nitro reports a relative event.url', async () => {
    // Nitro sets `event.url` to a path on some versions. A relative URL cannot
    // be parsed, so every query signal silently missed and nothing injected.
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN], defaults: 'v1' })(nitro.app);
    const relative = { ...event('/reveal?preview=true'), url: '/reveal?preview=true' };
    const head = await nitro.render(relative);
    expect(head.join('')).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('still injects, without throwing, when the event exposes no response object', async () => {
    // A prerender pass renders without a node response; failing the build over
    // a header nobody can set would be wrong, and so would skipping injection.
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ defaults: 'v1', inject: 'always', allowedOrigins: [ADMIN] })(
      nitro.app,
    );
    const head = await nitro.render({ path: '/', context: {} });
    expect(head).toHaveLength(1);
    expect(head[0]).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('calls the Node response methods on the response, never detached', async () => {
    // Node's ServerResponse.setHeader reads `this._header`; invoking it unbound
    // throws only against a real server, which no fake object reproduces.
    class Res {
      readonly written = new Map<string, string>();
      #self: Res | undefined = undefined;
      setHeader(name: string, value: string): void {
        this.#self = this;
        this.written.set(name.toLowerCase(), value);
      }
      getHeader(name: string): string | undefined {
        return this.written.get(name.toLowerCase());
      }
      get boundCorrectly(): boolean {
        return this.#self === this;
      }
    }
    const res = new Res();
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ defaults: 'v1', allowedOrigins: [ADMIN] })(nitro.app);
    await nitro.render({
      path: '/?preview=true',
      context: {},
      node: { req: { url: '/?preview=true', headers: {} }, res: res },
    });
    expect(res.boundCorrectly).toBe(true);
    expect(res.getHeader('content-security-policy')).toContain('frame-ancestors');
  });

  it('joins an array-valued CSP header (several headers) and widens every policy', async () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ defaults: 'v1', allowedOrigins: [ADMIN] })(nitro.app);
    const written: Record<string, string | string[]> = {
      'content-security-policy': ["frame-ancestors 'none'", "default-src 'self'"],
    };
    await nitro.render(event('/?preview=true', {}, written));
    expect(written['content-security-policy']).toBe(
      `frame-ancestors 'self' ${ADMIN}, default-src 'self'; frame-ancestors 'self' ${ADMIN}`,
    );
  });

  it('reads headers and writes CSP and cache headers on a web-shaped (edge) event', async () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ defaults: 'v1', allowedOrigins: [ADMIN] })(nitro.app);
    const res = { headers: new Headers({ 'content-security-policy': "default-src 'self'" }) };
    const ev: FakeEvent = {
      path: '/page',
      headers: new Headers({ host: 'site.example.com', 'sec-fetch-dest': 'iframe' }),
      res,
      context: {},
    };
    const head = await nitro.render(ev);
    expect(head).toHaveLength(1);
    expect(res.headers.get('content-security-policy')).toBe(
      `default-src 'self'; frame-ancestors 'self' ${ADMIN}`,
    );
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('vary')).toBe('Cookie');
  });
});

describe('livePreviewNitroPlugin — the header side agrees with withCspHeader', () => {
  // Characterisation: the Nitro sink and the fetch-style sink share
  // applyCspHeaders(), so for one decision and nonce both write the same
  // CSP and cache headers, whatever the response already carried.
  const HEADERS = ['content-security-policy', 'cache-control', 'vary'] as const;
  const rows = [
    [
      'frame-ancestors merged into an existing policy',
      {},
      { 'content-security-policy': "default-src 'self'" },
    ],
    ['full mode with the nonce', { manageCsp: 'full' }, {}],
    [
      'CSP off: only the cache headers change',
      { manageCsp: false },
      { 'cache-control': 'public, max-age=60', vary: 'Accept-Encoding' },
    ],
    [
      'an existing no-store and Cookie kept as they are',
      {},
      { 'cache-control': 'no-store', vary: 'cookie' },
    ],
  ] as const;

  it.each(rows)('%s', async (_label, csp, existing) => {
    const options = { defaults: 'v1' as const, allowedOrigins: [ADMIN], ...csp };
    const policy = createPreviewPolicy(options);
    const decision = await policy.decide(new Request('https://site.example.com/?preview=true'));
    const nonce = 'n0nce';
    const expected = withCspHeader(
      new Response('', { headers: existing }),
      policy,
      decision,
      nonce,
    );
    const nitro = fakeNitro();
    livePreviewNitroPlugin(options)(nitro.app);
    const res = { headers: new Headers(existing) };
    await nitro.render({
      path: '/?preview=true',
      res,
      context: { [DECISION_CONTEXT_KEY]: { decision, nonce } },
    });
    for (const name of HEADERS) expect(res.headers.get(name)).toBe(expected.headers.get(name));
  });
});

describe('defineLivePreviewServerHandler', () => {
  it('decides before the app renders and publishes nonce, authorization and outcome', async () => {
    const authorizePreview = vi.fn(() => null);
    const handler = defineLivePreviewServerHandler({ allowedOrigins: [ADMIN], authorizePreview });
    const ev = event('/page?preview=true', { host: 'site.example.com' });
    expect(await handler(ev)).toBeUndefined();
    expect(authorizePreview).toHaveBeenCalledOnce();
    expect(ev.context?.['livePreviewAuthorizationOutcome']).toBe('invalid');
    expect(ev.context?.['livePreviewNonce']).toBeUndefined();
  });

  it('exposes a fresh nonce per ordinary request', async () => {
    const handler = defineLivePreviewServerHandler({ defaults: 'v1' });
    const a = event();
    const b = event();
    await handler(a);
    await handler(b);
    expect(typeof a.context?.['livePreviewNonce']).toBe('string');
    expect(a.context?.['livePreviewNonce']).not.toBe(b.context?.['livePreviewNonce']);
  });

  it('hands a refusal to the plugin, which injects nothing and does not authorize again', async () => {
    const authorizePreview = vi.fn(() => null);
    const options = { defaults: 'v1' as const, allowedOrigins: [ADMIN], authorizePreview };
    const handler = defineLivePreviewServerHandler(options);
    const nitro = fakeNitro();
    livePreviewNitroPlugin(options)(nitro.app);
    const ev = event('/page?preview=true', { host: 'site.example.com' });
    await handler(ev);
    expect(await nitro.render(ev)).toEqual([]);
    expect(authorizePreview).toHaveBeenCalledOnce();
  });

  it('injects with the nonce the handler stashed, authorizing once for both', async () => {
    const context = await authorizedContext();
    const authorizePreview = vi.fn(() => context);
    const options = { defaults: 'v1' as const, allowedOrigins: [ADMIN], authorizePreview };
    const handler = defineLivePreviewServerHandler(options);
    const nitro = fakeNitro();
    livePreviewNitroPlugin(options)(nitro.app);
    const ev = event('/page?preview=true', { host: 'site.example.com' });
    await handler(ev);
    const nonce = ev.context?.['livePreviewNonce'];
    const head = await nitro.render(ev);
    expect(authorizePreview).toHaveBeenCalledOnce();
    expect(typeof nonce).toBe('string');
    expect(head[0]).toContain(`nonce="${String(nonce)}"`);
    expect(ev.context?.['livePreviewAuthorization']).toBe(context);
  });

  it('does not throw for an event with no context', async () => {
    const handler = defineLivePreviewServerHandler({ defaults: 'v1' });
    await expect(handler({ path: '/' })).resolves.toBeUndefined();
  });
});

describe('renderLivePreviewScript', () => {
  it('returns a script tag carrying the configuration', () => {
    const tag = renderLivePreviewScript({ allowedOrigins: [ADMIN] });
    expect(tag).toMatch(/^<script/u);
    expect(tag).toContain(ADMIN);
  });

  it('carries a nonce when one is supplied, and none when it is not', () => {
    expect(renderLivePreviewScript({ nonce: 'abc123' })).toContain('nonce="abc123"');
    expect(renderLivePreviewScript({})).not.toContain('nonce=');
  });
});

describe('buildLivePreviewCsp', () => {
  it('merges frame-ancestors into an existing policy', () => {
    const csp = buildLivePreviewCsp(
      { allowedOrigins: [ADMIN] },
      'n0nce',
      "default-src 'self'",
      'frame-ancestors',
    );
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(ADMIN);
  });

  it("adds a nonce-based script-src only in 'full' mode", () => {
    expect(buildLivePreviewCsp({}, 'n0nce', '', 'frame-ancestors')).not.toContain('script-src');
    const full = buildLivePreviewCsp({}, 'n0nce', '', 'full');
    expect(full).toContain('script-src');
    expect(full).toContain('n0nce');
  });

  it('falls back to the options when no explicit mode is passed', () => {
    expect(buildLivePreviewCsp({ manageCsp: 'full' }, 'n0nce', '')).toContain('script-src');
    const ancestors = buildLivePreviewCsp({}, 'n0nce', '');
    expect(ancestors).not.toContain('script-src');
    expect(ancestors).toContain('frame-ancestors');
  });
});

describe('livePreviewNitroPlugin — sparse Nitro events', () => {
  it('injects for an event that carries no context at all', async () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ defaults: 'v1', inject: 'always' })(nitro.app);
    expect(await nitro.render({ path: '/' })).toHaveLength(1);
  });

  it('falls back to the request url when the event has no path', async () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ defaults: 'v1', allowedOrigins: [ADMIN] })(nitro.app);
    const ev: FakeEvent = { context: {}, node: { req: { url: '/?preview=true', headers: {} } } };
    expect(await nitro.render(ev)).toHaveLength(1);
  });

  it('reads a header that arrives as a string array', async () => {
    // Node hands repeated headers over as string[]; the raw array never equals 'iframe'.
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ defaults: 'v1', allowedOrigins: [ADMIN] })(nitro.app);
    expect(await nitro.render(event('/', { 'sec-fetch-dest': ['iframe'] }))).toHaveLength(1);
  });
});
