/**
 * SvelteKit adapter for Payload Live Preview.
 *
 * Exposes a `handle` hook compatible with SvelteKit's `hooks.server.ts`:
 *
 * ```ts
 * import { livePreviewHandle } from '@relative23/payload-live-preview/sveltekit';
 *
 * export const handle = livePreviewHandle({
 *   allowedOrigins: ['https://admin.example.com'],
 * });
 * ```
 *
 * For projects that already use `sequence(...)`, compose the returned
 * handle with the others; it never short-circuits the chain.
 *
 * @module @adapters/sveltekit
 */

import {
  generateCspNonce,
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  mergeCspHeader,
} from '@security/csp';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import { isPreviewRequest } from '@adapters/shared/preview-request';

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
   * `'preview-only'` (default) — inject only into responses that look
   * like preview requests. `'always'` — every HTML response.
   */
  readonly inject?: 'preview-only' | 'always';
  /** Query params that mark a preview request. Default `['preview', 'draft', 'livePreview']`. */
  readonly previewQueryParams?: readonly string[];
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

const HEAD_INSERT = /<head(\s[^>]*)?>/i;

/**
 * Build a SvelteKit `handle` hook. The hook:
 *
 *   1. Generates a CSP nonce and writes it to `event.locals.livePreviewNonce`
 *      so consumer-rendered scripts can read it from the load function.
 *   2. On preview requests, uses `resolve(..., { transformPageChunk })`
 *      to inject the script into the `<head>` of the HTML response.
 *   3. Merges the `Content-Security-Policy` header on preview responses.
 */
export function livePreviewHandle(options: LivePreviewSvelteKitOptions = {}): SvelteKitHandle {
  let cachedScriptBody: string | undefined;
  const scriptBody = (): string => {
    cachedScriptBody ??= generateInlineScript({
      ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
      ...(options.serverURL !== undefined ? { serverURL: options.serverURL } : {}),
      ...(options.apiRoute !== undefined ? { apiRoute: options.apiRoute } : {}),
      ...(options.mergeDepth !== undefined ? { mergeDepth: options.mergeDepth } : {}),
      ...(options.debug !== undefined ? { debug: options.debug } : {}),
      ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
      ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    });
    return cachedScriptBody;
  };

  return async ({ event, resolve }) => {
    const nonce = generateCspNonce();
    event.locals['livePreviewNonce'] = nonce;

    const isPreview =
      (options.inject ?? 'preview-only') === 'always' ||
      isPreviewRequest(event.request, {
        ...(options.previewQueryParams !== undefined
          ? { queryParams: options.previewQueryParams }
          : {}),
        adminOrigins: options.allowedOrigins ?? [],
      });

    const apply =
      isPreview &&
      (options.autoInject ?? true) &&
      (options.shouldInject?.(event.request) ?? true);
    const transform = apply ? chunk(scriptBody(), nonce) : undefined;
    const response = await resolve(
      event,
      transform !== undefined ? { transformPageChunk: transform } : {},
    );
    const manageCsp = normalizeManageCsp(options.manageCsp);
    if (isPreview && manageCsp !== false) {
      return applyCsp(response, options, manageCsp, nonce);
    }
    return response;
  };
}

function normalizeManageCsp(
  value: LivePreviewSvelteKitOptions['manageCsp'],
): false | 'frame-ancestors' | 'full' {
  if (value === false) return false;
  if (value === 'full') return 'full';
  return 'frame-ancestors';
}

type ChunkTransform = NonNullable<ResolveOptions['transformPageChunk']>;
function chunk(body: string, nonce: string): ChunkTransform {
  return ({ html }) => {
    if (!HEAD_INSERT.test(html)) return undefined;
    const tag = wrapWithScriptTag(body, { nonce });
    return html.replace(HEAD_INSERT, (m) => `${m}${tag}`);
  };
}

function applyCsp(
  response: Response,
  options: LivePreviewSvelteKitOptions,
  mode: 'frame-ancestors' | 'full',
  nonce: string,
): Response {
  const frameAncestors = buildFrameAncestors({
    self: true,
    origins: [...(options.allowedOrigins ?? []), ...(options.frameAncestorsExtra ?? [])],
  });
  const additions: Record<string, string> = { 'frame-ancestors': frameAncestors };
  if (mode === 'full') {
    additions['script-src'] = buildScriptSrcWithNonce(nonce, {
      self: true,
      strictDynamic: options.strictDynamic ?? false,
      ...(options.scriptSrcExtra !== undefined ? { extra: options.scriptSrcExtra } : {}),
    });
  }
  const previous = response.headers.get('content-security-policy') ?? '';
  const next = mergeCspHeader(previous, additions);
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
