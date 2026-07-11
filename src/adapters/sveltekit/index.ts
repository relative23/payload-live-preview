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

import { generateCspNonce, buildFrameAncestors, buildScriptSrcWithNonce } from '@security/csp';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';

export interface LivePreviewSvelteKitOptions {
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
 *   2. Uses `resolve(..., { transformPageChunk })` to inject the script
 *      into the `<head>` of every HTML response — but only when
 *      `autoInject` is on and `shouldInject` (if provided) returns true.
 *   3. Adds the merged `Content-Security-Policy` header to the response.
 */
export function livePreviewHandle(options: LivePreviewSvelteKitOptions = {}): SvelteKitHandle {
  return async ({ event, resolve }) => {
    const nonce = generateCspNonce();
    event.locals['livePreviewNonce'] = nonce;
    const apply = (options.autoInject ?? true) && (options.shouldInject?.(event.request) ?? true);
    const transform = apply ? chunk(options, nonce) : undefined;
    const response = await resolve(
      event,
      transform !== undefined ? { transformPageChunk: transform } : {},
    );
    if (options.manageCsp ?? true) applyCsp(response, options, nonce);
    return response;
  };
}

type ChunkTransform = NonNullable<ResolveOptions['transformPageChunk']>;
function chunk(options: LivePreviewSvelteKitOptions, nonce: string): ChunkTransform {
  return ({ html }) => {
    if (!HEAD_INSERT.test(html)) return undefined;
    const body = generateInlineScript({
      ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
      ...(options.debug !== undefined ? { debug: options.debug } : {}),
      ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
      ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
      nonce,
    });
    const tag = wrapWithScriptTag(body, { nonce });
    return html.replace(HEAD_INSERT, (m) => `${m}${tag}`);
  };
}

function applyCsp(response: Response, options: LivePreviewSvelteKitOptions, nonce: string): void {
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
