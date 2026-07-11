/**
 * Next.js adapter for Payload Live Preview.
 *
 * Supports both the App Router and the Pages Router. Provides:
 *
 *   - `createLivePreviewMiddleware(options)` — a request middleware
 *     that injects the inline script into HTML preview responses and
 *     merges CSP headers. Use it in `middleware.ts`:
 *
 *     ```ts
 *     import { createLivePreviewMiddleware } from '@relative23/payload-live-preview/nextjs';
 *     export default createLivePreviewMiddleware({
 *       allowedOrigins: ['https://admin.example.com'],
 *     });
 *     ```
 *
 *   - `renderLivePreviewScript(options)` — returns the inline script
 *     as a string suitable for `<Script>` / `dangerouslySetInnerHTML`.
 *
 * @module @adapters/nextjs
 */

import {
  generateCspNonce,
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  mergeCspHeader,
} from '@security/csp';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import { isPreviewRequest } from '@adapters/shared/preview-request';

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

export type NextMiddleware = (request: Request) => Promise<Response | undefined>;

const HTML_CONTENT_TYPE = /text\/html/i;
const HEAD_INSERT = /<head(\s[^>]*)?>/i;

/**
 * Build a Next.js-compatible middleware operating on the standard
 * `Request` / `Response` pair. Wrap with `NextResponse.next()` in your
 * project to integrate with Next's request pipeline.
 */
export function createLivePreviewMiddleware(
  options: LivePreviewNextOptions = {},
): (request: Request, response: Response) => Promise<Response> {
  let cachedScriptBody: string | undefined;
  const scriptBody = (): string => {
    cachedScriptBody ??= buildScriptBody(options);
    return cachedScriptBody;
  };

  return async (request, response) => {
    const isPreview =
      (options.inject ?? 'preview-only') === 'always' ||
      isPreviewRequest(request, {
        ...(options.previewQueryParams !== undefined
          ? { queryParams: options.previewQueryParams }
          : {}),
        adminOrigins: options.allowedOrigins ?? [],
      });
    if (!isPreview) return response;

    let outResponse = response;
    const apply = (options.autoInject ?? true) && (options.shouldInject?.(request) ?? true);
    const contentType = response.headers.get('content-type') ?? '';
    if (apply && HTML_CONTENT_TYPE.test(contentType)) {
      outResponse = await injectIntoResponse(response, scriptBody());
    }
    const manageCsp = normalizeManageCsp(options.manageCsp);
    if (manageCsp !== false) {
      outResponse = addCsp(outResponse, manageCsp, options);
    }
    return outResponse;
  };
}

/**
 * Render the live-preview `<script>` tag — for embedding manually in
 * App Router or Pages Router layouts.
 */
export function renderLivePreviewScript(
  options: LivePreviewNextOptions & { readonly nonce?: string } = {},
): string {
  const body = generateInlineScript({
    ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.serverURL !== undefined ? { serverURL: options.serverURL } : {}),
    ...(options.apiRoute !== undefined ? { apiRoute: options.apiRoute } : {}),
    ...(options.mergeDepth !== undefined ? { mergeDepth: options.mergeDepth } : {}),
    ...(options.debug !== undefined ? { debug: options.debug } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.nonce !== undefined ? { nonce: options.nonce } : {}),
  });
  return wrapWithScriptTag(body, options.nonce !== undefined ? { nonce: options.nonce } : {});
}

function buildScriptBody(options: LivePreviewNextOptions): string {
  return generateInlineScript({
    ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.serverURL !== undefined ? { serverURL: options.serverURL } : {}),
    ...(options.apiRoute !== undefined ? { apiRoute: options.apiRoute } : {}),
    ...(options.mergeDepth !== undefined ? { mergeDepth: options.mergeDepth } : {}),
    ...(options.debug !== undefined ? { debug: options.debug } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
  });
}

function normalizeManageCsp(
  value: LivePreviewNextOptions['manageCsp'],
): false | 'frame-ancestors' | 'full' {
  if (value === false) return false;
  if (value === 'full') return 'full';
  return 'frame-ancestors';
}

async function injectIntoResponse(response: Response, body: string): Promise<Response> {
  const nonce = response.headers.get('x-live-preview-nonce') ?? generateCspNonce();
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('x-live-preview-nonce', nonce);

  // Fragment responses without a <head> are skipped, not prepended to.
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

function addCsp(
  response: Response,
  mode: 'frame-ancestors' | 'full',
  options: LivePreviewNextOptions,
): Response {
  const nonce = response.headers.get('x-live-preview-nonce') ?? generateCspNonce();
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
    response.headers.set('x-live-preview-nonce', nonce);
    response.headers.set('content-security-policy', next);
    return response;
  } catch {
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
