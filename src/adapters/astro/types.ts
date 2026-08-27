/**
 * Public types for the Astro adapter.
 *
 * @module @adapters/astro/types
 */

export interface LivePreviewAstroOptions {
  /**
   * How the integration wires the preview:
   *
   *   - `'inline'` (default) — bake the runtime into every page at
   *     build time. For `output: 'static'` projects.
   *   - `'loader'` — inject a few hundred bytes that check the preview
   *     context and fetch the runtime as a hashed, SRI-verified asset only
   *     when it is one. Also for `output: 'static'`, and the better choice
   *     there: `'inline'` charges every ordinary visitor ~21 KB gzip for a
   *     feature only an editor uses.
   *   - `'middleware'` — auto-register the preview middleware:
   *     request-time injection into requests with preview intent,
   *     plus `frame-ancestors` CSP management. For `output: 'server'`.
   *     (`shouldInject` is unsupported here — options serialize into
   *     the build.)
   *
   * Intent signals are not authorization. If either response change
   * must be access-controlled, compose `createLivePreviewMiddleware()`
   * manually after an application-owned server-side authorization.
   */
  readonly mode?: 'inline' | 'loader' | 'middleware';

  /**
   * Allowed Payload admin origin(s) for inbound browser messages and
   * the optional Referer intent signal. This does not authenticate the
   * incoming HTTP request or authorize draft access.
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
   *   - `'preview-only'` (default) — only into responses carrying a
   *     preview-intent signal (`?preview=true` / `?draft=true` query,
   *     `Sec-Fetch-Dest: iframe`, or a referer from `allowedOrigins`).
   *     These client-controlled signals are a delivery optimisation,
   *     not authorization.
   *   - `'always'` — into every HTML response.
   */
  readonly inject?: 'preview-only' | 'always';

  /**
   * Query parameters that mark a request as a preview (values `true`
   * or `1`). Default: `['preview', 'draft', 'livePreview']`.
   */
  readonly previewQueryParams?: readonly string[];

  /**
   * Which signals count as preview intent. Default: all three
   * (`query`, `fetch-dest`, `referer`). Restrict to `['query']` when
   * an unsolicited iframe load must never trigger preview handling
   * (e.g. sites that serve `frame-ancestors 'none'` and only allow
   * preview via the explicit `?preview=true` URL).
   */
  readonly previewSignals?: readonly ('query' | 'fetch-dest' | 'referer')[];

  /**
   * Restrict script injection to requests where this function returns
   * `true`. Applied on top of the `inject` mode. This is a synchronous
   * route/content filter, not authentication, and it does not suppress
   * the adapter's CSP handling. Perform authorization before invoking
   * the middleware.
   */
  readonly shouldInject?: (request: Request) => boolean;

  /**
   * Content-Security-Policy management on responses carrying preview
   * intent. The adapter does not authenticate those requests; invoke
   * it only after authorization when this policy change is privileged:
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

  /** Enable verbose debug logging in the injected client. Defaults to `false`. */
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
  /**
   * Skip bindings whose value is identical to the one last applied. Default
   * `false` in 1.x; see the client option of the same name.
   */
  readonly skipUnchanged?: boolean;
}
