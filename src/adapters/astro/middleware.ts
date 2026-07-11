/**
 * Astro middleware for Payload Live Preview.
 *
 * Responsibilities (per request):
 *
 *   1. Generate a per-response CSP nonce and stash it on
 *      `Astro.locals.livePreviewNonce` so consumers can reference it.
 *   2. On **preview requests only** (see `isPreviewRequest`), rewrite
 *      the HTML response to inject the live-preview `<script>` tag.
 *      Normal production traffic streams through untouched — no
 *      buffering, no extra bytes.
 *   3. On preview requests, merge `frame-ancestors` into the
 *      `Content-Security-Policy` header so the Payload admin may embed
 *      the page. Full `script-src` nonce management is opt-in via
 *      `manageCsp: 'full'`.
 *
 * Prerendered pages are skipped entirely: Astro runs middleware at
 * build time for those, where per-request nonces and response headers
 * are meaningless.
 *
 * @module @adapters/astro/middleware
 */

import {
  generateCspNonce,
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  mergeCspHeader,
} from '@security/csp';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import { isPreviewRequest } from '@adapters/shared/preview-request';
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

const HTML_CONTENT_TYPE = /text\/html/i;
const HEAD_INSERT = /<head(\s[^>]*)?>/i;

/**
 * Build the Astro-compatible middleware. Register it in
 * `src/middleware.ts`:
 *
 * ```ts
 * import { createLivePreviewMiddleware } from 'payload-live-preview/astro';
 * export const onRequest = createLivePreviewMiddleware({
 *   allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
 * });
 * ```
 */
export function createLivePreviewMiddleware(
  options: LivePreviewAstroOptions = {},
): LivePreviewMiddleware {
  const allowedOrigins = options.allowedOrigins ?? [];
  const autoInject = options.autoInject ?? true;
  const injectMode = options.inject ?? 'preview-only';
  const manageCsp = normalizeManageCsp(options.manageCsp);
  const shouldInject = options.shouldInject;

  // The script body is configuration-static (the nonce only decorates
  // the surrounding tag) — generate it once, not per request.
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

  return async (context, next) => {
    const nonce = generateCspNonce();
    context.locals[NONCE_LOCALS_KEY] = nonce;

    const response = await next();

    // Build-time prerendering: no meaningful request headers, no
    // response headers in the static output, and a baked-forever nonce.
    if (context.isPrerendered === true) return response;

    const isPreview =
      injectMode === 'always' ||
      isPreviewRequest(context.request, {
        ...(options.previewQueryParams !== undefined
          ? { queryParams: options.previewQueryParams }
          : {}),
        ...(options.previewSignals !== undefined ? { signals: options.previewSignals } : {}),
        adminOrigins: allowedOrigins,
      });
    if (!isPreview) return response;

    let outResponse = response;

    const contentType = response.headers.get('content-type') ?? '';
    const apply = autoInject && (shouldInject?.(context.request) ?? true);
    if (apply && HTML_CONTENT_TYPE.test(contentType)) {
      outResponse = await injectScript(response, nonce, scriptBody());
    }

    if (manageCsp !== false) {
      outResponse = applyCspHeaders(outResponse, nonce, allowedOrigins, manageCsp, options);
    }

    return outResponse;
  };
}

function normalizeManageCsp(
  value: LivePreviewAstroOptions['manageCsp'],
): false | 'frame-ancestors' | 'full' {
  if (value === false) return false;
  if (value === 'full') return 'full';
  // `true` (legacy) and `undefined` both mean the safe default.
  return 'frame-ancestors';
}

async function injectScript(response: Response, nonce: string, body: string): Promise<Response> {
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('content-length');

  // Fragment responses (server islands, page partials) have no <head>;
  // injecting a 50 KB runtime into each of them would corrupt every
  // fragment for zero benefit — the full document already carries it.
  if (!HEAD_INSERT.test(html)) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const scriptTag = wrapWithScriptTag(body, { nonce });
  const out = html.replace(HEAD_INSERT, (match) => `${match}${scriptTag}`);
  return new Response(out, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function applyCspHeaders(
  response: Response,
  nonce: string,
  allowedOrigins: readonly string[],
  mode: 'frame-ancestors' | 'full',
  options: LivePreviewAstroOptions,
): Response {
  const frameAncestors = buildFrameAncestors({
    self: true,
    origins: [...allowedOrigins, ...(options.frameAncestorsExtra ?? [])],
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
