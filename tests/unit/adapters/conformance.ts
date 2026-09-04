import { describe, expect, it, vi } from 'vitest';
import type { AuthorizedPreviewContext } from '@/types/authorized-preview';
import { authorizePreviewRequest } from '@security/preview-authorization';

/**
 * One behavioural suite for the four adapters. A harness supplies only the
 * framework-specific way to run a request; every expectation lives here.
 */

export const ADMIN = 'https://admin.example.com';
export const SITE = 'https://site.example.com';
export const PAGE = '<html><head></head><body>hi</body></html>';
export const MARKER = '__LIVE_PREVIEW_CONFIG__';

export interface ConformanceRequest {
  readonly url: string;
  readonly headers?: Record<string, string>;
  /** Content type of the response the adapter sees; default `text/html`. */
  readonly contentType?: string;
  /** Headers the response already carries. */
  readonly responseHeaders?: Record<string, string>;
}

export interface ConformanceOutcome {
  /** The HTML the client would receive (for Nuxt: the head the hook produced). */
  readonly body: string;
  /** Response headers as written; `null` when absent. */
  readonly header: (name: string) => string | null;
  /** What the adapter published for templates (`locals` / `event.context`). */
  readonly locals: Record<string, unknown>;
}

export interface ConformanceHarness {
  readonly name: string;
  /** Whether the framework has a `locals`-like surface for templates. */
  readonly exposesLocals: boolean;
  readonly run: (
    options: Record<string, unknown>,
    request: ConformanceRequest,
  ) => Promise<ConformanceOutcome>;
}

export const IFRAME = { 'sec-fetch-dest': 'iframe' } as const;
const INTENT = `${SITE}/page?preview=true`;
const PLAIN = `${SITE}/page`;

function tagNonce(body: string): string | undefined {
  return /<script[^>]*\snonce="([^"]+)"/u.exec(body)?.[1];
}

async function authorized(): Promise<AuthorizedPreviewContext> {
  const result = await authorizePreviewRequest(new Request(INTENT), {
    type: 'verifier',
    verify: () => ({ subject: 'editor' }),
  });
  if (!result.authorized) throw new Error('expected authorization');
  return result.context;
}

