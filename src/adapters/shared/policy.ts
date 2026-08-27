/**
 * The preview policy every framework adapter applies.
 *
 * Four adapters used to carry the same decisions four times: whether a
 * request shows preview intent, whether the runtime is injected into the
 * response, which CSP directives are added, how the inline script is built
 * from the options, and how it lands in `<head>`. The framework-specific part
 * — a `Response` here, a Nitro `head` array there, `locals` versus `context`
 * for the nonce — is small; the policy was the bulk, and it was copied.
 *
 * This module is the one copy. It is pure: it never touches a response, a
 * DOM, or a header object, and it takes the request only as the minimal
 * `{ url, headers.get }` shape the intent check needs. An adapter translates
 * its framework's request into that shape, asks for a decision, and applies
 * it to its framework's response. The decision does not depend on the
 * framework, which is what makes the four adapters comparable and what the
 * 1.1.0 work needs: gating every response mutation on an authorized context
 * is one change here rather than four.
 *
 * Nothing about the decisions changes with this module. The four adapters'
 * unit tests were written against their previous, duplicated code and pass
 * unchanged against this — that is the refactor's proof.
 *
 * @module @adapters/shared/policy
 */

import {
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  generateCspNonce,
  mergeCspHeader,
} from '@security/csp';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import { isPreviewRequest, type PreviewRequestLike, type PreviewSignal } from './preview-request';

/** How the adapter manages Content-Security-Policy, normalised. */
export type CspMode = false | 'frame-ancestors' | 'full';

/**
 * The options every adapter shares. Each adapter declares its own public
 * interface — those are part of its API report — and this is the structural
 * subset the policy reads from any of them.
 */
export interface PreviewPolicyOptions {
  readonly allowedOrigins?: readonly string[];
  readonly serverURL?: string;
  readonly apiRoute?: string;
  readonly mergeDepth?: number;
  readonly debug?: boolean;
  readonly debounceMs?: number;
  readonly heartbeatMs?: number;
  readonly skipUnchanged?: boolean;
  readonly inject?: 'preview-only' | 'always';
  readonly autoInject?: boolean;
  readonly previewQueryParams?: readonly string[];
  readonly previewSignals?: readonly PreviewSignal[];
  readonly manageCsp?: boolean | 'frame-ancestors' | 'full';
  readonly strictDynamic?: boolean;
  readonly frameAncestorsExtra?: readonly string[];
  readonly scriptSrcExtra?: readonly string[];
}

/** Matches the opening `<head>` tag the runtime script is inserted after. */
export const HEAD_INSERT = /<head(\s[^>]*)?>/i;

/** `text/html` with or without parameters. */
export const HTML_CONTENT_TYPE = /text\/html/i;

/**
 * The inline-script configuration an adapter's options describe.
 *
 * Only options that were given are forwarded, so the generated config carries
 * no defaults of its own and the runtime's defaults stay the single source of
 * them — the wire-format tests pin that an empty options object yields an
 * empty config.
 */
export function inlineScriptConfig(
  options: PreviewPolicyOptions,
): Parameters<typeof generateInlineScript>[0] {
  return {
    ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.serverURL !== undefined ? { serverURL: options.serverURL } : {}),
    ...(options.apiRoute !== undefined ? { apiRoute: options.apiRoute } : {}),
    ...(options.mergeDepth !== undefined ? { mergeDepth: options.mergeDepth } : {}),
    ...(options.debug !== undefined ? { debug: options.debug } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.skipUnchanged !== undefined ? { skipUnchanged: options.skipUnchanged } : {}),
  };
}

/** `manageCsp` as the adapters have always read it: unset and `true` both mean frame-ancestors only. */
export function normalizeCspMode(value: PreviewPolicyOptions['manageCsp']): CspMode {
  if (value === false) return false;
  if (value === 'full') return 'full';
  return 'frame-ancestors';
}

/**
 * Whether the request shows preview intent under these options.
 *
 * Intent, not authorization: a query parameter, an iframe fetch destination or
 * an admin referer says an editor *may* be looking, and nothing more. The
 * name is deliberately the one the roadmap reserves for the public honest
 * replacement of `isPreviewRequest()`; when that lands this is the function
 * it exports.
 */
