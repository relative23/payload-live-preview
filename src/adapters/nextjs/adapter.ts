/**
 * Next.js adapter for Payload Live Preview.
 *
 * ⚠️ Scope: this package patches server-rendered/static DOM. For
 * client-rendered React trees prefer the official
 * `@payloadcms/live-preview-react` (`useLivePreview`) — React
 * re-renders can revert DOM patches made here.
 *
 * Provides:
 *
 *   - `renderLivePreviewScript(options)` / `generateInlineScript` —
 *     embed the script in your root layout via
 *     `<script dangerouslySetInnerHTML>`. This is the PRIMARY wiring
 *     for Next.js: standard middleware cannot inject into the HTML
 *     body because `NextResponse.next()` carries no body.
 *
 *   - `createLivePreviewMiddleware(options)` — merges CSP headers
 *     (`frame-ancestors`) onto responses carrying preview intent. Its
 *     script-injection path only activates when you pass it a
 *     `Response` that actually carries an HTML body (custom servers,
 *     route handlers returning HTML) — in standard `middleware.ts`
 *     use `autoInject: false`.
 *
 * Preview intent is not authorization. Run application-owned server
 * authentication first and use its result to gate draft data, cache
 * policy, privileged headers, CSP changes, and script rendering.
 *
 * @module @adapters/nextjs
 */

import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import {
  HTML_CONTENT_TYPE,
  createPreviewPolicy,
  injectIntoHead,
  inlineScriptConfig,
  type CspMode,
  type PreviewAuthorizationHookResult,
  type PreviewPolicy,
} from '@adapters/shared/policy';
import type { DefaultsProfile } from '@core/defaults-profile';

export interface LivePreviewNextOptions {
  readonly allowedOrigins?: readonly string[];
  /** Payload server origin for REST data merging (Payload 3.x). */
  readonly serverURL?: string;
  /** REST API route prefix used with `serverURL`. Defaults to `/api`. */
  readonly apiRoute?: string;
  /** Population depth used with `serverURL`. Defaults to `1`. */
  readonly mergeDepth?: number;
  readonly autoInject?: boolean;
  /**
   * `'preview-only'` (default) — inject only into responses carrying
   * preview intent. The signals are client-controlled and do not
   * authorize access. `'always'` — every HTML response.
   */
  readonly inject?: 'preview-only' | 'always';
  /** Query params that signal preview intent. Default `['preview', 'draft', 'livePreview']`. */
  readonly previewQueryParams?: readonly string[];
  /** Which signals count as preview intent. Default: query, fetch-dest, referer. */
  readonly previewSignals?: readonly ('query' | 'fetch-dest' | 'referer')[];
  /**
   * Synchronous route/content filter for script injection only. It is
   * not authentication and does not suppress CSP handling.
   */
  readonly shouldInject?: (request: Request) => boolean;
  /**
   * CSP management: `'frame-ancestors'` (default) merges only the
   * embed permission; `'full'` also manages a nonce'd `script-src`;
   * `false` never touches CSP. `true` is a legacy alias for
   * `'frame-ancestors'`.
   */
  readonly manageCsp?: boolean | 'frame-ancestors' | 'full';
  /** Add `'strict-dynamic'` to the managed `script-src`. Default `false`. */
  readonly strictDynamic?: boolean;
  readonly frameAncestorsExtra?: readonly string[];
  readonly scriptSrcExtra?: readonly string[];
  readonly debug?: boolean;
  readonly debounceMs?: number;
  /** Heartbeat timeout in ms. Default `0` (disabled). */
  readonly heartbeatMs?: number;
  /** Skip bindings whose value is identical to the one last applied. Default `false`. */
  readonly skipUnchanged?: boolean;

