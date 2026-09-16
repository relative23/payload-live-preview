/**
 * The inline script's configuration and its positional wire order: the
 * generator writes the tuple, `src/core/runtime.ts` destructures it, and
 * `INLINE_CONFIG_KEYS` is where they agree. Append only, never reorder.
 */

import type { DefaultsProfile } from '@/types/defaults-profile';

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
  /**
   * Carry the route strategy, so a binding in `<head>` or one marked
   * `data-payload-strategy="route"` refreshes the route. `fragmentEndpoint`
   * implies it — the fragment prelude already contains it. Default `false`.
   */
  readonly routeStrategy?: boolean;
  /**
   * The 2.0 name for `onUnfaithfulPatch`, kept until 3.0. `'route'` means
   * `'escalate'`, `'ignore'` means `'ignore'`.
   *
   * @deprecated Renamed to `onUnfaithfulPatch`.
   */
  readonly onUnboundChange?: 'ignore' | 'route';
  /**
   * What to do when the runtime knows a patch cannot reach what the server
   * would have drawn. `'escalate'` (the default) hands the region to the
   * fragment strategy when a boundary covers it and to the route otherwise, so
   * it needs `fragmentEndpoint` or `routeStrategy` to do anything. `'warn'`
   * reports LP0411 and keeps the patch; `'ignore'` keeps it silently.
   */
  readonly onUnfaithfulPatch?: 'ignore' | 'warn' | 'escalate';
  /**
   * Find bindings by value on the connection's first message (ADR 0014): a
   * scalar whose value is the whole content of exactly one element is bound
   * to it as if `data-payload-field` stood there. Default `'off'`.
   */
  readonly autoBind?: 'off' | 'unique';
  /**
   * The framework that hydrates this page (ADR 0015). Under `'react'` the
   * runtime holds its first write until React has committed the tree that
   * holds the bindings — otherwise React finds markup it did not render,
   * throws `Hydration failed` and regenerates the tree, and the write is gone.
   * Under `'vue'` it holds the write until Vue has mounted the app around them
   * — otherwise Vue's hydration repairs the write back to the server's value,
   * quietly. The Next.js and Nuxt adapters set it on every script they emit; a
   * page built by hand with `generateInlineScript()` may. Omitted: the runtime
   * starts on `DOMContentLoaded`, as on a static page.
   */
  readonly hydration?: 'react' | 'vue';
  /**
   * Which defaults the omitted options fall back to, resolved by the generator
   * rather than the runtime, whose own fallbacks are the 2.0 rows: `'v1'`
   * writes its four runtime rows into their slots (an explicit option still
   * wins) and relaxes the `mergeDepth` check. The resolved value always
   * travels, in the last slot, so a reader of the served page knows what an
   * empty slot means instead of guessing it — `pll doctor --v2` reads it. The
   * runtime does not: every row the profile decides is already in its slot.
   */
  readonly defaults?: DefaultsProfile;
  /**
   * A runtime artifact to embed instead of the full one — today only
   * `LEAN_RUNTIME` from `payload-live-preview/lean`, which leaves out the
   * strategies, the keyed morph, the structural arrays, the item templates, the
   * announcer and auto-binding (about 7 KB gzip less on the page) and reports
   * LP0104 when a page needs one of them.
   *
   * It is an imported value rather than a `profile: 'lean'` string on purpose:
   * a second artifact behind a string option would sit in every build that can
   * reach the generator; measured, it grew each adapter entry by the artifact's
   * whole size. This way the bytes follow the import.
   *
   * Not serialized: it decides which bytes are emitted, not how they behave.
   */
  readonly runtime?: RuntimeArtifact;
}

/**
 * A runtime build this package produces. `source` is the IIFE the page runs;
 * the two digests describe the same bytes as a servable asset, so asset
 * delivery can hash-name and SRI-verify whichever artifact was chosen without
 * hashing anything at request time.
 */
export interface RuntimeArtifact {
  readonly profile: 'lean';
  readonly source: string;
  /** Short content hash, for the asset's file name. */
  readonly contentHash: string;
  /** `sha384-…`, for the bootstrap's `integrity` attribute. */
  readonly integrity: string;
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
  'routeStrategy',
  'onUnboundChange',
  'onUnfaithfulPatch',
  'autoBind',
  'hydration',
  'defaults',
] as const satisfies readonly Exclude<keyof InlineScriptConfig, 'runtime'>[];
