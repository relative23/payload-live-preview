import { describe, expect, it, vi } from 'vitest';
import { livePreviewHandle } from '@adapters/sveltekit/index';

/**
 * The SvelteKit adapter had no unit tests. Its browser fixture proves the
 * happy path; these cover the branches around it — a non-HTML response, an
 * existing CSP, the nonce contract that consumer load functions read.
 *
 * SvelteKit injects through `transformPageChunk` rather than by rewriting a
 * finished body, so the fake `resolve` below applies the transform the way the
 * framework does: chunk by chunk.
 */

const ADMIN = 'https://admin.example.com';

interface ResolveOptions {
  transformPageChunk?: (input: { html: string; done: boolean }) => string | undefined;
}

/** A `resolve` that streams `chunks` through whatever transform it is given. */
function makeResolve(
  chunks: readonly string[],
  init: ResponseInit = { headers: { 'content-type': 'text/html' } },
) {
  return vi.fn(async (_event: unknown, opts: ResolveOptions = {}) => {
    const out = chunks
      .map((html, i) => opts.transformPageChunk?.({ html, done: i === chunks.length - 1 }) ?? html)
      .join('');
    return Promise.resolve(new Response(out, init));
  });
}

function event(url = 'https://site.example.com/', headers: Record<string, string> = {}) {
  return { request: new Request(url, { headers }), locals: {} as Record<string, unknown> };
}

const PAGE = '<html><head></head><body>hi</body></html>';
const IFRAME = { 'sec-fetch-dest': 'iframe' } as const;

describe('livePreviewHandle — the nonce contract', () => {
  it('writes a nonce to locals on every request, preview or not', async () => {
    // Consumer load functions read this to nonce their own scripts; it must be
    // there even when nothing is injected, or their CSP breaks on plain pages.
    const handle = livePreviewHandle({ allowedOrigins: [ADMIN] });
    const plain = event();
    await handle({ event: plain, resolve: makeResolve([PAGE]) });

    expect(typeof plain.locals['livePreviewNonce']).toBe('string');
    expect(plain.locals['livePreviewNonce']).not.toBe('');
  });

  it('issues a different nonce per request', async () => {
    const handle = livePreviewHandle({ allowedOrigins: [ADMIN] });
    const a = event();
    const b = event();
    await handle({ event: a, resolve: makeResolve([PAGE]) });
    await handle({ event: b, resolve: makeResolve([PAGE]) });

    expect(a.locals['livePreviewNonce']).not.toBe(b.locals['livePreviewNonce']);
  });
});

