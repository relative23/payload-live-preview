/**
 * `LivePreviewClient` configuration. Defaults are the 2.0 rows; `defaults: 'v1'`
 * restores the 1.x values named per option (ADR 0007).
 */

import type { CachedElement, FieldRenderer, RendererKey, RichTextRenderer } from '@core/types';
import type { StrategyHandlers } from '@core/strategies';
import {
  runtimeDefaultsFor,
  type DefaultsProfile,
  type EventSourcePolicy,
} from '@core/defaults-profile';

export interface LivePreviewClientConfig {
  /** Explicit trusted admin origins. */
  readonly allowedOrigins?: readonly string[];
  /** Payload origin; every update is then re-fetched through the REST API so relations arrive populated. Requires `mergeDepth`. */
  readonly serverURL?: string;
  /** REST route prefix used with `serverURL`. Default `/api`. */
  readonly apiRoute?: string;
  /** Population depth used with `serverURL`. Required with it; `defaults: 'v1'` falls back to `1`. */
  readonly mergeDepth?: number;
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
  /** Skip a binding whose value did not change. Default `true`; `defaults: 'v1'` sets `false`. */
  readonly skipUnchanged?: boolean;
  /** Scroll the preview to the field being edited when its value changes. Default `false`. */
  readonly revealEditedField?: boolean;
  /** Fields whose change re-applies other bindings regardless of their own value: `{ price: ['priceLabel'] }`. Used with `skipUnchanged`. */
  readonly dependencies?: Readonly<Record<string, readonly string[]>>;
  /** Strategy handlers beyond patching; `createFragmentStrategy()` from `payload-live-preview/fragment` builds one. */
  readonly strategies?: StrategyHandlers;
  /** Apply every update regardless of visibility. Default `false`. */
  readonly disableVisibilityGate?: boolean;
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
  /** Ignore `document.referrer` as an origin source. Default `true`; `defaults: 'v1'` sets `false`. */
  readonly disableReferrerDetection?: boolean;
  /** Disable the dev-mode localhost matcher. Default `false`. */
  readonly disableLocalhostMatching?: boolean;
  /** Which windows may post updates. Default `'parent-or-opener'`; `defaults: 'v1'` sets `'any'`. */
  readonly eventSourcePolicy?: EventSourcePolicy;
  /**
   * Sanitizer policy for this client's rich text and HTML writes. Default
   * `'strict'`; `defaults: 'v1'` sets `'compat'`. Per instance: it leaves the
   * process default that `setSanitizerPolicy()` sets for direct `sanitizeHtml()` calls alone.
   */
  readonly sanitizerPolicy?: 'compat' | 'strict';
  /** `'v2'` (default) is the 2.0 table; `'v1'` restores every 1.x row at once. Explicit options win. */
  readonly defaults?: DefaultsProfile;
  /** Start the runtime in the constructor. Default `true`. */
  readonly autoStart?: boolean;
  /** Preview-token validator; every update must then carry a `previewToken` it approves. Stock Payload sends none. */
  readonly validateToken?: (
    token: string | undefined,
    origin: string,
  ) => boolean | Promise<boolean>;
}

/** The configuration with the `defaults` profile applied: explicit options win, `'v1'` changes nothing. */
export function withProfileDefaults(config: LivePreviewClientConfig): LivePreviewClientConfig {
  // `'v1'` fills the rows too: the runtime's own fallbacks are the 2.0 values
  // since the default flip, so leaving the config alone would hand a v1 client
  // the strict sanitizer and `skipUnchanged` it opted out of.
  const rows = runtimeDefaultsFor(config.defaults);
  return {
    ...config,
    skipUnchanged: config.skipUnchanged ?? rows.skipUnchanged,
    disableReferrerDetection: config.disableReferrerDetection ?? rows.disableReferrerDetection,
    eventSourcePolicy: config.eventSourcePolicy ?? rows.eventSourcePolicy,
    sanitizerPolicy: config.sanitizerPolicy ?? rows.sanitizerPolicy,
  };
}
