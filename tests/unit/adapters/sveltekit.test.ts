import { describe, expect, it, vi } from 'vitest';
import { livePreviewHandle } from '@adapters/sveltekit/index';

/** The fake `resolve` applies `transformPageChunk` the way SvelteKit does: chunk by chunk, `|| ''`. */

const ADMIN = 'https://admin.example.com';

interface ResolveOptions {
  transformPageChunk?: (input: { html: string; done: boolean }) => string | undefined;
}

function applyChunk(transform: ResolveOptions['transformPageChunk'], html: string, done: boolean) {
  if (transform === undefined) return html;
  const transformed = transform({ html, done });
  return transformed === undefined || transformed === '' ? '' : transformed;
}

function makeResolve(
  chunks: readonly string[],
  init: ResponseInit = { headers: { 'content-type': 'text/html' } },
) {
  return vi.fn(async (_event: unknown, opts: ResolveOptions = {}) => {
    const out = chunks
      .map((html, i) => applyChunk(opts.transformPageChunk, html, i === chunks.length - 1))
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
    const handle = livePreviewHandle({ defaults: 'v1', allowedOrigins: [ADMIN] });
    const plain = event();
    await handle({ event: plain, resolve: makeResolve([PAGE]) });
    expect(typeof plain.locals['livePreviewNonce']).toBe('string');
    expect(plain.locals['livePreviewNonce']).not.toBe('');
  });

  it('issues a different nonce per request', async () => {
    const handle = livePreviewHandle({ defaults: 'v1', allowedOrigins: [ADMIN] });
    const a = event();
    const b = event();
    await handle({ event: a, resolve: makeResolve([PAGE]) });
    await handle({ event: b, resolve: makeResolve([PAGE]) });
    expect(a.locals['livePreviewNonce']).not.toBe(b.locals['livePreviewNonce']);
  });
});

describe('livePreviewHandle — when it injects', () => {
  it('injects exactly once when the page arrives as several chunks', async () => {
    const response = await livePreviewHandle({ defaults: 'v1', inject: 'always' })({
      event: event(),
      resolve: makeResolve(['<html><head>', '</head><body>', 'hi</body></html>']),
    });
    const html = await response.text();
    // Count tags: one injected script mentions __LIVE_PREVIEW_CONFIG__ three times.
    expect(html.split('<script').length - 1).toBe(1);
    expect(html).toContain('__LIVE_PREVIEW_CONFIG__');
  });

  it('inserts after <meta charset> so the encoding stays inside the prescan window', async () => {
    const response = await livePreviewHandle({ defaults: 'v1', inject: 'always' })({
      event: event(),
      resolve: makeResolve(['<html><head><meta charset="utf-8" /><title>t</title></head></html>']),
    });
    const html = await response.text();
    expect(html.indexOf('<meta charset')).toBeLessThan(html.indexOf('<script'));
    expect(html.indexOf('<script')).toBeLessThan(html.indexOf('<title>'));
  });
});

describe('livePreviewHandle — chunks it must leave alone', () => {
  it('returns a chunk without a <head> unchanged, never as the empty string', async () => {
    // Every streamed chunk after the first has no head; SvelteKit turns a
    // falsy return into '', which would blank the rest of the page.
    const response = await livePreviewHandle({ defaults: 'v1', inject: 'always' })({
      event: event(),
      resolve: makeResolve(['<div>fragment only</div>']),
    });
    expect(await response.text()).toBe('<div>fragment only</div>');
  });

  it('keeps every later chunk of a streamed page', async () => {
    const response = await livePreviewHandle({ defaults: 'v1', inject: 'always' })({
      event: event(),
      resolve: makeResolve(['<html><head></head>', '<body>a</body>', '</html>']),
    });
    const html = await response.text();
    expect(html.split('<script').length - 1).toBe(1);
    expect(html.indexOf('<script')).toBeLessThan(html.indexOf('<body>'));
    expect(html.endsWith('<body>a</body></html>')).toBe(true);
  });
});

describe('livePreviewHandle — a runtime that refuses header mutation', () => {
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
    const response = await livePreviewHandle({
      defaults: 'v1',
      inject: 'always',
      allowedOrigins: [ADMIN],
    })({ event: event(), resolve: frozen(['<p>body</p>']) });
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('<p>body</p>');
  });
});
