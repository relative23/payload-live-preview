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
import { FRAGMENT_SOURCE } from './fragment.generated';
import { LOADER_SOURCE } from './loader.generated';

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
   * Restrict each update to the bindings owned by the document it describes,
   * declared in markup with `data-payload-owner` and resolved from the nearest
   * ancestor. Default `false`, which keeps matching on the field name alone.
   *
   * Enable it when one page previews more than one document. While enabled a
   * binding without an owner is never updated.
   */
  readonly scopeBindingsByOwner?: boolean;
  /**
   * Skip bindings whose value is identical to the one last applied, so a
   * keystroke re-renders only what changed. Default `false` in 1.x because
   * renderers and `elementUpdate` listeners then stop seeing repeats.
   */
  readonly skipUnchanged?: boolean;
  /** Which windows may post updates; `'parent-or-opener'` refuses every other source. Default `'any'`. */
  readonly eventSourcePolicy?: 'any' | 'parent-or-opener';
  /** Sanitizer policy for rich text and HTML writes; `'strict'` is the 2.0 default (`defaults: 'v2'`). */
  readonly sanitizerPolicy?: 'compat' | 'strict';
  /**
   * Same-origin path of a fragment endpoint (ADR 0011). When set, the inline
   * script carries the fragment client and renders `data-payload-fragment`
   * boundaries through it; a page without it gets the plain runtime.
   */
  readonly fragmentEndpoint?: string;
  /**
   * Retained for 1.x source compatibility, but has no effect here:
   * `generateInlineScript()` returns a script body and creates no tag.
   * Pass the nonce separately to `wrapWithScriptTag(body, { nonce })`.
   *
   * @deprecated Use the second argument of `wrapWithScriptTag()`.
   */
  readonly nonce?: string;
}

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
  // The IIFE declares its own scope. We inject the config via a `var`
  // declaration that the bundled runtime reads back through the
  // `__LIVE_PREVIEW_CONFIG__` constant placeholder. The identifier is retained
  // across 1.0.x because existing deployments use it as a non-secret runtime
  // presence/leak signal in response-level integration tests.
  // A page with `fragments` gets the fragment prelude ahead of the runtime;
  // the runtime itself is one build for every page.
  return [
    `var __LIVE_PREVIEW_CONFIG__=${buildConfigLiteral(config)};`,
    ...(config.fragmentEndpoint === undefined ? [] : [FRAGMENT_SOURCE]),
    RUNTIME_SOURCE,
  ].join('\n');
}

/**
 * Serialize the runtime configuration into the compact wire literal.
 *
 * Shared by the inline script and the static-delivery bootstrap so the two can
 * never disagree about the format. The runtime destructures this positionally.
 */
function buildConfigLiteral(config: InlineScriptConfig): string {
  // Compact private wire format; keep this order aligned with
  // `RuntimeBuildConfig` in `src/core/runtime.ts`.
  const compactConfig: unknown[] = [
    config.allowedOrigins,
    config.serverURL,
    config.apiRoute,
    config.mergeDepth,
    config.debug,
    config.debounceMs,
    config.enableA11y,
    config.heartbeatMs,
    config.disableVisibilityGate,
    config.visibilityGateThreshold,
    config.intersectionRootMargin,
    config.disableReferrerDetection,
    config.disableLocalhostMatching,
    config.scopeBindingsByOwner,
    config.skipUnchanged,
    config.eventSourcePolicy,
    config.sanitizerPolicy,
    config.fragmentEndpoint,
  ];
  while (compactConfig.length > 0 && compactConfig.at(-1) === undefined) compactConfig.pop();
  // Preserve omitted interior options as sparse JavaScript slots. JSON arrays
  // encode `undefined` as `null`, which would bypass the runtime's destructuring
  // defaults and can turn an omitted serverURL into an invalid configured value.
  // `<` must never appear literally inside an inline <script> body — a
  // consumer-supplied string containing `</script>` would terminate the tag.
  const configLiteral = `[${compactConfig
    .map((value) => (value === undefined ? '' : JSON.stringify(value)))
    .join(',')}]`.replace(/</g, '\\u003C');
  return configLiteral;
}

/** Where the runtime asset lives, and how the browser should verify it. */
export interface LoaderScriptTarget {
  /** URL the bootstrap appends. Same-origin or absolute; hashed by the caller. */
  readonly runtimeSrc: string;
  /**
   * Subresource-integrity value for that asset, e.g. `sha384-…`.
   *
   * Empty disables the check and the `crossorigin` attribute that enforcement
   * requires. Only appropriate where the asset is served from the same origin
   * as the page and the deployment already guarantees they ship together.
   */
  readonly integrity?: string;
}

/**
 * Generate the static-delivery bootstrap instead of the whole runtime.
 *
 * Emits the configuration plus a few hundred bytes that check the preview
 * context and, only then, append the runtime as an external script. A
 * statically built site otherwise bakes the full runtime into every page,
 * charging every ordinary visitor for a feature only an editor uses.
 *
 * The runtime asset stays configuration-free: the config lives in this inline
 * body, so the asset is byte identical across sites and deployments — which is
 * what lets it be cached and hashed, and what makes it structurally incapable
 * of carrying a token.
 */
export function generateLoaderScript(
  config: InlineScriptConfig = {},
  target: LoaderScriptTarget,
): string {
  if (LOADER_SOURCE.length === 0) {
    throw new Error(
      '[live-preview] loader.generated.ts is empty. Run `npm run build:runtime` before bundling.',
    );
  }
  if (target.runtimeSrc === '') {
    throw new Error('[live-preview] generateLoaderScript needs a runtimeSrc.');
  }
  // `<` must never appear literally inside an inline <script> body: a
  // consumer-supplied URL containing `</script>` would terminate the tag.
  const encode = (value: string): string => JSON.stringify(value).replace(/</gu, '\\u003C');
  return [
    `var __LIVE_PREVIEW_CONFIG__=${buildConfigLiteral(config)};`,
    `var __LP_RUNTIME_SRC__=${encode(target.runtimeSrc)};`,
    `var __LP_RUNTIME_INTEGRITY__=${encode(target.integrity ?? '')};`,
    ...(config.fragmentEndpoint === undefined ? [] : [FRAGMENT_SOURCE]),
    LOADER_SOURCE,
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
