/**
 * The inline script's configuration and its positional wire order: the
 * generator writes the tuple, `src/core/session/runtime.ts` destructures it, and
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
  /** Population depth used with `serverURL`. Required with `serverURL`. */
  readonly mergeDepth?: number;
  /** Verbose console logging. Default `false`. */
  readonly debug?: boolean;
  /** Debounce window for incoming updates in ms. Default `50`. */
  readonly debounceMs?: number;
  /** Mount the screen-reader live region. Default `true`. */
  readonly enableA11y?: boolean;
  /** Heartbeat timeout in ms; `0` disables it (default), because the admin posts only on edits. */
  readonly heartbeatMs?: number;
  /** Hold an off-screen update until its element scrolls into view. Default `true`; `false` applies every update at once. */
  readonly enableVisibilityGate?: boolean;
  /** Cache size above which off-screen updates wait for intersection. Default `50`. */
  readonly visibilityGateThreshold?: number;
  /** `rootMargin` of the IntersectionObserver. Default `'200px'`. */
  readonly intersectionRootMargin?: string;
  /** Take `document.referrer` as an origin source. Default `false`. */
  readonly enableReferrerDetection?: boolean;
  /** The dev-mode localhost matcher (any port on `localhost`/`127.0.0.1`). Default `true`. */
  readonly enableLocalhostMatching?: boolean;
  /** Update only bindings under a matching `data-payload-owner`. Default `false`. */
  readonly scopeBindingsByOwner?: boolean;
  /** Skip bindings whose value did not change. Default `true`. */
  readonly skipUnchanged?: boolean;
  /** Scroll the preview to the field being edited. Default `false`. */
  readonly revealEditedField?: boolean;
  /** Which windows may post updates. Default `'parent-or-opener'`. */
  readonly eventSourcePolicy?: 'any' | 'parent-or-opener';
  /** Sanitizer policy for rich text and HTML writes. Default `'strict'`. */
  readonly sanitizerPolicy?: 'compat' | 'strict';
  /** Same-origin path of a fragment endpoint; the script then carries the fragment client ahead of the runtime (ADR 0011). */
  readonly fragmentEndpoint?: string;
  /**
   * Carry the route strategy, so a binding in `<head>` or one marked
   * `data-payload-strategy="route"` refreshes the route. `fragmentEndpoint`
   * implies it — the fragment prelude already contains it. Default `false`.
   * `'after-save'` renders the route only once Payload reports a save: before it, a
   * GET shows nothing the editor typed and costs a server render. `'router'` does the
   * same and only through the route refresh the page lent (`registerRouteRefresh()`,
   * which the adapters' navigation helpers call): a page that lent none is not fetched
   * and morphed, and LP0808 names what to mount.
   */
  readonly routeStrategy?: boolean | 'after-save' | 'router';
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
   * quietly. Under `'sveltekit'` it holds the write until SvelteKit's root has
   * mounted, on a page SvelteKit's client runs on — otherwise Svelte's
   * hydration sets its own text back over it, as quietly. The Next.js, Nuxt
   * and SvelteKit adapters set it on every script they emit; a page built by
   * hand with `generateInlineScript()` may. Under `'manual'` it holds the write
   * until the page calls `markHydrated()`, for a framework this package cannot
   * observe. Omitted: the runtime starts on `DOMContentLoaded`, as on a static page.
   */
  readonly hydration?: 'react' | 'vue' | 'sveltekit' | 'manual';
  /**
   * Which defaults the omitted options fall back to, resolved by the generator
   * rather than the runtime, whose own fallbacks are the 2.0 rows: `'v1'`
   * writes its four runtime rows into their slots (an explicit option still
   * wins) and relaxes the `mergeDepth` check. The resolved value always
   * travels in slot 24, so a reader of the served page knows what an
   * empty slot means instead of guessing it — `pll doctor --v2` reads it. The
   * runtime does not use that value: every row the profile decides is already
   * in its slot. Slot 24 stays fixed as later options are appended.
   */
  readonly defaults?: DefaultsProfile;
  /**
   * Document events fired after a client router committed new markup. Each
   * rebuilds the binding cache and locally reapplies the last accepted state.
   * Adapter integrations set this from their framework lifecycle. It is a
   * low-level generator fact, not a `PreviewAdapterOptions` field. Empty by
   * default.
   */
  readonly softNavigationEvents?: readonly string[];
  /**
   * How a group counts as covered (ADR 0022). `'declared'`, the default since
   * 3.0: each changed path inside a group needs its own binding or a
   * `data-payload-covers` declaration; an uncovered one is an unbound change.
   * `'descendant'`, the 2.x default: one bound path inside a group covers all
   * of it.
   */
  readonly subfieldCoverage?: 'descendant' | 'declared';
  /** Milliseconds the `serverURL` merge may wait before the update shows its raw values. Off by default. */
  readonly mergeTimeoutMs?: number;
  /** The route of a Lexical internal link with no `url` of its own, as `/{locale}/{slug}/`. */
  readonly internalLinkPattern?: string;
}

/**
 * A slot whose option 3.0 removed. It keeps its place and stays empty: a slot's number means the
 * same in every version, which is what lets `pll doctor` read a page another version served.
 * The three `disable…` switches are here because 3.0 names them by what they turn on (ADR 0007,
 * row 38); their successors stand at the end of the table.
 */
export type RetiredInlineKey =
  | 'onUnboundChange'
  | 'disableVisibilityGate'
  | 'disableReferrerDetection'
  | 'disableLocalhostMatching';

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
  'softNavigationEvents',
  'subfieldCoverage',
  'mergeTimeoutMs',
  'internalLinkPattern',
  'enableVisibilityGate',
  'enableReferrerDetection',
  'enableLocalhostMatching',
] as const satisfies readonly (keyof InlineScriptConfig | RetiredInlineKey)[];
