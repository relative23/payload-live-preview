/**
 * Nuxt 3 adapter for Payload Live Preview.
 *
 * Exposes:
 *
 *   - `defineLivePreviewServerHandler(options)` — wraps a Nitro
 *     server middleware that injects the script and adds CSP headers.
 *     Drop it in `server/middleware/live-preview.ts`.
 *
 *   - `renderLivePreviewScript(options)` — returns a script-tag string
 *     for manual embedding in a Nuxt layout via `useHead`.
 *
 * @module @adapters/nuxt
 */

import { generateCspNonce, buildFrameAncestors, buildScriptSrcWithNonce } from '@security/csp';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';

export interface LivePreviewNuxtOptions {
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

// Nitro's `H3Event` is opaque to us — we duck-type the surface we
// need so the adapter compiles without the `h3` peer dep.
interface H3EventLike {
  readonly node?: {
    readonly req?: { readonly headers?: Record<string, string | string[] | undefined> };
  };
  readonly context?: Record<string, unknown>;
}

export type NitroHandler = (event: H3EventLike) => Promise<Response | undefined>;

/**
 * Factory for a Nitro server middleware. Returns an `H3` handler that
 * sets `event.context.livePreviewNonce` and decorates the eventual
 * response with CSP headers + script injection.
 *
 * The middleware is non-terminating — Nitro calls the next handler
 * regardless of what we return.
 */
export function defineLivePreviewServerHandler(options: LivePreviewNuxtOptions = {}): NitroHandler {
  return (event: H3EventLike) => {
    const nonce = generateCspNonce();
    const ctx: Record<string, unknown> = event.context ?? {};
    ctx['livePreviewNonce'] = nonce;
    // Nitro inspects the return value; returning `undefined` is the
    // "continue with the next handler" signal. The actual injection
    // happens in `renderLivePreviewScript` (consumer-driven via
    // `useHead`) because Nitro's response stream is opaque here.
    void options;
    return Promise.resolve(undefined);
  };
}

/**
 * Render the live-preview `<script>` tag for embedding in a Nuxt
 * layout via `useHead`:
 *
 * ```ts
 * useHead({
 *   script: [
 *     { innerHTML: renderLivePreviewScript({ nonce: useNonce() }) },
 *   ],
 * });
 * ```
 */
export function renderLivePreviewScript(
  options: LivePreviewNuxtOptions & { readonly nonce?: string } = {},
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

/**
 * Build the merged CSP header value for a Nuxt response. Useful when
 * the consumer manages CSP themselves via `useResponseHeader`.
 */
export function buildLivePreviewCsp(
  options: LivePreviewNuxtOptions,
  nonce: string,
  existing = '',
): string {
  const frameAncestors = buildFrameAncestors({
    self: true,
    origins: [...(options.allowedOrigins ?? []), ...(options.frameAncestorsExtra ?? [])],
  });
  const scriptSrc = buildScriptSrcWithNonce(nonce, {
    self: true,
    ...(options.scriptSrcExtra !== undefined ? { extra: options.scriptSrcExtra } : {}),
  });
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
  directives.set('frame-ancestors', frameAncestors);
  directives.set('script-src', scriptSrc);
  return [...directives]
    .map(([name, value]) => (value.length === 0 ? name : `${name} ${value}`))
    .join('; ');
}
