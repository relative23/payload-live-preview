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
   * Auto-inject the inline preview script into every page. Default `true`.
   * Disable when you want to embed the script manually via
   * `<LivePreviewScript />` (more granular control over where it appears).
   */
  readonly autoInject?: boolean;

  /**
   * Restrict auto-inject to pages where this function returns `true`.
   * Useful for excluding API routes or print stylesheets.
   */
  readonly shouldInject?: (request: Request) => boolean;

  /**
   * Add the `Content-Security-Policy` header automatically. Default `true`.
   * Disable when your own middleware already manages CSP.
   */
  readonly manageCsp?: boolean;

  /**
   * Extra `frame-ancestors` sources to merge with the auto-detected ones.
   * Always includes `'self'` and every entry in `allowedOrigins`.
   */
  readonly frameAncestorsExtra?: readonly string[];

  /**
   * Extra `script-src` sources (e.g., a CDN) appended after the nonce
   * and `'strict-dynamic'`.
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
   * Heartbeat timeout. Default: 30 000 ms.
   */
  readonly heartbeatMs?: number;
}
