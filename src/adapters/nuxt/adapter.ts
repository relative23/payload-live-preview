/**
 * Nuxt 3 adapter for Payload Live Preview.
 *
 * Exposes:
 *
 *   - `livePreviewNitroPlugin(options)` — the recommended wiring: a
 *     Nitro plugin body that hooks `render:html`, injects the inline
 *     script into the head of responses carrying preview intent, and
 *     merges the CSP header. Drop it in `server/plugins/live-preview.ts`:
 *
 *     ```ts
 *     import { livePreviewNitroPlugin } from 'payload-live-preview/nuxt';
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
 * Preview-intent signals are client-controlled and do not authenticate
 * a request. This convenience plugin has no authorization hook. When
 * response changes are protected, use an application-owned render hook
 * and call `renderLivePreviewScript()` / `buildLivePreviewCsp()` only
 * after the same verified decision that gates draft data and caching.
 *
 * @module @adapters/nuxt
 */

import { generateCspNonce } from '@security/csp';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import {
  buildPreviewCsp,
  createPreviewPolicy,
  inlineScriptConfig,
  normalizeCspMode,
} from '@adapters/shared/policy';

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
   * `'preview-only'` (default) — inject only into responses carrying
   * preview intent. The signals are not authorization. `'always'` —
   * every HTML response.
   */
  readonly inject?: 'preview-only' | 'always';
  /** Query params that signal preview intent. Default `['preview', 'draft', 'livePreview']`. */
  readonly previewQueryParams?: readonly string[];
  /** Which signals count as preview intent. Default: query, fetch-dest, referer. */
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
  /** Skip bindings whose value is identical to the one last applied. Default `false`. */
  readonly skipUnchanged?: boolean;
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
 * Hooks `render:html`: on requests carrying preview intent it appends
 * the inline runtime to the document head and merges the CSP header
 * onto the response. This convenience path detects intent only; use a
 * custom application-owned hook with the manual helpers when these
 * response changes require authorization.
 */
export function livePreviewNitroPlugin(
  options: LivePreviewNuxtOptions = {},
): (nitroApp: NitroAppLike) => void {
  const policy = createPreviewPolicy(options);
  return (nitroApp) => {
    nitroApp.hooks.hook('render:html', (html, { event }) => {
      const decision = policy.decide(toPreviewRequestLike(event));
      if (!decision.isPreview) return;
      const nonce = generateCspNonce();
      if (event.context !== undefined) event.context['livePreviewNonce'] = nonce;
      if (decision.inject) {
        html.head.push(policy.scriptTag(nonce));
      }
      const res = event.node?.res;
      if (decision.cspMode !== false && res?.setHeader !== undefined) {
        const previous = res.getHeader?.('content-security-policy');
        const existing = typeof previous === 'string' ? previous : '';
        res.setHeader('content-security-policy', policy.csp(existing, nonce, decision.cspMode));
      }
    });
  };
}

/**
 * A server handler (`defineEventHandler(defineLivePreviewServerHandler())`)
 * that only stashes a request-scoped nonce on `event.context.livePreviewNonce`
 * for templates that render their own scripts. It injects nothing.
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
 * Render the `<script>` tag for manual insertion (e.g. via `useHead()`)
 * when the plugin's automatic injection is disabled.
 */
export function renderLivePreviewScript(
  options: LivePreviewNuxtOptions & { readonly nonce?: string } = {},
): string {
  const body = generateInlineScript(inlineScriptConfig(options));
  return wrapWithScriptTag(body, options.nonce !== undefined ? { nonce: options.nonce } : {});
}

/**
 * The CSP header value for these options, for consumers that set the header
 * themselves. Without an explicit `mode` the options' `manageCsp` decides
 * between frame-ancestors only and full; `manageCsp: false` still yields
 * frame-ancestors here, as it always has — this helper builds, it does not
 * gate.
 */
export function buildLivePreviewCsp(
  options: LivePreviewNuxtOptions,
  nonce: string,
  existing = '',
  mode?: 'frame-ancestors' | 'full',
): string {
  const resolved = mode ?? normalizeCspMode(options.manageCsp);
  return buildPreviewCsp(
    options,
    nonce,
    existing,
    resolved === 'full' ? 'full' : 'frame-ancestors',
  );
}

/**
 * The minimal request shape the intent check reads, built from an H3 event.
 * Node hands repeated headers over as `string[]`; the first value is taken,
 * because comparing the raw array against `'iframe'` never matches and the
 * preview would silently not load.
 */
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
