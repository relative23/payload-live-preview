/**
 * `LivePreviewClient` configuration shape.
 *
 * @module @client/config
 */

export interface LivePreviewClientConfig {
  /** Explicit additional trusted origins. */
  readonly allowedOrigins?: readonly string[];
  /**
   * Payload server origin, e.g. `https://cms.example.com`. When set,
   * every incoming update is re-fetched through the Payload REST API
   * so relationship/upload fields render populated instead of as bare
   * IDs (same strategy as the official client). Recommended for
   * Payload 3.x.
   */
  readonly serverURL?: string;
  /** REST API route prefix used with `serverURL`. Defaults to `/api`. */
  readonly apiRoute?: string;
  /** Population depth used with `serverURL`. Defaults to `1`. */
  readonly mergeDepth?: number;
  /**
   * Custom fetch implementation for the `serverURL` merge request —
   * the equivalent of the official client's `requestHandler`. Use it
   * to attach auth headers or route through your own proxy. Only
   * available on the programmatic client (functions cannot be
   * serialised into the inline script).
   */
  readonly mergeFetch?: typeof fetch;
  /** Enable verbose console debug output. Defaults to dev-mode detection. */
  readonly debug?: boolean;
  /** Debounce window for incoming updates. Defaults to 50 ms. */
  readonly debounceMs?: number;
  /**
   * Heartbeat timeout in ms. Defaults to `0` (disabled) because the
   * Payload admin sends messages only on form edits — there is no
   * protocol keepalive, so an idle timeout would produce false
   * disconnects.
   */
  readonly heartbeatMs?: number;
  /** IntersectionObserver rootMargin. Defaults to `200px`. */
  readonly intersectionRootMargin?: string;
  /** Bypass the visibility gate (apply every update). Defaults to `false`. */
  readonly disableVisibilityGate?: boolean;
  /** Cache-size threshold above which off-screen updates are queued for replay. Defaults to 50. */
  readonly visibilityGateThreshold?: number;
  /** Mount an `aria-live` region and announce lifecycle to screen readers. Default `true`. */
  readonly enableA11y?: boolean;
  /** Locale used to pick A11y announcement strings. Defaults to detected locale. */
  readonly a11yLocale?: string;
  /** Document root, defaults to `document`. */
  readonly root?: Document | Element;
  /** Disable `document.referrer` detection. */
  readonly disableReferrerDetection?: boolean;
  /** Disable the localhost dev-mode pattern matcher. */
  readonly disableLocalhostMatching?: boolean;
  /** Auto-start the runtime in the constructor. Defaults to `true`. */
  readonly autoStart?: boolean;
  /**
   * Optional preview-token validator. When set, every data update
   * must carry a `previewToken` field that this function approves.
   *
   * ⚠️ `previewToken` is an extension of THIS library, not part of the
   * stock Payload postMessage protocol — the Payload admin never sends
   * one. Only enable this when a custom admin component adds the token
   * to outgoing messages; against an unmodified Payload admin it would
   * drop every update.
   */
  readonly validateToken?: (
    token: string | undefined,
    origin: string,
  ) => boolean | Promise<boolean>;
}
