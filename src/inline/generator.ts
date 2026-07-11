/**
 * Inline script generator.
 *
 * Wraps the build-time-generated runtime IIFE with consumer-provided
 * configuration. Returns a JavaScript string suitable for embedding
 * via `<script>` in any framework.
 *
 * The runtime body is identical to the one used by the high-level
 * client because both originate from `src/core/runtime.ts`. There is
 * no parallel implementation to drift out of sync.
 *
 * @module @inline/generator
 */

import { RUNTIME_SOURCE, RUNTIME_BUILD_INFO, type RuntimeBuildInfo } from './runtime.generated';

export interface InlineScriptConfig {
  /** Additional trusted origins to merge with auto-detected ones. */
  readonly allowedOrigins?: readonly string[];
  /**
   * Payload server origin, e.g. `https://cms.example.com`. When set,
   * every incoming update is re-fetched through the Payload REST API
   * (`X-Payload-HTTP-Method-Override: GET`, same strategy as the
   * official client) so relationship and upload fields render
   * populated instead of as bare IDs. Strongly recommended for
   * Payload 3.x. Requires the preview page to be able to reach the
   * API with credentials (same-site cookies or CORS `credentials`).
   */
  readonly serverURL?: string;
  /** REST API route prefix used with `serverURL`. Defaults to `/api`. */
  readonly apiRoute?: string;
  /** Population depth used with `serverURL`. Defaults to `1`. */
  readonly mergeDepth?: number;
  /** Enable verbose console logging. Defaults to `false`. */
  readonly debug?: boolean;
  /** Debounce window for incoming updates in ms. Defaults to `50`. */
  readonly debounceMs?: number;
  /** Enable screen-reader live region. Defaults to `true`. */
  readonly enableA11y?: boolean;
  /**
   * Heartbeat timeout in ms. Defaults to `0` (disabled). The Payload
   * admin only posts messages on form edits — there is no protocol
   * keepalive — so an idle-based timeout would fire spurious
   * disconnects while the editor pauses. Enable only if your admin
   * setup sends periodic messages.
   */
  readonly heartbeatMs?: number;
  /**
   * Bypass the visibility-gate optimisation and apply every update
   * regardless of viewport position. Default `false` — the gate kicks
   * in when the cache exceeds `visibilityGateThreshold` entries.
   */
  readonly disableVisibilityGate?: boolean;
  /**
   * Cache-size threshold above which the visibility gate activates.
   * Default `50`. Off-screen elements above this threshold are queued
   * for replay on intersection instead of being updated immediately.
   */
  readonly visibilityGateThreshold?: number;
  /**
   * `rootMargin` passed to the `IntersectionObserver` watching the
   * cached elements. Default `'200px'`. Increase to pre-render
   * further off-screen content; decrease for tighter visibility.
   */
  readonly intersectionRootMargin?: string;
  /**
   * Opt out of `document.referrer`-based origin auto-detection.
   * Useful when the page is loaded under `Referrer-Policy: no-referrer`
   * and you want predictable behaviour. Default `false`.
   */
  readonly disableReferrerDetection?: boolean;
  /**
   * Opt out of the dev-mode localhost-pattern matcher (any port on
   * `localhost` / `127.0.0.1`). Useful when running locally against
   * a production-like origin list. Default `false`.
   */
  readonly disableLocalhostMatching?: boolean;
  /**
   * Optional CSP nonce for the generated `<script>` tag. When provided
   * via `wrapWithScriptTag()` the nonce is set on the tag. Useful for
   * strict CSP policies that disallow `unsafe-inline`.
   */
  readonly nonce?: string;
}

const DEFAULT_DEBOUNCE_MS = 50;
const DEFAULT_HEARTBEAT_MS = 0;
const DEFAULT_VISIBILITY_GATE_THRESHOLD = 50;
const DEFAULT_INTERSECTION_ROOT_MARGIN = '200px';

/**
 * Build an inline script body. The result is a self-contained IIFE
 * with the build-time runtime, prefixed by a configuration block.
 *
 * The string does NOT include the `<script>` tags — use
 * `wrapWithScriptTag()` when you need them.
 */
export function generateInlineScript(config: InlineScriptConfig = {}): string {
  if (RUNTIME_SOURCE.length === 0) {
    throw new Error(
      '[live-preview] runtime.generated.ts is empty. Run `npm run build:runtime` before bundling.',
    );
  }
  const configLiteral = JSON.stringify({
    additionalOrigins: config.allowedOrigins ?? [],
    serverURL: config.serverURL ?? '',
    apiRoute: config.apiRoute ?? '/api',
    mergeDepth: config.mergeDepth ?? 1,
    debug: config.debug ?? false,
    debounceMs: config.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    enableA11y: config.enableA11y ?? true,
    heartbeatMs: config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
    disableVisibilityGate: config.disableVisibilityGate ?? false,
    visibilityGateThreshold: config.visibilityGateThreshold ?? DEFAULT_VISIBILITY_GATE_THRESHOLD,
    intersectionRootMargin: config.intersectionRootMargin ?? DEFAULT_INTERSECTION_ROOT_MARGIN,
    disableReferrerDetection: config.disableReferrerDetection ?? false,
    disableLocalhostMatching: config.disableLocalhostMatching ?? false,
    // `<` must never appear literally inside an inline <script> body —
    // a consumer-supplied string containing `</script>` would otherwise
    // terminate the tag early.
  }).replace(/</g, '\\u003C');
  // The IIFE declares its own scope. We inject the config via a global
  // assignment that the bundled runtime reads back through the
  // `__LIVE_PREVIEW_CONFIG__` constant placeholder.
  const generatedAt =
    RUNTIME_BUILD_INFO.generatedAt === '' ? 'dev' : RUNTIME_BUILD_INFO.generatedAt;
  return [
    `/* @relative23/payload-live-preview runtime ${generatedAt} */`,
    `var __LIVE_PREVIEW_CONFIG__=${configLiteral};`,
    `var __INLINE_BUILD__=true;`,
    RUNTIME_SOURCE,
  ].join('\n');
}

/**
 * Wrap an inline script body in a `<script>` tag. When a nonce is
 * provided it is added as the `nonce` attribute so CSP policies that
 * require `'nonce-...'` accept the script.
 */
export function wrapWithScriptTag(body: string, options: { nonce?: string } = {}): string {
  const nonceAttr = options.nonce !== undefined ? ` nonce="${escapeNonce(options.nonce)}"` : '';
  return `<script${nonceAttr}>${body}</script>`;
}

/**
 * Snapshot of the build-time information for diagnostics.
 */
export function runtimeBuildInfo(): RuntimeBuildInfo {
  return RUNTIME_BUILD_INFO;
}

function escapeNonce(nonce: string): string {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) {
    throw new RangeError('wrapWithScriptTag: nonce contains invalid characters');
  }
  return nonce;
}
