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
