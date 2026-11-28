/**
 * The options every framework adapter shares. Each adapter's public interface
 * extends this with its request type, so the JSDoc lives here once.
 */

import type { DefaultsProfile, EventSourcePolicy } from '@/runtime/types/defaults-profile';
import type { PreviewAuthorization } from '@security/preview-verdict';
import type { AuthorizedPreviewContext } from '@/runtime/types/authorized-preview';
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
  /** Population depth for `serverURL` re-fetches, required with it (`0` for none). */
  readonly mergeDepth?: number;
  /** Milliseconds the `serverURL` merge may wait before the update shows its raw values. Off by default. */
  readonly mergeTimeoutMs?: number;
  /** The route of a Lexical internal link with no `url` of its own, as `/{locale}/{slug}/`. */
  readonly internalLinkPattern?: string;
  /**
   * `'manual'` holds the runtime's first write until the page calls `markHydrated()`, capped at
   * five seconds, for a framework this adapter cannot observe. It replaces the wait the adapter
   * sets itself.
   */
  readonly hydration?: 'manual';
  /** Inject the runtime into preview responses. Default `true`; with `false`, CSP is still managed. */
  readonly autoInject?: boolean;
  /** `'preview-only'` (default) gates on an intent signal; `'always'` treats every request as intent, so the hook runs on each. */
  readonly inject?: 'preview-only' | 'always';
  /** Query parameters (value `true` or `1`) that signal intent. Default `['preview', 'draft', 'livePreview']`. */
  readonly previewQueryParams?: readonly string[];
  /** Client-controlled signals that count as intent. Default `['query']`; `'referer'` is refused at startup. */
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
  /** Hold an off-screen update until its element scrolls into view. Default `true`; `false` applies every update at once. */
  readonly enableVisibilityGate?: boolean;
  /**
   * Binding count above which off-screen updates wait until their element
   * scrolls into view. Default `50`. A preview nobody scrolls needs it raised,
   * or `enableVisibilityGate: false`.
   */
  readonly visibilityGateThreshold?: number;
  /** Skip bindings whose value did not change. Default `true`. */
  readonly skipUnchanged?: boolean;
  /** Scroll the preview to the field being edited. Default `false`. */
  readonly revealEditedField?: boolean;
  /**
   * How the runtime reaches the page. `'inline'` (default) puts it in the
   * response: nothing to mount, nothing to cache. `'asset'` injects a few
   * hundred bytes of bootstrap instead, which fetches the runtime as a
   * content-hashed, SRI-verified file — `immutable` for a year, so every
   * further preview page pays nothing for it. It needs the asset route
   * mounted; each adapter's page says where. (Astro publishes that file from
   * its own build instead: `mode: 'loader'` there.)
   */
  readonly delivery?: 'inline' | 'asset';
  /**
   * Where that asset route is mounted, as an absolute path. Default
   * `/payload-live-preview`. Set it when the app is not served from the site
   * root, so the bootstrap requests the path the framework actually routes.
   */
  readonly assetPath?: string;
  /**
   * Server-rendered fragment boundaries (ADR 0011): the same-origin path of
   * the route exporting `createFragmentEndpoint()`. The runtime then renders
   * every `data-payload-fragment` boundary through it, and its prelude carries
   * the route strategy as well. Default: none, and boundaries are patched.
   */
  readonly fragments?: { readonly endpoint: string };
  /**
   * Carry the route strategy: a binding in `<head>` or one marked
   * `data-payload-strategy="route"` then refreshes the route. Implied by
   * `fragments`, whose prelude already contains it.
   * `'after-save'` renders the route only once Payload reports a save: before it, a
   * GET shows nothing the editor typed and costs a server render. `'router'` does the
   * same and only through the route refresh the page lent, which `LivePreviewNavigation`
   * (Next.js), `livePreviewNavigation()` (SvelteKit) and the Nuxt module do: a page that
   * lent none is not fetched and morphed. Default: `'router'` in the Next.js, SvelteKit
   * and Nuxt adapters where no `fragments` endpoint is set (ADR 0007, row 40), else `false`.
   * In those three adapters `true` and `'after-save'` refresh through the lent refresh
   * alone as well: they decide when, and no longer fetch and morph (row 47).
   */
  readonly routeStrategy?: boolean | 'after-save' | 'router';
  /**
   * What to do when the runtime knows a patch cannot reach what the server
   * would have drawn — a value no renderer can represent, a Lexical block whose
   * markup the write drops, a changed field with no binding at all.
   * `'escalate'` (the default) has a server draw the region instead, so it
   * needs `routeStrategy` or `fragments` to do anything. `'warn'` reports
   * LP0411 and keeps the patch; `'ignore'` keeps it silently.
   */
  readonly onUnfaithfulPatch?: 'ignore' | 'warn' | 'escalate';
  /**
   * Find bindings by value on the connection's first message (ADR 0014): a
   * scalar whose value is the whole content of exactly one element is bound
   * to it as if `data-payload-field` stood there; a declared attribute always
   * wins and `data-payload-no-bind` keeps a subtree out. Default `'off'`.
   */
  readonly autoBind?: 'off' | 'unique';
  /** Patch only the bindings of the document an update names (`data-payload-owner`). Default `false`. */
  readonly scopeBindingsByOwner?: boolean;
  /**
   * How a group counts as covered (ADR 0022). `'declared'` (default since 3.0):
   * each changed path inside a group needs its own binding or a
   * `data-payload-covers` declaration; an uncovered one is an unbound change.
   * `'descendant'`, the 2.x default: one bound path inside a group covers all
   * of it.
   */
  readonly subfieldCoverage?: 'descendant' | 'declared';
  /** Sanitizer for rich text and HTML writes. Default `'strict'`. */
  readonly sanitizerPolicy?: 'compat' | 'strict';
  /** Which windows may post updates. Default `'parent-or-opener'`. */
  readonly eventSourcePolicy?: EventSourcePolicy;
  /** Take `document.referrer` as an origin source. Default `false`. */
  readonly enableReferrerDetection?: boolean;
  /** The dev-mode `localhost` origin matcher. Default `true`. */
  readonly enableLocalhostMatching?: boolean;
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
  /**
   * An adapter refuses insecure configuration at startup: it needs `authorizePreview`, non-empty
   * `allowedOrigins` (`https:` in production) and no `'referer'` signal. 2.x could switch that off
   * with `strict: false`; 3.0 cannot (ADR 0007, row 36), and the option is left for a
   * configuration that says `true`.
   */
  readonly strict?: true;
  /** `'v2'` is the one table since 3.0 removed `'v1'` (ADR 0007, row 21); the option is left for a configuration that names it. */
  readonly defaults?: DefaultsProfile;
}