  /**
   * Verify that the request is an authorized preview before anything
   * privileged is decided. Called only on requests with preview intent.
   * Return the result of `authorizePreviewRequest()` (or the context it
   * carries); anything else refuses, and a refusal blocks runtime injection,
   * CSP changes and nonce exposure regardless of `autoInject` and
   * `shouldInject`. Without this hook the adapter gates on intent alone, as
   * it did in 1.0 — announced once per process outside production.
   * ADR 0006 records the threat model.
   */
  readonly authorizePreview?: (
    request: Request,
  ) => PreviewAuthorizationHookResult | Promise<PreviewAuthorizationHookResult>;

  /**
   * Refuse insecure configuration at startup: requires `authorizePreview`,
   * explicit non-empty `allowedOrigins` (https outside development), and no
   * referrer trust. Implied by `defaults: 'v2'`.
   */
  readonly strict?: boolean;

  /**
   * `'v2'` applies every 2.0 default that exists as a 1.x option at once —
   * the readiness table in ADR 0007. Explicit options override the profile.
   */
  readonly defaults?: DefaultsProfile;
}

export type NextMiddleware = (request: Request) => Promise<Response | undefined>;

/**
 * Build a Next.js-compatible middleware operating on the standard
 * `Request` / `Response` pair. Wrap with `NextResponse.next()` in your
 * project to integrate with Next's request pipeline. Invoke it only
 * after application-owned authorization when its response mutations
 * are privileged.
 */
export function createLivePreviewMiddleware(
  options: LivePreviewNextOptions = {},
): (request: Request, response: Response) => Promise<Response> {
  const policy = createPreviewPolicy(options);
  return async (request, response) => {
    const decision = await policy.decide(request, {
      shouldInject: () => options.shouldInject?.(request) ?? true,
      ...(policy.authorizes ? { authorize: () => options.authorizePreview?.(request) } : {}),
    });
    if (!decision.isPreview) return response;
    let outResponse = response;
    const contentType = response.headers.get('content-type') ?? '';
    if (decision.inject && HTML_CONTENT_TYPE.test(contentType)) {
      outResponse = await injectIntoResponse(response, policy);
    }
    if (decision.cspMode !== false) {
      outResponse = addCsp(outResponse, decision.cspMode, policy);
    }
    return outResponse;
  };
}

/**
 * Render the `<script>` tag for manual insertion (e.g. in `app/layout.tsx`)
 * when the middleware's automatic injection is disabled. Pass the nonce
 * your CSP uses so the tag is permitted under it.
 */
export function renderLivePreviewScript(
  options: LivePreviewNextOptions & { readonly nonce?: string } = {},
): string {
  const body = generateInlineScript(inlineScriptConfig(options));
  return wrapWithScriptTag(body, options.nonce !== undefined ? { nonce: options.nonce } : {});
}

/**
 * The nonce a response already carries, or a fresh one. Injection and CSP
 * run as two steps on the same response; the header is how the second
 * step learns the nonce the first one stamped into the script tag.
 */
function nonceFor(response: Response, policy: PreviewPolicy): string {
  return response.headers.get('x-live-preview-nonce') ?? policy.nonce();
}

async function injectIntoResponse(response: Response, policy: PreviewPolicy): Promise<Response> {
  const nonce = nonceFor(response, policy);
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('x-live-preview-nonce', nonce);
  // Fragment responses without a <head> are skipped, not prepended to.
  const injected = injectIntoHead(html, policy.scriptTag(nonce));
  return new Response(injected ?? html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function addCsp(
  response: Response,
  mode: Exclude<CspMode, false>,
  policy: PreviewPolicy,
): Response {
  const nonce = nonceFor(response, policy);
  const previous = response.headers.get('content-security-policy') ?? '';
  const next = policy.csp(previous, nonce, mode);
  try {
    response.headers.set('x-live-preview-nonce', nonce);
    response.headers.set('content-security-policy', next);
    return response;
  } catch {
    // Responses passed through from `fetch()` can carry immutable headers.
    const headers = new Headers(response.headers);
    headers.set('x-live-preview-nonce', nonce);
    headers.set('content-security-policy', next);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
