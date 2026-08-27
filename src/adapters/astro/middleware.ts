/**
 * Astro middleware for Payload Live Preview.
 *
 * Responsibilities (per request):
 *
 *   1. Generate a per-response CSP nonce and stash it on
 *      `Astro.locals.livePreviewNonce` so consumers can reference it.
 *   2. On requests carrying **preview intent** (see
 *      `isPreviewRequest`), rewrite the HTML response to inject the
 *      live-preview `<script>` tag.
 *   3. On those requests, merge `frame-ancestors` into the
 *      `Content-Security-Policy` header so the Payload admin may embed
 *      the page. Full `script-src` nonce management is opt-in via
 *      `manageCsp: 'full'`.
 *
 * The intent signals are client-controlled and this middleware does
 * not authenticate them. For protected preview responses, first verify
 * an application-owned server session or short-lived authorization,
 * then invoke this middleware with that same decision also governing
 * draft reads, credentials, and cache policy. `shouldInject` filters
 * script insertion only; it is not an authorization boundary and does
 * not disable CSP handling.
 *
 * Prerendered pages are skipped entirely: Astro runs middleware at
 * build time for those, where per-request nonces and response headers
 * are meaningless.
 *
 * @module @adapters/astro/middleware
 */

import {
  HTML_CONTENT_TYPE,
  createPreviewPolicy,
  injectIntoHead,
  type CspMode,
  type PreviewPolicy,
} from '@adapters/shared/policy';
import type { LivePreviewAstroOptions } from './types';

// Astro type imports are deferred via a local declaration so consumers
// without Astro installed (e.g., type-checking the library itself) can
// still build the adapter. At runtime the function signature matches.
type MiddlewareNext = () => Promise<Response>;
interface MiddlewareContext {
  readonly request: Request;
  readonly locals: Record<string, unknown>;
  /** Present in Astro ≥ 5: `true` while prerendering at build time. */
  readonly isPrerendered?: boolean;
}
export type LivePreviewMiddleware = (
  context: MiddlewareContext,
  next: MiddlewareNext,
) => Promise<Response>;

/**
 * Key on `Astro.locals` carrying the request-scoped nonce. Consumers
 * can read `Astro.locals.livePreviewNonce` from `.astro` templates to
 * set the `nonce` attribute on their own scripts.
 */
export const NONCE_LOCALS_KEY = 'livePreviewNonce';

/**
 * Key on `Astro.locals` carrying the verified `AuthorizedPreviewContext`
 * when `authorizePreview` authorized this request, and absent otherwise.
 * Pages pass it to `fetchPreviewDocument({ authorization })` and
 * `createPreviewBindings({ authorization })`.
 */
export const AUTHORIZATION_LOCALS_KEY = 'livePreviewAuthorization';

/**
 * Build the Astro middleware. It generates a nonce for every request (so
 * consumer templates can read `Astro.locals.livePreviewNonce` whether or not
 * this is a preview), and on requests carrying preview intent injects the
 * runtime into the HTML response and merges the CSP header. Prerendered
 * responses are left alone: there is no request to decide for at build time.
 */
export function createLivePreviewMiddleware(
  options: LivePreviewAstroOptions = {},
): LivePreviewMiddleware {
  const policy = createPreviewPolicy(options);
  return async (context, next) => {
    const nonce = policy.nonce();
    if (context.isPrerendered === true) {
      context.locals[NONCE_LOCALS_KEY] = nonce;
      return next();
    }
    const decision = await policy.decide(context.request, {
      shouldInject: () => options.shouldInject?.(context.request) ?? true,
      ...(policy.authorizes
        ? { authorize: () => options.authorizePreview?.(context.request) }
        : {}),
    });
    // The nonce is decided before rendering so templates can read it from
    // `Astro.locals`; after a refusal it is withheld, like every other
    // preview artefact of that response.
    if (decision.exposeNonce || !decision.isPreview) {
      context.locals[NONCE_LOCALS_KEY] = nonce;
    }
    if (decision.authorization !== null) {
      context.locals[AUTHORIZATION_LOCALS_KEY] = decision.authorization;
    }
    const response = await next();
    if (!decision.isPreview) return response;
    let outResponse = response;
    const contentType = response.headers.get('content-type') ?? '';
    if (decision.inject && HTML_CONTENT_TYPE.test(contentType)) {
      outResponse = await injectScript(response, policy.scriptTag(nonce));
    }
    if (decision.cspMode !== false) {
      outResponse = applyCspHeaders(outResponse, policy, nonce, decision.cspMode);
    }
    return outResponse;
  };
}

async function injectScript(response: Response, scriptTag: string): Promise<Response> {
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  // A document without a <head> is passed through unchanged, not prepended to.
  const injected = injectIntoHead(html, scriptTag);
  return new Response(injected ?? html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function applyCspHeaders(
  response: Response,
  policy: PreviewPolicy,
  nonce: string,
  mode: Exclude<CspMode, false>,
): Response {
  const previous = response.headers.get('content-security-policy') ?? '';
  const next = policy.csp(previous, nonce, mode);
  // Responses passed through from `fetch()` can carry immutable
  // headers — clone into a mutable Response instead of mutating.
  try {
    response.headers.set('content-security-policy', next);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set('content-security-policy', next);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
