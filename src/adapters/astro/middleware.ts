/**
 * Astro middleware for Payload Live Preview.
 *
 * Responsibilities (per request):
 *
 *   1. Generate a per-response CSP nonce and stash it on
 *      `Astro.locals.livePreviewNonce` so the inline script can
 *      reference it.
 *   2. Optionally rewrite the HTML response to inject the live-preview
 *      `<script>` tag with the same nonce. We do this only for
 *      `text/html` responses on the configured paths.
 *   3. Add the `Content-Security-Policy` headers (`frame-ancestors`,
 *      `script-src`) so the preview can be embedded by the Payload
 *      admin without weakening the policy.
 *
 * The middleware is framework-typed via Astro's `MiddlewareHandler`,
 * imported as `type` only so the adapter compiles even when Astro is
 * not installed.
 *
 * @module @adapters/astro/middleware
 */

import { generateCspNonce, buildFrameAncestors, buildScriptSrcWithNonce } from '@security/csp';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import type { LivePreviewAstroOptions } from './types';

// Astro type imports are deferred via a local declaration so consumers
// without Astro installed (e.g., type-checking the library itself) can
// still build the adapter. At runtime the function signature matches.
type MiddlewareNext = () => Promise<Response>;
interface MiddlewareContext {
  readonly request: Request;
  readonly locals: Record<string, unknown>;
}
export type LivePreviewMiddleware = (
  context: MiddlewareContext,
  next: MiddlewareNext,
) => Promise<Response>;

/**
 * Symbol stored on `Astro.locals` carrying the request-scoped nonce.
 * Consumers can read `Astro.locals.livePreviewNonce` from within
 * `.astro` templates to set the `nonce` attribute on their own
 * scripts.
 */
export const NONCE_LOCALS_KEY = 'livePreviewNonce';

const HTML_CONTENT_TYPE = /text\/html/i;
const HEAD_INSERT = /<head(\s[^>]*)?>/i;

/**
 * Build the Astro-compatible middleware.
 */
export function createLivePreviewMiddleware(
  options: LivePreviewAstroOptions = {},
): LivePreviewMiddleware {
  const allowedOrigins = options.allowedOrigins ?? [];
  const autoInject = options.autoInject ?? true;
  const manageCsp = options.manageCsp ?? true;
  const shouldInject = options.shouldInject;

  return async (context, next) => {
    const nonce = generateCspNonce();
    context.locals[NONCE_LOCALS_KEY] = nonce;

    const response = await next();

    const apply = autoInject && (shouldInject?.(context.request) ?? true);
    let outResponse = response;

    const contentType = response.headers.get('content-type') ?? '';
    if (apply && HTML_CONTENT_TYPE.test(contentType)) {
      outResponse = await injectScript(response, nonce, options);
    }

    if (manageCsp) {
      applyCspHeaders(outResponse, nonce, allowedOrigins, options);
    }

    return outResponse;
  };
}

async function injectScript(
  response: Response,
  nonce: string,
  options: LivePreviewAstroOptions,
): Promise<Response> {
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
  options: LivePreviewAstroOptions,
): void {
  const frameAncestors = buildFrameAncestors({
    self: true,
    origins: [...allowedOrigins, ...(options.frameAncestorsExtra ?? [])],
  });
  const scriptSrc = buildScriptSrcWithNonce(nonce, {
    self: true,
    ...(options.scriptSrcExtra !== undefined ? { extra: options.scriptSrcExtra } : {}),
  });

  const previous = response.headers.get('content-security-policy') ?? '';
  const next = mergeCspDirectives(previous, {
    'frame-ancestors': frameAncestors,
    'script-src': scriptSrc,
  });
  response.headers.set('content-security-policy', next);
}

function mergeCspDirectives(existing: string, override: Readonly<Record<string, string>>): string {
  const directives = new Map<string, string>();
  for (const part of existing.split(';')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex < 0) {
      directives.set(trimmed.toLowerCase(), '');
      continue;
    }
    const name = trimmed.slice(0, spaceIndex).toLowerCase();
    const value = trimmed.slice(spaceIndex + 1).trim();
    directives.set(name, value);
  }
  for (const [name, value] of Object.entries(override)) {
    directives.set(name.toLowerCase(), value);
  }
  const out: string[] = [];
  for (const [name, value] of directives) {
    out.push(value.length === 0 ? name : `${name} ${value}`);
  }
  return out.join('; ');
}
