/**
 * The inline script's configuration and its positional wire order: the
 * generator writes the tuple, `src/core/runtime.ts` destructures it, and
 * `INLINE_CONFIG_KEYS` is where they agree. Append only, never reorder.
 */

import type { DefaultsProfile } from '@core/defaults-profile';

export interface InlineScriptConfig {
  /** Trusted admin origins, merged with the detected ones. */
  readonly allowedOrigins?: readonly string[];
  /** Payload origin; every update is then re-fetched through the REST API with credentials. Requires `mergeDepth`. */
  readonly serverURL?: string;
  /** REST route prefix used with `serverURL`. Default `/api`. */
  readonly apiRoute?: string;
  /** Population depth used with `serverURL`. Required with `serverURL` unless `defaults: 'v1'`. */
  readonly mergeDepth?: number;
  /** Verbose console logging. Default `false`. */
  readonly debug?: boolean;
  /** Debounce window for incoming updates in ms. Default `50`. */
  readonly debounceMs?: number;
  /** Mount the screen-reader live region. Default `true`. */
  readonly enableA11y?: boolean;
  /** Heartbeat timeout in ms; `0` disables it (default), because the admin posts only on edits. */
  readonly heartbeatMs?: number;
  /** Apply every update regardless of viewport position. Default `false`. */
  readonly disableVisibilityGate?: boolean;
  /** Cache size above which off-screen updates wait for intersection. Default `50`. */
  readonly visibilityGateThreshold?: number;
  /** `rootMargin` of the IntersectionObserver. Default `'200px'`. */
  readonly intersectionRootMargin?: string;
  /** Ignore `document.referrer` as an origin source. Default `true`; `defaults: 'v1'` sets `false`. */
  readonly disableReferrerDetection?: boolean;
  /** Disable the dev-mode localhost matcher (any port on `localhost`/`127.0.0.1`). Default `false`. */
  readonly disableLocalhostMatching?: boolean;
  /** Update only bindings under a matching `data-payload-owner`. Default `false`. */
  readonly scopeBindingsByOwner?: boolean;
  /** Skip bindings whose value did not change. Default `true`; `defaults: 'v1'` sets `false`. */
  readonly skipUnchanged?: boolean;
  /** Scroll the preview to the field being edited. Default `false`. */
  readonly revealEditedField?: boolean;
  /** Which windows may post updates. Default `'parent-or-opener'`; `defaults: 'v1'` sets `'any'`. */
  readonly eventSourcePolicy?: 'any' | 'parent-or-opener';
  /** Sanitizer policy for rich text and HTML writes. Default `'strict'`; `defaults: 'v1'` sets `'compat'`. */
  readonly sanitizerPolicy?: 'compat' | 'strict';
  /** Same-origin path of a fragment endpoint; the script then carries the fragment client ahead of the runtime (ADR 0011). */
  readonly fragmentEndpoint?: string;
  /** Which defaults the omitted options fall back to. Not serialized: `'v1'` only relaxes the generator's `mergeDepth` check. */
  readonly defaults?: DefaultsProfile;
}

/** Keys that travel in the wire tuple, in slot order. */
export const INLINE_CONFIG_KEYS = [
  'allowedOrigins',
  'serverURL',
  'apiRoute',
  'mergeDepth',
  'debug',
  'debounceMs',
  'enableA11y',
  'heartbeatMs',
  'disableVisibilityGate',
  'visibilityGateThreshold',
  'intersectionRootMargin',
  'disableReferrerDetection',
  'disableLocalhostMatching',
  'scopeBindingsByOwner',
  'skipUnchanged',
  'eventSourcePolicy',
  'sanitizerPolicy',
  'fragmentEndpoint',
  'revealEditedField',
] as const satisfies readonly Exclude<keyof InlineScriptConfig, 'defaults'>[];
