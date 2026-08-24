import { describe, expect, it } from 'vitest';
import {
  buildLivePreviewCsp,
  defineLivePreviewServerHandler,
  livePreviewNitroPlugin,
  renderLivePreviewScript,
} from '@adapters/nuxt/index';

/**
 * The Nuxt adapter had no unit tests. It also has the largest surface of the
 * three — a Nitro plugin, a server handler, a script renderer and a CSP
 * builder — and the plugin works by pushing into a `head` array rather than
 * rewriting a body, so its failure modes differ from the others.
 */

const ADMIN = 'https://admin.example.com';

interface FakeEvent {
  path?: string;
  node?: {
    req?: { url?: string; headers?: Record<string, string | undefined> };
    res?: {
      getHeader?: (name: string) => string | undefined;
      setHeader?: (name: string, value: string) => void;
    };
  };
  context?: Record<string, unknown>;
}

/** A Nitro app that captures the `render:html` hook so a test can fire it. */
function fakeNitro() {
  let hook: ((html: { head: string[] }, ctx: { event: FakeEvent }) => void) | undefined;
  return {
    app: {
      hooks: {
        hook(_name: 'render:html', fn: (h: { head: string[] }, c: { event: FakeEvent }) => void) {
          hook = fn;
        },
      },
    },
    render(event: FakeEvent): { head: string[]; headers: Record<string, string> } {
      const head: string[] = [];
      hook?.({ head }, { event });
      return { head, headers: event.context?.['__headers'] as Record<string, string> };
    },
  };
}

function event(url = '/', headers: Record<string, string | undefined> = {}): FakeEvent {
  const written: Record<string, string> = {};
  const context: Record<string, unknown> = { __headers: written };
  return {
    path: url,
    context,
    node: {
      req: { url, headers },
      res: {
        getHeader: (name) => written[name],
        setHeader: (name, value) => {
          written[name] = value;
        },
      },
    },
  };
}

const IFRAME = { 'sec-fetch-dest': 'iframe' } as const;

describe('livePreviewNitroPlugin — when it injects', () => {
  it('adds nothing to the head for an ordinary request', () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN] })(nitro.app);
    expect(nitro.render(event()).head).toEqual([]);
  });

  it('pushes exactly one script tag for an iframe load', () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN] })(nitro.app);
    const { head } = nitro.render(event('/', IFRAME));

    expect(head).toHaveLength(1);
    expect(head[0]).toContain('__LIVE_PREVIEW_CONFIG__');
    expect(head[0]).toMatch(/^<script/u);
  });

  it('injects for a query-parameter intent signal', () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN] })(nitro.app);
    expect(nitro.render(event('/?preview=true')).head).toHaveLength(1);
  });

  it("injects on every render with inject: 'always'", () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ inject: 'always' })(nitro.app);
    expect(nitro.render(event()).head).toHaveLength(1);
  });

  it('honours autoInject: false while still writing CSP', () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ inject: 'always', autoInject: false, allowedOrigins: [ADMIN] })(
      nitro.app,
    );
    const rendered = nitro.render(event());

    expect(rendered.head).toEqual([]);
    expect(rendered.headers['content-security-policy']).toContain('frame-ancestors');
  });

  it('nonces the injected tag with the same value it stashes on the context', () => {
    // A consumer reads `livePreviewNonce` to nonce its own scripts. If the two
    // ever diverged the injected script would be the one CSP rejects.
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ inject: 'always', manageCsp: 'full' })(nitro.app);
    const ev = event();
    const { head } = nitro.render(ev);

    const nonce = ev.context?.['livePreviewNonce'];
    expect(typeof nonce).toBe('string');
    expect(head[0]).toContain(`nonce="${String(nonce)}"`);
  });
});