describe('livePreviewHandle — when it injects', () => {
  it('passes no transform at all for an ordinary request', async () => {
    const resolve = makeResolve([PAGE]);
    await livePreviewHandle({ allowedOrigins: [ADMIN] })({ event: event(), resolve });

    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve.mock.calls[0]?.[1]?.transformPageChunk).toBeUndefined();
  });

  it('injects into the head chunk for an iframe load', async () => {
    const response = await livePreviewHandle({ allowedOrigins: [ADMIN] })({
      event: event('https://site.example.com/', IFRAME),
      resolve: makeResolve([PAGE]),
    });
    expect(await response.text()).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('injects for a query-parameter intent signal', async () => {
    const response = await livePreviewHandle({ allowedOrigins: [ADMIN] })({
      event: event('https://site.example.com/?preview=true'),
      resolve: makeResolve([PAGE]),
    });
    expect(await response.text()).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('injects exactly once when the page arrives as several chunks', async () => {
    // transformPageChunk is called per chunk. Injecting on each would give the
    // page as many runtimes as it has chunks, and streaming is SvelteKit's
    // normal mode — a fixture serving one chunk would never reveal it.
    const response = await livePreviewHandle({ inject: 'always' })({
      event: event(),
      resolve: makeResolve(['<html><head>', '</head><body>', 'hi</body></html>']),
    });
    const html = await response.text();
    // Count tags, not identifier occurrences: one injected script mentions
    // __LIVE_PREVIEW_CONFIG__ three times — the declaration plus the two reads
    // in the runtime body — so counting those would report three injections
    // for one.
    expect(html.split('<script').length - 1).toBe(1);
    expect(html).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('honours autoInject: false', async () => {
    const response = await livePreviewHandle({ inject: 'always', autoInject: false })({
      event: event(),
      resolve: makeResolve([PAGE]),
    });
    expect(await response.text()).not.toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('honours a shouldInject predicate and passes it the request', async () => {
    const shouldInject = vi.fn((_request: Request) => false);
    const response = await livePreviewHandle({ inject: 'always', shouldInject })({
      event: event('https://site.example.com/private'),
      resolve: makeResolve([PAGE]),
    });

    expect(await response.text()).not.toContain('__LIVE_PREVIEW_CONFIG__');
    expect(shouldInject.mock.calls[0]?.[0]?.url).toContain('/private');
  });
});

describe('livePreviewHandle — CSP', () => {
  it('adds frame-ancestors for the configured admin origin', async () => {
    const response = await livePreviewHandle({ allowedOrigins: [ADMIN] })({
      event: event('https://site.example.com/', IFRAME),
      resolve: makeResolve([PAGE]),
    });
    const csp = response.headers.get('content-security-policy') ?? '';

    expect(csp).toContain('frame-ancestors');
    expect(csp).toContain(ADMIN);
  });

  it('keeps the directives an existing policy already declared', async () => {
    const response = await livePreviewHandle({ allowedOrigins: [ADMIN] })({
      event: event('https://site.example.com/', IFRAME),
      resolve: makeResolve([PAGE], {
        headers: {
          'content-type': 'text/html',
          'content-security-policy': "default-src 'self'; img-src *",
        },
      }),
    });
    const csp = response.headers.get('content-security-policy') ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('img-src *');
    expect(csp).toContain('frame-ancestors');
  });

  it('does not touch CSP when manageCsp is false', async () => {
    const response = await livePreviewHandle({ allowedOrigins: [ADMIN], manageCsp: false })({
      event: event('https://site.example.com/', IFRAME),
      resolve: makeResolve([PAGE]),
    });
    expect(response.headers.get('content-security-policy')).toBeNull();
  });

  it('leaves CSP alone on a request with no preview intent', async () => {
    const response = await livePreviewHandle({ allowedOrigins: [ADMIN] })({
      event: event(),
      resolve: makeResolve([PAGE]),
    });
    expect(response.headers.get('content-security-policy')).toBeNull();
  });
});

describe('livePreviewHandle — CSP in full mode', () => {
  it('uses one nonce for locals, the script tag and script-src alike', async () => {
    // Three places have to agree. If any pair drifts, the browser rejects
    // either our script or the consumer's, and only in production CSP.
    const handle = livePreviewHandle({ inject: 'always', manageCsp: 'full' });
    const ev = event();
    const response = await handle({ event: ev, resolve: makeResolve([PAGE]) });
    const html = await response.text();
    const csp = response.headers.get('content-security-policy') ?? '';

    const nonce = ev.locals['livePreviewNonce'] as string;
    expect(html).toContain(`nonce="${nonce}"`);
    expect(csp).toContain(`'nonce-${nonce}'`);
  });

  it("keeps script-src out of the header in the default 'frame-ancestors' mode", async () => {
    const response = await livePreviewHandle({ inject: 'always' })({
      event: event(),
      resolve: makeResolve([PAGE]),
    });
    expect(response.headers.get('content-security-policy')).not.toContain('script-src');
  });
});

describe('livePreviewHandle — chunks it must leave alone', () => {
  it('returns a chunk without a <head> unchanged', async () => {
    // Every streamed chunk after the first has no head. The transform must
    // decline them rather than rewrite them.
    const response = await livePreviewHandle({ inject: 'always' })({
      event: event(),
      resolve: makeResolve(['<div>fragment only</div>']),
    });
    expect(await response.text()).toBe('<div>fragment only</div>');
  });

  it('injects into the head chunk and no other', async () => {
    const response = await livePreviewHandle({ inject: 'always' })({
      event: event(),
      resolve: makeResolve(['<html><head></head>', '<body>a</body>', '</html>']),
    });
    const html = await response.text();

    expect(html.split('<script').length - 1).toBe(1);
    expect(html.indexOf('<script')).toBeLessThan(html.indexOf('<body>'));
  });
});

describe('livePreviewHandle — a runtime that refuses header mutation', () => {
  /** Adapter responses can arrive with an immutable header guard. */
  function frozen(chunks: readonly string[]) {
    return vi.fn(async (_event: unknown, _opts: ResolveOptions = {}) => {
      const response = new Response(chunks.join(''), {
        headers: { 'content-type': 'text/html' },
      });
      Object.defineProperty(response.headers, 'set', {
        value: () => {
          throw new TypeError('immutable');
        },
      });
      return Promise.resolve(response);
    });
  }

  it('falls back to a fresh response instead of throwing', async () => {
    const response = await livePreviewHandle({ inject: 'always', allowedOrigins: [ADMIN] })({
      event: event(),
      resolve: frozen(['<p>body</p>']),
    });

    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
    expect(await response.text()).toBe('<p>body</p>');
  });
});
