/**
 * Public types for the Astro adapter.
 *
 * @module @adapters/astro/types
 */

export interface LivePreviewAstroOptions {
  /**
   * Trusted Payload admin origin(s). Required in production unless
   * `document.referrer` reliably exposes the parent origin.
   */
  readonly allowedOrigins?: readonly string[];

  /**
   * Payload server origin, e.g. `https://cms.example.com`. When set,
   * incoming updates are re-fetched through the Payload REST API so
   * relationship/upload fields render populated instead of as bare
   * IDs. Strongly recommended for Payload 3.x.
   */
  readonly serverURL?: string;

  /** REST API route prefix used with `serverURL`. Defaults to `/api`. */
  readonly apiRoute?: string;

  /** Population depth used with `serverURL`. Defaults to `1`. */
  readonly mergeDepth?: number;

  /**
   * Auto-inject the inline preview script. Default `true`. Disable to
   * embed the script manually via `renderLivePreviewScript()`.
   */
  readonly autoInject?: boolean;

  /**
   * When the middleware injects the script (integration-based
   * injection is always build-time and unaffected):
   *
   *   - `'preview-only'` (default) — only into responses that look
   *     like preview requests (`?preview=true` / `?draft=true` query,
   *     `Sec-Fetch-Dest: iframe`, or a referer from `allowedOrigins`).
   *     Normal production traffic passes through untouched.
   *   - `'always'` — into every HTML response.
   */
  readonly inject?: 'preview-only' | 'always';

  /**
   * Query parameters that mark a request as a preview (values `true`
   * or `1`). Default: `['preview', 'draft', 'livePreview']`.
   */
  readonly previewQueryParams?: readonly string[];

  /**
   * Restrict auto-inject to requests where this function returns
   * `true`. Applied on top of the `inject` mode.
   */
  readonly shouldInject?: (request: Request) => boolean;

  /**
   * Content-Security-Policy management on preview responses:
   *
   *   - `'frame-ancestors'` (default) — merge a `frame-ancestors`
   *     directive allowing the admin origins to embed the page.
   *     Existing CSP directives are preserved (union merge).
   *   - `'full'` — additionally manage `script-src` with a
   *     per-request nonce. Only useful when your whole page is
   *     nonce-disciplined; see `strictDynamic`.
   *   - `false` — never touch CSP headers.
   *
   * `true` is accepted as a legacy alias for `'frame-ancestors'`.
   */
  readonly manageCsp?: boolean | 'frame-ancestors' | 'full';

  /**
   * Add `'strict-dynamic'` to the managed `script-src` (only with
   * `manageCsp: 'full'`). ⚠️ Under CSP 3 this makes browsers ignore
   * `'self'` and host sources — every script on the page must then
   * carry the nonce or be loaded by a nonce-carrying script. Astro's
   * own hydration scripts do NOT carry it, so leave this off unless
   * you know your page is fully nonce-disciplined. Default `false`.
   */
  readonly strictDynamic?: boolean;

  /**
   * Extra `frame-ancestors` sources to merge with the auto-detected
   * ones. Always includes `'self'` and every entry in `allowedOrigins`.
   */
  readonly frameAncestorsExtra?: readonly string[];

  /**
   * Extra `script-src` sources (e.g., a CDN) appended after the nonce
   * (only with `manageCsp: 'full'`).
   */
  readonly scriptSrcExtra?: readonly string[];

  /**
   * Enable verbose debug logging in the injected client. Default: dev mode.
   */
  readonly debug?: boolean;

  /**
   * Debounce window for incoming updates. Default: 50 ms.
   */
  readonly debounceMs?: number;

  /**
   * Heartbeat timeout in ms. Default `0` (disabled — the Payload admin
   * sends no keepalive, so an idle timeout would cause false
   * disconnects).
   */
  readonly heartbeatMs?: number;
}
