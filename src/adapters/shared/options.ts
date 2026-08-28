/**
 * The options every framework adapter shares. Each adapter's public interface
 * extends this with its request type, so the JSDoc lives here once. Defaults
 * are the 2.0 table; `defaults: 'v1'` values are noted where they differ.
 */

import type { DefaultsProfile, EventSourcePolicy } from '@core/defaults-profile';
import type { PreviewAuthorization } from '@security/preview-verdict';
import type { AuthorizedPreviewContext } from '@/types/authorized-preview';
import type { PreviewSignal } from './preview-request';

/**
 * What `authorizePreview` may resolve to; anything that is not a context
 * produced by `authorizePreviewRequest()` is a refusal, a
 * `{ authorized: true }` literal included.
 */
export type PreviewAuthorizationHookResult =
  PreviewAuthorization | AuthorizedPreviewContext | null | undefined;

export interface PreviewAdapterOptions<Req = Request> {
  /**
   * Payload admin origins allowed to post updates into the page and, with the
   * `referer` signal, to count as intent. Required and `https:` under
   * `strict`. Not HTTP authorization.
   */
  readonly allowedOrigins?: readonly string[];
  /** Payload server origin; updates are then re-fetched through its REST API, which needs an explicit `mergeDepth`. */
  readonly serverURL?: string;
  /** REST API route prefix used with `serverURL`. Default `/api`. */
  readonly apiRoute?: string;
  /** Population depth for `serverURL` re-fetches, required with it (`0` for none); `defaults: 'v1'` falls back to `1`. */
  readonly mergeDepth?: number;
  /** Inject the runtime into preview responses. Default `true`; with `false`, CSP is still managed. */
  readonly autoInject?: boolean;
  /** `'preview-only'` (default) gates on an intent signal; `'always'` treats every request as intent, so the hook runs on each. */
  readonly inject?: 'preview-only' | 'always';
  /** Query parameters (value `true` or `1`) that signal intent. Default `['preview', 'draft', 'livePreview']`. */
  readonly previewQueryParams?: readonly string[];
  /** Client-controlled signals that count as intent. Default `['query']`; `defaults: 'v1'` restores all three, `strict` refuses `'referer'`. */
  readonly previewSignals?: readonly PreviewSignal[];
  /**
   * Route or content filter for script injection only. Not authorization,
   * and it never suppresses CSP handling.
   */
  readonly shouldInject?: (request: Req) => boolean;
  /** `'frame-ancestors'` (default; `true` is an alias) widens that directive, `'full'` also manages a nonce'd `script-src`, `false` never touches CSP. */
  readonly manageCsp?: boolean | 'frame-ancestors' | 'full';
  /**
   * Add `'strict-dynamic'` to the managed `script-src`. Default `false`:
   * CSP 3 then ignores `'self'` and host sources, so every script on the
   * page — framework hydration included — must carry the nonce.
   */
  readonly strictDynamic?: boolean;
  /** Extra `frame-ancestors` sources beyond `'self'` and `allowedOrigins`. */
  readonly frameAncestorsExtra?: readonly string[];
  /** Extra `script-src` sources appended after the nonce (`manageCsp: 'full'`). */
  readonly scriptSrcExtra?: readonly string[];
  /** Verbose runtime logging. Default `false`. */
  readonly debug?: boolean;
  /** Debounce window for incoming updates. Default 50 ms. */
  readonly debounceMs?: number;
  /** Heartbeat timeout in ms. Default `0` (off): the Payload admin sends no keepalive. */
  readonly heartbeatMs?: number;
  /** Skip bindings whose value did not change. Default `true`; `defaults: 'v1'` restores `false`. */
  readonly skipUnchanged?: boolean;
  /** Scroll the preview to the field being edited. Default `false`. */
  readonly revealEditedField?: boolean;
  /** Patch only the bindings of the document an update names (`data-payload-owner`). Default `false`. */
  readonly scopeBindingsByOwner?: boolean;
  /** Sanitizer for rich text and HTML writes. Default `'strict'`; `defaults: 'v1'` restores `'compat'`. */
  readonly sanitizerPolicy?: 'compat' | 'strict';
  /** Which windows may post updates. Default `'parent-or-opener'`; `defaults: 'v1'` restores `'any'`. */
  readonly eventSourcePolicy?: EventSourcePolicy;
  /** Ignore `document.referrer` for origin detection. Default `true`; `defaults: 'v1'` restores `false`. */
  readonly disableReferrerDetection?: boolean;
  /** Turn off the dev-mode `localhost` origin matcher. Default `false`. */
  readonly disableLocalhostMatching?: boolean;
  /**
   * Verify an intent-bearing request before anything privileged is decided:
   * return the result of `authorizePreviewRequest()` (or its context), and
   * anything else refuses injection, CSP changes and nonce exposure
   * regardless of `autoInject` and `shouldInject`. Required under `strict`.
   * See ADR 0006.
   */
  readonly authorizePreview?: (
    request: Req,
  ) => PreviewAuthorizationHookResult | Promise<PreviewAuthorizationHookResult>;
  /** Refuse insecure configuration at startup: `authorizePreview`, https `allowedOrigins`, no referrer trust. Default `true`; `defaults: 'v1'` restores `false`. */
  readonly strict?: boolean;
  /** `'v2'` (default) is the 2.0 table, `'v1'` stages a migration on the 1.x one; explicit options win. See ADR 0007. */
  readonly defaults?: DefaultsProfile;
}
