/**
 * `LivePreviewClient` configuration shape.
 *
 * @module @client/config
 */

export interface LivePreviewClientConfig {
  /** Explicit additional trusted origins. */
  readonly allowedOrigins?: readonly string[];
  /** Enable verbose console debug output. Defaults to dev-mode detection. */
  readonly debug?: boolean;
  /** Debounce window for incoming updates. Defaults to 50 ms. */
  readonly debounceMs?: number;
  /** Heartbeat timeout. Defaults to 30 s. */
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
   * Use it to gate live preview in multi-tenant admin contexts where
   * origin-trust alone is too permissive.
   */
  readonly validateToken?: (
    token: string | undefined,
    origin: string,
  ) => boolean | Promise<boolean>;
}
