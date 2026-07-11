/**
 * Next.js adapter for Payload Live Preview.
 *
 * Supports both the App Router and the Pages Router. Provides:
 *
 *   - `createLivePreviewMiddleware(options)` — a request middleware
 *     that injects the inline script into HTML responses and adds
 *     per-request CSP nonce + headers. Use it in `middleware.ts`:
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

import { generateCspNonce, buildFrameAncestors, buildScriptSrcWithNonce } from '@security/csp';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';

export interface LivePreviewNextOptions {
  readonly allowedOrigins?: readonly string[];
  readonly autoInject?: boolean;
  readonly shouldInject?: (request: Request) => boolean;
  readonly manageCsp?: boolean;
  readonly frameAncestorsExtra?: readonly string[];
  readonly scriptSrcExtra?: readonly string[];
  readonly debug?: boolean;
  readonly debounceMs?: number;
  readonly heartbeatMs?: number;
}

export type NextMiddleware = (request: Request) => Promise<Response | undefined>;

const HTML_CONTENT_TYPE = /text\/html/i;
const HEAD_INSERT = /<head(\s[^>]*)?>/i;

/**
 * Build a Next.js-compatible middleware. The function returns
 * `undefined` for non-HTML responses (so Next continues to its
 * default handler).
 *
 * Wrap with `NextResponse.next()` in your project to integrate with
 * Next's request pipeline — the middleware itself is framework-agnostic
 * because it operates on the standard `Request` / `Response`.
 */
export function createLivePreviewMiddleware(
  options: LivePreviewNextOptions = {},
): (request: Request, response: Response) => Promise<Response> {
  return async (request, response) => {
    if (options.manageCsp ?? true) {
      addCsp(response, request, options);
    }
    const apply = (options.autoInject ?? true) && (options.shouldInject?.(request) ?? true);
    if (!apply) return response;
    const contentType = response.headers.get('content-type') ?? '';
    if (!HTML_CONTENT_TYPE.test(contentType)) return response;
    return injectIntoResponse(response, options);
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
    ...(options.debug !== undefined ? { debug: options.debug } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.nonce !== undefined ? { nonce: options.nonce } : {}),
  });
  return wrapWithScriptTag(body, options.nonce !== undefined ? { nonce: options.nonce } : {});
}

async function injectIntoResponse(
  response: Response,
  options: LivePreviewNextOptions,
): Promise<Response> {
  const nonce = response.headers.get('x-live-preview-nonce') ?? generateCspNonce();
  const html = await response.text();
  const body = generateInlineScript({
    ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.debug !== undefined ? { debug: options.debug } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    nonce,
  });
  const scriptTag = wrapWithScriptTag(body, { nonce });
  const out = HEAD_INSERT.test(html)
    ? html.replace(HEAD_INSERT, (match) => `${match}${scriptTag}`)
    : `${scriptTag}${html}`;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('x-live-preview-nonce', nonce);
  return new Response(out, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function addCsp(response: Response, _request: Request, options: LivePreviewNextOptions): void {
  const nonce = response.headers.get('x-live-preview-nonce') ?? generateCspNonce();
  response.headers.set('x-live-preview-nonce', nonce);
  const frameAncestors = buildFrameAncestors({
    self: true,
    origins: [...(options.allowedOrigins ?? []), ...(options.frameAncestorsExtra ?? [])],
  });
  const scriptSrc = buildScriptSrcWithNonce(nonce, {
    self: true,
    ...(options.scriptSrcExtra !== undefined ? { extra: options.scriptSrcExtra } : {}),
  });
  const previous = response.headers.get('content-security-policy') ?? '';
  response.headers.set(
    'content-security-policy',
    mergeCsp(previous, { 'frame-ancestors': frameAncestors, 'script-src': scriptSrc }),
  );
}

function mergeCsp(existing: string, override: Readonly<Record<string, string>>): string {
  const directives = new Map<string, string>();
  for (const part of existing.split(';')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const idx = trimmed.indexOf(' ');
    if (idx < 0) {
      directives.set(trimmed.toLowerCase(), '');
      continue;
    }
    directives.set(trimmed.slice(0, idx).toLowerCase(), trimmed.slice(idx + 1).trim());
  }
  for (const [name, value] of Object.entries(override)) {
    directives.set(name.toLowerCase(), value);
  }
  return [...directives]
    .map(([name, value]) => (value.length === 0 ? name : `${name} ${value}`))
    .join('; ');
}
