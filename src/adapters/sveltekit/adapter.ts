/**
 * SvelteKit adapter for Payload Live Preview.
 *
 * Exposes a `handle` hook compatible with SvelteKit's `hooks.server.ts`:
 *
 * ```ts
 * import { livePreviewHandle } from 'payload-live-preview/sveltekit';
 *
 * export const handle = livePreviewHandle({
 *   allowedOrigins: ['https://admin.example.com'],
 * });
 * ```
 *
 * For projects that already use `sequence(...)`, compose the returned
 * handle with the others; it never short-circuits the chain.
 *
 * The built-in signals detect preview intent only. They do not
 * authenticate the request. Place application-owned server
 * authorization around this handle and invoke it only after success
 * when draft data, credentials, private cache policy, CSP changes, or
 * runtime injection are gated.
 *
 * @module @adapters/sveltekit
 */

import {
  createPreviewPolicy,
  injectIntoHead,
  type CspMode,
  type PreviewPolicy,
} from '@adapters/shared/policy';

export interface LivePreviewSvelteKitOptions {
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
}

interface SvelteKitRequestEvent {
  readonly request: Request;
  readonly locals: Record<string, unknown>;
}
interface ResolveOptions {
  readonly transformPageChunk?: (input: { html: string; done: boolean }) => string | undefined;
}
type SvelteKitResolve = (event: SvelteKitRequestEvent, opts?: ResolveOptions) => Promise<Response>;
export type SvelteKitHandle = (input: {
  readonly event: SvelteKitRequestEvent;
  readonly resolve: SvelteKitResolve;
}) => Promise<Response>;

/**
 * Build a SvelteKit `handle` hook. The hook:
 *
 *   1. Generates a CSP nonce and writes it to `event.locals.livePreviewNonce`
 *      so consumer-rendered scripts can read it from the load function.
 *   2. On requests carrying preview intent, uses
 *      `resolve(..., { transformPageChunk })`
 *      to inject the script into the `<head>` of the HTML response.
 *   3. Merges the `Content-Security-Policy` header on those responses.
 *
 * Call this handle only after application-owned authorization when
 * those response mutations are privileged. `shouldInject` is not an
 * authorization boundary and does not disable CSP handling.
 */
export function livePreviewHandle(options: LivePreviewSvelteKitOptions = {}): SvelteKitHandle {
  const policy = createPreviewPolicy(options);
  return async ({ event, resolve }) => {
    const nonce = policy.nonce();
    event.locals['livePreviewNonce'] = nonce;
    const decision = policy.decide(
      event.request,
      () => options.shouldInject?.(event.request) ?? true,
    );
    const transform = decision.inject ? chunk(policy, nonce) : undefined;
    const response = await resolve(
      event,
      transform !== undefined ? { transformPageChunk: transform } : {},
    );
    if (decision.cspMode !== false) {
      return applyCsp(response, policy, decision.cspMode, nonce);
    }
    return response;
  };
}

type ChunkTransform = NonNullable<ResolveOptions['transformPageChunk']>;
/** transformPageChunk is called per chunk; only the one carrying `<head>` is touched. */
function chunk(policy: PreviewPolicy, nonce: string): ChunkTransform {
  const tag = policy.scriptTag(nonce);
  return ({ html }) => injectIntoHead(html, tag);
}

function applyCsp(
  response: Response,
  policy: PreviewPolicy,
  mode: Exclude<CspMode, false>,
  nonce: string,
): Response {
  const previous = response.headers.get('content-security-policy') ?? '';
  const next = policy.csp(previous, nonce, mode);
  try {
    response.headers.set('content-security-policy', next);
    return response;
  } catch {
    // Adapter responses can arrive with an immutable header guard.
    const headers = new Headers(response.headers);
    headers.set('content-security-policy', next);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
