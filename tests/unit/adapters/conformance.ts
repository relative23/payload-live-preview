import { describe, expect, it, vi } from 'vitest';
import type { AuthorizedPreviewContext } from '@/types/authorized-preview';
import { authorizePreviewRequest } from '@security/preview-authorization';

/**
 * One behavioural suite for the four framework adapters (roadmap 1.8.0).
 *
 * Each adapter is a thin translation around the shared preview policy, so
 * what it must do is the same everywhere: inject only on preview intent,
 * manage CSP as configured, expose one nonce that the tag and the header
 * agree on, and stop at an authorization refusal. A harness supplies the
 * framework-specific way to run a request; the cases are written once.
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
  /** A CSP header the response already carries. */
  readonly existingCsp?: string;
}

export interface ConformanceOutcome {
  /** The HTML the client would receive (for Nuxt: the head the hook produced). */
  readonly body: string;
  /** The `content-security-policy` header as written, or `null`. */
  readonly csp: string | null;
  /** The nonce the adapter hands to templates (locals/context), when it has one. */
  readonly nonce: string | undefined;
}

export interface ConformanceHarness {
  readonly name: string;
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

export function adapterConformance(harness: ConformanceHarness): void {
  const run = (options: Record<string, unknown>, request: ConformanceRequest) =>
    harness.run({ allowedOrigins: [ADMIN], ...options }, request);

  describe(`${harness.name} — conformance: when it injects`, () => {
    it('leaves an ordinary request untouched: no script, no CSP', async () => {
      const out = await run({}, { url: PLAIN });
      expect(out.body).not.toContain(MARKER);
      expect(out.csp).toBeNull();
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
      expect(out.csp).toContain('frame-ancestors');
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
      expect(out.csp).toContain(`frame-ancestors 'self' ${ADMIN}`);
    });
    it('manages only frame-ancestors by default, leaving script-src alone', async () => {
      const out = await run({}, { url: INTENT });
      expect(out.csp).not.toContain('script-src');
    });
    it('keeps the directives an existing policy already declared', async () => {
      const out = await run({}, { url: INTENT, existingCsp: "default-src 'self'; img-src *" });
      expect(out.csp).toContain("default-src 'self'");
      expect(out.csp).toContain('img-src *');
      expect(out.csp).toContain('frame-ancestors');
    });
    it('does not touch CSP when manageCsp is false', async () => {
      const out = await run({ manageCsp: false }, { url: INTENT });
      expect(out.body).toContain(MARKER);
      expect(out.csp).toBeNull();
    });
    it('leaves CSP untouched on a request with no preview intent', async () => {
      const out = await run({}, { url: PLAIN, existingCsp: "default-src 'self'" });
      expect(out.csp === null || out.csp === "default-src 'self'").toBe(true);
    });
    it("in 'full' mode, the tag nonce, the script-src nonce and the exposed nonce are one value", async () => {
      const out = await run({ manageCsp: 'full' }, { url: INTENT });
      const nonce = tagNonce(out.body);
      expect(nonce).toBeTruthy();
      expect(out.csp).toMatch(/script-src\s+'self' 'nonce-[A-Za-z0-9_-]+'/u);
      expect(out.csp).toContain(`'nonce-${String(nonce)}'`);
      if (out.nonce !== undefined) expect(out.nonce).toBe(nonce);
    });
    it("in 'full' mode, adds strict-dynamic only when asked", async () => {
      const plain = await run({ manageCsp: 'full' }, { url: INTENT });
      expect(plain.csp).not.toContain("'strict-dynamic'");
    });
  });

  describe(`${harness.name} — conformance: authorization`, () => {
    let context: AuthorizedPreviewContext;
    async function authorized(): Promise<AuthorizedPreviewContext> {
      const result = await authorizePreviewRequest(new Request(INTENT), {
        type: 'verifier',
        verify: () => ({ subject: 'editor' }),
      });
      if (!result.authorized) throw new Error('expected authorization');
      context = result.context;
      return context;
    }
    it('a refused authorization injects nothing, writes no CSP and exposes no nonce', async () => {
      const out = await run({ authorizePreview: () => null }, { url: INTENT });
      expect(out.body).not.toContain(MARKER);
      expect(out.csp).toBeNull();
      expect(out.nonce).toBeUndefined();
    });
    it('an authorized preview injects and manages CSP', async () => {
      const ctx = await authorized();
      const out = await run({ authorizePreview: () => ctx }, { url: INTENT });
      expect(out.body).toContain(MARKER);
      expect(out.csp).toContain('frame-ancestors');
    });
    it('authorization is consulted only once intent is established', async () => {
      const authorizePreview = vi.fn(() => null);
      await run({ authorizePreview }, { url: PLAIN });
      expect(authorizePreview).not.toHaveBeenCalled();
    });
  });
}
