/**
 * Applying a decision to a fetch-style `Response`, and the request-side
 * glue every adapter repeats: hook binding and the manual script tag.
 */

import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import { HTML_CONTENT_TYPE, injectIntoHead } from './html-inject';
import { inlineScriptConfig, type PreviewPolicyOptions } from './policy-options';
import type { PreviewDecision, PreviewDecisionHooks, PreviewPolicy } from './policy';
import type { PreviewAdapterOptions } from './options';

/** The header surface shared by `Headers` and a Node response. */
export interface HeaderSink {
  get(name: string): string | null | undefined;
  set(name: string, value: string): void;
}

/** Bind an adapter's per-request hooks to `request`. */
export function bindDecisionHooks<Req>(
  policy: PreviewPolicy,
  options: Pick<PreviewAdapterOptions<Req>, 'authorizePreview' | 'shouldInject'>,
  request: Req,
): PreviewDecisionHooks {
  return {
    shouldInject: () => options.shouldInject?.(request) ?? true,
    ...(policy.authorizes ? { authorize: () => options.authorizePreview?.(request) } : {}),
  };
}

/** The `<script>` tag for manual embedding, with `nonce` when given. */
export function renderScriptTag(
  options: PreviewPolicyOptions & { readonly nonce?: string },
): string {
  const body = generateInlineScript(inlineScriptConfig(options));
  return wrapWithScriptTag(body, options.nonce !== undefined ? { nonce: options.nonce } : {});
}

/** A changed response must never be stored as the public page, nor shared across sessions. */
export function markUncacheable(headers: HeaderSink): void {
  const cacheControl = headers.get('cache-control') ?? '';
  if (!/\bno-store\b/i.test(cacheControl)) headers.set('cache-control', 'private, no-store');
  const vary = (headers.get('vary') ?? '').trim();
  const listed = vary.split(',').map((token) => token.trim().toLowerCase());
  if (listed.includes('*') || listed.includes('cookie')) return;
  headers.set('vary', vary.length === 0 ? 'Cookie' : `${vary}, Cookie`);
}

/**
 * `response` with the script tag in its `<head>`, untouched when it has no
 * body (204/304/HEAD), is not HTML, or has no `<head>`. Headers describing
 * the old body — length, encoding, ETag — are dropped.
 */
export async function injectIntoResponse(response: Response, scriptTag: string): Promise<Response> {
  if (response.body === null) return response;
  if (!HTML_CONTENT_TYPE.test(response.headers.get('content-type') ?? '')) return response;
  const injected = injectIntoHead(await response.clone().text(), scriptTag);
  if (injected === undefined) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  return new Response(injected, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Run `apply` on the response headers, cloning first when they are immutable (responses passed through from `fetch()`). */
export function withHeaders(response: Response, apply: (headers: Headers) => void): Response {
  try {
    apply(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    apply(headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

/**
 * The header side of a decision on any sink: the merged CSP for its mode,
 * then the cache headers — those also when the mode is off, because an
 * injected body alone already makes the response private.
 */
export function applyCspHeaders(
  headers: HeaderSink,
  policy: PreviewPolicy,
  decision: PreviewDecision,
  nonce: string,
): void {
  const mode = decision.cspMode;
  if (mode !== false) {
    const existing = headers.get('content-security-policy') ?? '';
    headers.set('content-security-policy', policy.csp(existing, nonce, mode));
  }
  markUncacheable(headers);
}

/** Set the merged CSP header for `mode` and mark the response uncacheable. */
export function withCspHeader(
  response: Response,
  policy: PreviewPolicy,
  decision: PreviewDecision,
  nonce: string,
): Response {
  return withHeaders(response, (headers) => {
    applyCspHeaders(headers, policy, decision, nonce);
  });
}

/** Apply a decision end to end: inject, then CSP and cache headers. The response is returned as-is when nothing changes. */
export async function applyDecision(
  response: Response,
  policy: PreviewPolicy,
  decision: PreviewDecision,
  nonce: string,
): Promise<Response> {
  if (!decision.inject && decision.cspMode === false) return response;
  const injected = decision.inject
    ? await injectIntoResponse(response, policy.scriptTag(nonce))
    : response;
  return withCspHeader(injected, policy, decision, nonce);
}