export function hasPreviewIntent(
  request: PreviewRequestLike,
  options: PreviewPolicyOptions,
): boolean {
  return (
    (options.inject ?? 'preview-only') === 'always' ||
    isPreviewRequest(request, {
      ...(options.previewQueryParams !== undefined
        ? { queryParams: options.previewQueryParams }
        : {}),
      ...(options.previewSignals !== undefined ? { signals: options.previewSignals } : {}),
      adminOrigins: options.allowedOrigins ?? [],
    })
  );
}

/**
 * The Content-Security-Policy header value after the preview directives are
 * merged into `existing`. `frame-ancestors` always; `script-src` with the
 * nonce only in `'full'` mode, since tightening script-src silently would
 * break unrelated application scripts.
 */
export function buildPreviewCsp(
  options: PreviewPolicyOptions,
  nonce: string,
  existing: string,
  mode: Exclude<CspMode, false>,
): string {
  const additions: Record<string, string> = {
    'frame-ancestors': buildFrameAncestors({
      self: true,
      origins: [...(options.allowedOrigins ?? []), ...(options.frameAncestorsExtra ?? [])],
    }),
  };
  if (mode === 'full') {
    additions['script-src'] = buildScriptSrcWithNonce(nonce, {
      self: true,
      strictDynamic: options.strictDynamic ?? false,
      ...(options.scriptSrcExtra !== undefined ? { extra: options.scriptSrcExtra } : {}),
    });
  }
  return mergeCspHeader(existing, additions);
}

/**
 * `html` with the script tag inserted after the opening `<head>`, or
 * `undefined` when the document has no `<head>` — a fragment or a streamed
 * chunk — in which case the caller leaves it untouched rather than prepending
 * a script ahead of the fragment's own markup.
 */
export function injectIntoHead(html: string, scriptTag: string): string | undefined {
  if (!HEAD_INSERT.test(html)) return undefined;
  return html.replace(HEAD_INSERT, (match) => `${match}${scriptTag}`);
}

/** What the policy decided for one request. */
export interface PreviewDecision {
  /** The request shows preview intent (or the adapter injects always). */
  readonly isPreview: boolean;
  /** The runtime is to be injected: intent, `autoInject`, and the adapter's own content filter all agreed. */
  readonly inject: boolean;
  /** CSP directives to add, or `false` for none. Never set without intent. */
  readonly cspMode: CspMode;
}

/**
 * A policy bound to one adapter's options. The inline script body is built
 * once and reused: it depends only on the options, never on the request.
 */
export interface PreviewPolicy {
  /**
   * Decide for a request. `shouldInject` is the adapter's content filter,
   * bound to the framework's own request type and evaluated lazily: the
   * adapters have always consulted it only once intent was established, and
   * a consumer's filter must not start running on every ordinary request. It
   * gates injection only — never CSP — which is what `shouldInject` has
   * always meant and what the docs say it is not: an authorization boundary.
   */
  decide(request: PreviewRequestLike, shouldInject?: () => boolean): PreviewDecision;
  /** The `<script>` tag for this policy's runtime, carrying `nonce`. */
  scriptTag(nonce: string): string;
  /** CSP header value for a decision that has a mode. */
  csp(existing: string, nonce: string, mode: Exclude<CspMode, false>): string;
  /** A fresh nonce. Adapters that reuse a nonce from the response call this only when there is none. */
  nonce(): string;
}

export function createPreviewPolicy(options: PreviewPolicyOptions): PreviewPolicy {
  const cspMode = normalizeCspMode(options.manageCsp);
  const autoInject = options.autoInject ?? true;
  let body: string | undefined;
  const scriptBody = (): string => {
    body ??= generateInlineScript(inlineScriptConfig(options));
    return body;
  };
  return {
    decide(request, shouldInject) {
      const isPreview = hasPreviewIntent(request, options);
      return {
        isPreview,
        inject: isPreview && autoInject && (shouldInject?.() ?? true),
        cspMode: isPreview ? cspMode : false,
      };
    },
    scriptTag: (nonce) => wrapWithScriptTag(scriptBody(), { nonce }),
    csp: (existing, nonce, mode) => buildPreviewCsp(options, nonce, existing, mode),
    nonce: () => generateCspNonce(),
  };
}