describe('livePreviewNitroPlugin — CSP', () => {
  it('adds frame-ancestors for the configured admin origin', () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN] })(nitro.app);
    const csp = nitro.render(event('/', IFRAME)).headers['content-security-policy'] ?? '';

    expect(csp).toContain('frame-ancestors');
    expect(csp).toContain(ADMIN);
  });

  it('keeps the directives an existing policy already declared', () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN] })(nitro.app);
    const ev = event('/', IFRAME);
    (ev.context?.['__headers'] as Record<string, string>)['content-security-policy'] =
      "default-src 'self'; img-src *";
    const csp = nitro.render(ev).headers['content-security-policy'] ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('img-src *');
    expect(csp).toContain('frame-ancestors');
  });

  it('writes no CSP when manageCsp is false', () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN], manageCsp: false })(nitro.app);
    expect(nitro.render(event('/', IFRAME)).headers['content-security-policy']).toBeUndefined();
  });

  it('still injects, without throwing, when the event exposes no response object', () => {
    // Nitro can render without a node response — a prerender pass, for one.
    // Throwing there would fail the whole build over a header nobody can set,
    // and skipping the injection would leave that page without a runtime.
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ inject: 'always', allowedOrigins: [ADMIN] })(nitro.app);
    const bare: FakeEvent = { path: '/', context: {} };

    let head: string[] = [];
    expect(() => {
      head = nitro.render(bare).head;
    }).not.toThrow();
    expect(head).toHaveLength(1);
    expect(head[0]).toContain('__LIVE_PREVIEW_CONFIG__');
  });
});

describe('defineLivePreviewServerHandler', () => {
  it('stashes a nonce and injects nothing', async () => {
    const handler = defineLivePreviewServerHandler();
    const ev = event();
    const result = await handler(ev);

    expect(result).toBeUndefined();
    expect(typeof ev.context?.['livePreviewNonce']).toBe('string');
  });

  it('issues a different nonce per request', async () => {
    const handler = defineLivePreviewServerHandler();
    const a = event();
    const b = event();
    await handler(a);
    await handler(b);
    expect(a.context?.['livePreviewNonce']).not.toBe(b.context?.['livePreviewNonce']);
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
    const ancestorsOnly = buildLivePreviewCsp({}, 'n0nce', '', 'frame-ancestors');
    const full = buildLivePreviewCsp({}, 'n0nce', '', 'full');

    expect(ancestorsOnly).not.toContain('script-src');
    expect(full).toContain('script-src');
    expect(full).toContain('n0nce');
  });
});

describe('livePreviewNitroPlugin — sparse Nitro events', () => {
  it('injects for an event that carries no context at all', () => {
    // A prerender pass can hand the hook an event with neither context nor a
    // node response. Reaching into `context` unguarded would throw and fail
    // the whole build.
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ inject: 'always' })(nitro.app);

    let head: string[] = [];
    expect(() => {
      head = nitro.render({ path: '/' }).head;
    }).not.toThrow();
    expect(head).toHaveLength(1);
  });

  it('falls back to the request url when the event has no path', () => {
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN] })(nitro.app);
    const ev: FakeEvent = {
      context: {},
      node: { req: { url: '/?preview=true', headers: {} } },
    };
    expect(nitro.render(ev).head).toHaveLength(1);
  });

  it('reads a header that arrives as a string array', () => {
    // Node hands repeated headers over as string[]. Comparing the raw array
    // against 'iframe' never matches, so the preview would silently not load.
    // The host is deliberately not the probe here: a comma-joined host still
    // parses as a url, so it would prove nothing.
    const nitro = fakeNitro();
    livePreviewNitroPlugin({ allowedOrigins: [ADMIN] })(nitro.app);
    const ev: FakeEvent = {
      path: '/',
      context: {},
      node: {
        req: { url: '/', headers: { 'sec-fetch-dest': ['iframe'] as unknown as string } },
      },
    };
    expect(nitro.render(ev).head).toHaveLength(1);
  });
});

describe('defineLivePreviewServerHandler — sparse events', () => {
  it('does not throw for an event with no context', async () => {
    const handler = defineLivePreviewServerHandler();
    await expect(handler({ path: '/' })).resolves.toBeUndefined();
  });
});

describe('buildLivePreviewCsp — mode resolution', () => {
  it('falls back to the options when no explicit mode is passed', () => {
    // The signature makes mode optional; the plugin relies on that fallback.
    const full = buildLivePreviewCsp({ manageCsp: 'full' }, 'n0nce', '');
    const ancestors = buildLivePreviewCsp({}, 'n0nce', '');

    expect(full).toContain('script-src');
    expect(full).toContain('n0nce');
    expect(ancestors).not.toContain('script-src');
    expect(ancestors).toContain('frame-ancestors');
  });
});
