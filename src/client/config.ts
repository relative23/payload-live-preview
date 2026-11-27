/**
 * `LivePreviewClient` configuration. The defaults are one table since 3.0
 * removed `defaults: 'v1'` (ADR 0007, row 21).
 */

import type { CachedElement, FieldRenderer, RendererKey, RichTextRenderer } from '@core/types';
import type { StrategyHandlers } from '@core/strategies/strategies';
import {
  V2_RUNTIME_DEFAULTS,
  type DefaultsProfile,
  type EventSourcePolicy,
} from '@/types/defaults-profile';
import { refuseRemovedProfile, refuseTurnedSwitches } from '@/types/removed-options';

export interface LivePreviewClientConfig {
  /** Explicit trusted admin origins. */
  readonly allowedOrigins?: readonly string[];
  /** Payload origin; every update is then re-fetched through the REST API so relations arrive populated. Requires `mergeDepth`. */
  readonly serverURL?: string;
  /** REST route prefix used with `serverURL`. Default `/api`. */
  readonly apiRoute?: string;
  /** Population depth used with `serverURL`. Required with it. */
  readonly mergeDepth?: number;
  /** Milliseconds the `serverURL` merge may wait before the update shows its raw values. Off by default. */
  readonly mergeTimeoutMs?: number;
  /** The route of a Lexical internal link with no `url` of its own, as `/{locale}/{slug}/`. */
  readonly internalLinkPattern?: string;
  /** Hold a route render until Payload reports the save: the route shows what is saved. */
  readonly routeAfterSave?: boolean;
  /** Custom fetch for the `serverURL` merge request: attach auth headers or route through a proxy. */
  readonly mergeFetch?: typeof fetch;
  /** Verbose console output. Defaults to dev-mode detection. */
  readonly debug?: boolean;
  /** Debounce window for incoming updates. Default 50 ms. */
  readonly debounceMs?: number;
  /** Heartbeat timeout in ms; `0` disables it (default), because the admin posts only on edits. */
  readonly heartbeatMs?: number;
  /** IntersectionObserver `rootMargin`. Default `200px`. */
  readonly intersectionRootMargin?: string;
  /** Update only bindings under a matching `data-payload-owner`; an unowned binding is then never updated. Default `false`. */
  readonly scopeBindingsByOwner?: boolean;
  /** Skip a binding whose value did not change. Default `true`. */
  readonly skipUnchanged?: boolean;
  /** Scroll the preview to the field being edited when its value changes. Default `false`. */
  readonly revealEditedField?: boolean;
  /**
   * Find bindings by value on the connection's first message: a scalar whose
   * value is the whole content of exactly one element is bound to it as if
   * `data-payload-field` stood there; every guess is stamped `data-payload-guessed`
   * and listed in `inspect().bindings.guessed`. Default `'off'`.
   */
  readonly autoBind?: 'off' | 'unique';
  /**
   * How a group counts as covered (ADR 0022). `'declared'` (default since 3.0):
   * each changed path inside a group needs its own binding or a
   * `data-payload-covers` declaration; an uncovered one is an unbound change.
   * `'descendant'`, the 2.x default: one bound path inside a group covers all
   * of it.
   */
  readonly subfieldCoverage?: 'descendant' | 'declared';
  /** Fields whose change re-applies other bindings regardless of their own value: `{ price: ['priceLabel'] }`. Used with `skipUnchanged`. */
  readonly dependencies?: Readonly<Record<string, readonly string[]>>;
  /** Strategy handlers beyond patching; `createFragmentStrategy()` from `payload-live-preview/fragment` builds one. */
  readonly strategies?: StrategyHandlers;
  /** Hold an off-screen update until its element is visible. Default `true`; `false` applies every update at once. */
  readonly enableVisibilityGate?: boolean;
  /** Cache size above which off-screen updates wait for intersection. Default `50`. */
  readonly visibilityGateThreshold?: number;
  /** Mount an `aria-live` region for connections, applied updates and heartbeat disconnects. Default `true`. */
  readonly enableA11y?: boolean;
  /** Locale of the announcement strings. Defaults to the detected locale. */
  readonly a11yLocale?: string;
  /** Document root. Default `document`. */
  readonly root?: Document | Element;
  /** Renderer resolution ahead of the registry; return `undefined` to fall through. */
  readonly resolveRenderer?: (
    fieldType: RendererKey,
    target: CachedElement,
  ) => FieldRenderer | undefined;
  /** The project's rich-text renderer, shared with SSR. Its output is sanitized. */
  readonly renderRichText?: RichTextRenderer;
  /** Take `document.referrer` as an origin source. Default `false`. */
  readonly enableReferrerDetection?: boolean;
  /** The dev-mode localhost matcher. Default `true`. */
  readonly enableLocalhostMatching?: boolean;
  /** Which windows may post updates. Default `'parent-or-opener'`. */
  readonly eventSourcePolicy?: EventSourcePolicy;
  /**
   * Sanitizer policy for this client's rich text and HTML writes. Default
   * `'strict'`. Per instance: it leaves the
   * process default that `setSanitizerPolicy()` sets for direct `sanitizeHtml()` calls alone.
   */
  readonly sanitizerPolicy?: 'compat' | 'strict';
  /** `'v2'` is the one table since 3.0 removed `'v1'`; the option is left for a configuration that names it. */
  readonly defaults?: DefaultsProfile;
  /** Start the runtime in the constructor. Default `true`. */
  readonly autoStart?: boolean;
  /** Preview-token validator; every update must then carry a `previewToken` it approves. Stock Payload sends none. */
  readonly validateToken?: (
    token: string | undefined,
    origin: string,
  ) => boolean | Promise<boolean>;
}

/** The configuration with the defaults table applied: explicit options win. */
export function withProfileDefaults(config: LivePreviewClientConfig): LivePreviewClientConfig {
  refuseRemovedProfile(config);
  refuseTurnedSwitches(config);
  // The bare runtime's own fallbacks are older than the table for three of these rows, so the
  // client fills every one it was not given.
  const rows = V2_RUNTIME_DEFAULTS;
  return {
    ...config,
    skipUnchanged: config.skipUnchanged ?? rows.skipUnchanged,
    enableReferrerDetection: config.enableReferrerDetection ?? rows.enableReferrerDetection,
    eventSourcePolicy: config.eventSourcePolicy ?? rows.eventSourcePolicy,
    sanitizerPolicy: config.sanitizerPolicy ?? rows.sanitizerPolicy,
  };
}