export function adapterConformance(harness: ConformanceHarness): void {
  const run = (options: Record<string, unknown>, request: ConformanceRequest) =>
    harness.run({ allowedOrigins: [ADMIN], defaults: 'v1', ...options }, request);
  const runDefault = (options: Record<string, unknown>, request: ConformanceRequest) =>
    harness.run({ allowedOrigins: [ADMIN], ...options }, request);
  const csp = (out: ConformanceOutcome) => out.header('content-security-policy');

  describe(`${harness.name} — conformance: when it injects`, () => {
    it('leaves an ordinary request untouched: no script, no CSP, no cache headers', async () => {
      const out = await run({}, { url: PLAIN });
      expect(out.body).not.toContain(MARKER);
      expect(csp(out)).toBeNull();
      expect(out.header('cache-control')).toBeNull();
      expect(out.header('vary')).toBeNull();
    });
    it('injects for a query-parameter intent signal', async () => {
      const out = await run({}, { url: INTENT });
      expect(out.body).toContain(MARKER);
    });
    it('injects for an iframe load', async () => {
      const out = await run({}, { url: PLAIN, headers: IFRAME });
      expect(out.body).toContain(MARKER);
    });
    it("injects into every HTML response with inject: 'always'", async () => {
      const out = await run({ inject: 'always' }, { url: PLAIN });
      expect(out.body).toContain(MARKER);
    });
    it('injects exactly one script tag', async () => {
      const out = await run({}, { url: INTENT });
      expect(out.body.split(`var ${MARKER}=`).length - 1).toBe(1);
    });
    it('never injects into a non-HTML response', async () => {
      const out = await run({}, { url: INTENT, contentType: 'application/json' });
      expect(out.body).not.toContain(MARKER);
    });
    it('honours autoInject: false while still managing CSP', async () => {
      const out = await run({ autoInject: false }, { url: INTENT });
      expect(out.body).not.toContain(MARKER);
      expect(csp(out)).toContain('frame-ancestors');
    });
    it('honours a shouldInject predicate and passes it the request', async () => {
      const shouldInject = vi.fn((request: { url: string }) => request.url.includes('/page'));
      const injected = await run({ shouldInject }, { url: INTENT });
      expect(injected.body).toContain(MARKER);
      expect(shouldInject).toHaveBeenCalledTimes(1);
      expect(shouldInject.mock.calls[0]?.[0]?.url).toContain('/page');
      const refused = await run(
        { shouldInject: () => false },
        { url: `${SITE}/other?preview=true` },
      );
      expect(refused.body).not.toContain(MARKER);
    });
  });

  describe(`${harness.name} — conformance: CSP`, () => {
    it('adds frame-ancestors for the configured admin origin', async () => {
      const out = await run({}, { url: INTENT });
      expect(csp(out)).toContain(`frame-ancestors 'self' ${ADMIN}`);
    });
    it('manages only frame-ancestors by default, leaving script-src alone', async () => {
      const out = await run({}, { url: INTENT });
      expect(csp(out)).not.toContain('script-src');
    });
    it('keeps the directives an existing policy already declared', async () => {
      const out = await run(
        {},
        {
          url: INTENT,
          responseHeaders: { 'content-security-policy': "default-src 'self'; img-src *" },
        },
      );
      expect(csp(out)).toContain("default-src 'self'");
      expect(csp(out)).toContain('img-src *');
      expect(csp(out)).toContain('frame-ancestors');
    });
    it('widens every policy of a comma-joined multi-policy header', async () => {
      const out = await run(
        {},
        {
          url: INTENT,
          responseHeaders: {
            'content-security-policy': "frame-ancestors 'none', default-src 'self'",
          },
        },
      );
      expect(csp(out)).toBe(
        `frame-ancestors 'self' ${ADMIN}, default-src 'self'; frame-ancestors 'self' ${ADMIN}`,
      );
    });
    it('does not touch CSP when manageCsp is false', async () => {
      const out = await run({ manageCsp: false }, { url: INTENT });
      expect(out.body).toContain(MARKER);
      expect(csp(out)).toBeNull();
    });
    it('leaves CSP untouched on a request with no preview intent', async () => {
      const out = await run(
        {},
        { url: PLAIN, responseHeaders: { 'content-security-policy': "default-src 'self'" } },
      );
      expect(csp(out) === null || csp(out) === "default-src 'self'").toBe(true);
    });
    it("in 'full' mode, the tag nonce, the script-src nonce and the exposed nonce are one value", async () => {
      const out = await run({ manageCsp: 'full' }, { url: INTENT });
      const nonce = tagNonce(out.body);
      expect(nonce).toBeTruthy();
      expect(csp(out)).toMatch(/script-src\s+'self' 'nonce-[A-Za-z0-9_-]+'/u);
      expect(csp(out)).toContain(`'nonce-${String(nonce)}'`);
      if (harness.exposesLocals) expect(out.locals['livePreviewNonce']).toBe(nonce);
    });
    it("in 'full' mode, adds strict-dynamic only when asked", async () => {
      const plain = await run({ manageCsp: 'full' }, { url: INTENT });
      expect(csp(plain)).not.toContain("'strict-dynamic'");
    });
  });

  describe(`${harness.name} — conformance: cache headers on a changed response`, () => {
    it('marks an injected response private and no-store, varying on Cookie', async () => {
      const out = await run({}, { url: INTENT });
      expect(out.header('cache-control')).toBe('private, no-store');
      expect(out.header('vary')).toBe('Cookie');
    });
    it('does the same when only CSP changed', async () => {
      const out = await run({ autoInject: false }, { url: INTENT });
      expect(out.header('cache-control')).toBe('private, no-store');
    });
    it('keeps an existing no-store directive and appends Cookie to an existing Vary', async () => {
      const out = await run(
        {},
        {
          url: INTENT,
          responseHeaders: { 'cache-control': 'no-store, max-age=0', vary: 'Accept-Encoding' },
        },
      );
      expect(out.header('cache-control')).toBe('no-store, max-age=0');
      expect(out.header('vary')).toBe('Accept-Encoding, Cookie');
    });
    it('does not list Cookie twice', async () => {
      const out = await run({}, { url: INTENT, responseHeaders: { vary: 'cookie' } });
      expect(out.header('vary')).toBe('cookie');
    });
  });

  describe(`${harness.name} — conformance: authorization`, () => {
    it('a refused authorization injects nothing, writes no CSP and exposes no nonce', async () => {
      const out = await run({ authorizePreview: () => null }, { url: INTENT });
      expect(out.body).not.toContain(MARKER);
      expect(csp(out)).toBeNull();
      expect(out.header('cache-control')).toBeNull();
      expect(out.locals['livePreviewNonce']).toBeUndefined();
    });
    it('publishes the outcome for templates where the framework has locals', async () => {
      const out = await run({ authorizePreview: () => null }, { url: INTENT });
      expect(out.locals['livePreviewAuthorizationOutcome']).toBe(
        harness.exposesLocals ? 'invalid' : undefined,
      );
    });
    it('an authorized preview injects and manages CSP', async () => {
      const ctx = await authorized();
      const out = await run({ authorizePreview: () => ctx }, { url: INTENT });
      expect(out.body).toContain(MARKER);
      expect(csp(out)).toContain('frame-ancestors');
      expect(out.locals['livePreviewAuthorization']).toBe(harness.exposesLocals ? ctx : undefined);
    });
    it('authorization is consulted only once intent is established', async () => {
      const authorizePreview = vi.fn(() => null);
      await run({ authorizePreview }, { url: PLAIN });
      expect(authorizePreview).not.toHaveBeenCalled();
    });
  });

  describe(`${harness.name} — conformance: shipped defaults`, () => {
    it('refuses to construct without authorizePreview', async () => {
      await expect(runDefault({}, { url: INTENT })).rejects.toThrow(/authorizePreview/u);
    });
    it('an iframe load alone is not intent', async () => {
      const authorizePreview = vi.fn(() => null);
      const out = await runDefault({ authorizePreview }, { url: PLAIN, headers: IFRAME });
      expect(out.body).not.toContain(MARKER);
      expect(authorizePreview).not.toHaveBeenCalled();
    });
    it('an authorized preview injects, manages CSP and is uncacheable', async () => {
      const ctx = await authorized();
      const out = await runDefault({ authorizePreview: () => ctx }, { url: INTENT });
      expect(out.body).toContain(MARKER);
      expect(csp(out)).toContain(`frame-ancestors 'self' ${ADMIN}`);
      expect(out.header('cache-control')).toBe('private, no-store');
    });
  });
}
