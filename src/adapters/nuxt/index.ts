/**
 * Nuxt 3 adapter for Payload Live Preview.
 *
 * Exposes:
 *
 *   - `livePreviewNitroPlugin(options)` — the recommended wiring: a
 *     Nitro plugin body that hooks `render:html`, injects the inline
 *     script into the head of preview responses, and merges the CSP
 *     header. Drop it in `server/plugins/live-preview.ts`:
 *
 *     ```ts
 *     import { livePreviewNitroPlugin } from '@relative23/payload-live-preview/nuxt';
 *     export default defineNitroPlugin(
 *       livePreviewNitroPlugin({ allowedOrigins: ['https://admin.example.com'] }),
 *     );
 *     ```
 *
 *   - `renderLivePreviewScript(options)` — a script-tag string for
 *     manual embedding in a Nuxt layout via `useHead`.
 *
 *   - `buildLivePreviewCsp(options, nonce, existing?)` — the merged
 *     CSP header value, for consumers managing headers themselves.
 *
 *   - `defineLivePreviewServerHandler(options)` — a minimal Nitro
 *     server middleware that ONLY stashes a per-request nonce on
 *     `event.context.livePreviewNonce`. It does not inject anything;
 *     prefer the Nitro plugin above.
 *
 * @module @adapters/nuxt
 */

import {
  generateCspNonce,
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  mergeCspHeader,
} from '@security/csp';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import { isPreviewRequest } from '@adapters/shared/preview-request';

export interface LivePreviewNuxtOptions {
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
  /** Which signals count as a preview request. Default: query, fetch-dest, referer. */
  readonly previewSignals?: readonly ('query' | 'fetch-dest' | 'referer')[];
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

// Nitro / H3 types are duck-typed so the adapter compiles without the
// `h3` / `nitropack` peer deps. The shapes below match Nitro 2.x.
interface H3EventLike {
  readonly path?: string;
  readonly node?: {
    readonly req?: {
      readonly url?: string;
      readonly headers?: Record<string, string | string[] | undefined>;
    };
    readonly res?: {
      getHeader?: (name: string) => string | number | string[] | undefined;
      setHeader?: (name: string, value: string) => void;
    };
  };
  readonly context?: Record<string, unknown>;
}

/** The `render:html` hook payload — Nitro's `NuxtRenderHTMLContext`. */
interface RenderHtmlContextLike {
  readonly head: string[];
}

interface NitroAppLike {
  readonly hooks: {
    hook(
      name: 'render:html',
      fn: (html: RenderHtmlContextLike, context: { event: H3EventLike }) => void,
    ): void;
  };
}

export type NitroHandler = (event: H3EventLike) => Promise<Response | undefined>;

/**
 * Body for a Nitro plugin (`defineNitroPlugin(livePreviewNitroPlugin(...))`).
 * Hooks `render:html`: on preview requests it appends the inline
 * runtime to the document head and merges the CSP header onto the
 * response.
 */
export function livePreviewNitroPlugin(
  options: LivePreviewNuxtOptions = {},
): (nitroApp: NitroAppLike) => void {
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

  return (nitroApp) => {
    nitroApp.hooks.hook('render:html', (html, { event }) => {
      const isPreview =
        (options.inject ?? 'preview-only') === 'always' ||
        isPreviewRequest(toPreviewRequestLike(event), {
          ...(options.previewQueryParams !== undefined
            ? { queryParams: options.previewQueryParams }
            : {}),
          ...(options.previewSignals !== undefined ? { signals: options.previewSignals } : {}),
          adminOrigins: options.allowedOrigins ?? [],
        });
      if (!isPreview) return;

      const nonce = generateCspNonce();
      if (event.context !== undefined) event.context['livePreviewNonce'] = nonce;

      if (options.autoInject ?? true) {
        html.head.push(wrapWithScriptTag(scriptBody(), { nonce }));
      }

      const manageCsp = normalizeManageCsp(options.manageCsp);
      const res = event.node?.res;
      if (manageCsp !== false && res?.setHeader !== undefined) {
        const previous = res.getHeader?.('content-security-policy');
        const existing = typeof previous === 'string' ? previous : '';
        res.setHeader(
          'content-security-policy',
          buildLivePreviewCsp(options, nonce, existing, manageCsp),
        );
      }
    });
  };
}

/**
 * Minimal Nitro server middleware: stashes a per-request nonce on
 * `event.context.livePreviewNonce` for consumers that embed the
 * script manually via `useHead`. It injects nothing — use
 * `livePreviewNitroPlugin` for automatic injection.
 */
export function defineLivePreviewServerHandler(
  _options: LivePreviewNuxtOptions = {},
): NitroHandler {
  return (event: H3EventLike) => {
    const nonce = generateCspNonce();
    const ctx: Record<string, unknown> = event.context ?? {};
    ctx['livePreviewNonce'] = nonce;
    // Returning `undefined` tells Nitro to continue with the next handler.
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

/**
 * Build the merged CSP header value for a Nuxt response. Useful when
 * the consumer manages CSP themselves via `useResponseHeader`.
 */
export function buildLivePreviewCsp(
  options: LivePreviewNuxtOptions,
  nonce: string,
  existing = '',
  mode?: 'frame-ancestors' | 'full',
): string {
  const resolvedMode = mode ?? normalizeManageCsp(options.manageCsp);
  const frameAncestors = buildFrameAncestors({
    self: true,
    origins: [...(options.allowedOrigins ?? []), ...(options.frameAncestorsExtra ?? [])],
  });
  const additions: Record<string, string> = { 'frame-ancestors': frameAncestors };
  if (resolvedMode === 'full') {
    additions['script-src'] = buildScriptSrcWithNonce(nonce, {
      self: true,
      strictDynamic: options.strictDynamic ?? false,
      ...(options.scriptSrcExtra !== undefined ? { extra: options.scriptSrcExtra } : {}),
    });
  }
  return mergeCspHeader(existing, additions);
}

function normalizeManageCsp(
  value: LivePreviewNuxtOptions['manageCsp'],
): 'frame-ancestors' | 'full' | false {
  if (value === false) return false;
  if (value === 'full') return 'full';
  return 'frame-ancestors';
}

function toPreviewRequestLike(event: H3EventLike): {
  url: string;
  headers: { get(name: string): string | null };
} {
  const rawHeaders = event.node?.req?.headers ?? {};
  const host = firstHeader(rawHeaders['host']) ?? 'localhost';
  const rawPath = event.path ?? event.node?.req?.url ?? '/';
  return {
    url: `http://${host}${rawPath}`,
    headers: {
      get: (name: string): string | null => firstHeader(rawHeaders[name.toLowerCase()]) ?? null,
    },
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
