/**
 * The preview policy every framework adapter applies: intent, authorization,
 * injection, CSP. Pure — it reads a `{ url, headers.get }` request shape and
 * never touches a response; the adapter translates both ends. See ADR 0006.
 */

import {
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  generateCspNonce,
  mergeCspHeader,
} from '@security/csp';
import { isPreviewConfigurationError } from '@security/preview-verdict';
import type { PreviewAuthorizationOutcome } from '@security/preview-verdict';
// From the leaf `types` domain on purpose: the security module would pull the
// HMAC and session code into every adapter bundle for a ten-line brand check.
import {
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
} from '@/types/authorized-preview';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import {
  adapterDefaultsFor,
  runtimeDefaultsFor,
  V2_RUNTIME_DEFAULTS,
} from '@core/defaults-profile';
import { hasPreviewIntent, type PreviewRequestLike, type PreviewSignal } from './preview-request';
import { isDevelopmentProcess, warnOnce } from './dev-warning';
import type { PreviewAdapterOptions, PreviewAuthorizationHookResult } from './options';

export type { PreviewAuthorizationHookResult } from './options';

/** How the adapter manages Content-Security-Policy, normalised. */
export type CspMode = false | 'frame-ancestors' | 'full';

/** The structural subset of any adapter's options the policy reads; hooks are bound per request. */
export interface PreviewPolicyOptions extends PreviewAdapterOptions<never> {
  /** Server-rendered fragment boundaries (ADR 0011): the same-origin endpoint the runtime posts to. */
  readonly fragments?: { readonly endpoint: string };
}

/** The opening `<head>` tag the runtime script is inserted into. */
export const HEAD_INSERT = /<head(\s[^>]*)?>/i;

/** `text/html` with or without parameters. */
export const HTML_CONTENT_TYPE = /text\/html/i;

// Browsers prescan only the first 1024 bytes for the encoding; a script
// inserted ahead of `<meta charset>` would push it out of that window.
const META_CHARSET =
  /<meta\s+(?:[^>]*\s)?(?:charset\s*=|http-equiv\s*=\s*["']?content-type)[^>]*>/i;

/** The options after the `defaults` profile: explicit options win, the profile fills the rest. */
export interface ResolvedPolicyOptions {
  readonly strict: boolean;
  readonly previewSignals: readonly PreviewSignal[] | undefined;
  readonly skipUnchanged: boolean | undefined;
  readonly disableReferrerDetection: boolean | undefined;
  readonly disableLocalhostMatching: boolean | undefined;
  readonly eventSourcePolicy: 'any' | 'parent-or-opener' | undefined;
  readonly sanitizerPolicy: 'compat' | 'strict' | undefined;
}

export function resolvePolicyOptions(options: PreviewPolicyOptions): ResolvedPolicyOptions {
  const adapter = adapterDefaultsFor(options.defaults);
  const runtime = runtimeDefaultsFor(options.defaults);
  // The inline runtime already defaults to the v2 rows, so only a differing
  // profile — an explicit `defaults: 'v1'` — needs a row on the wire.
  const runtimeRow = <K extends keyof typeof V2_RUNTIME_DEFAULTS>(
    key: K,
  ): (typeof V2_RUNTIME_DEFAULTS)[K] | undefined =>
    runtime[key] !== V2_RUNTIME_DEFAULTS[key] ? runtime[key] : undefined;
  return {
    strict: options.strict ?? adapter.strict,
    previewSignals: options.previewSignals ?? adapter.previewSignals,
    skipUnchanged: options.skipUnchanged ?? runtimeRow('skipUnchanged'),
    disableReferrerDetection:
      options.disableReferrerDetection ?? runtimeRow('disableReferrerDetection'),
    disableLocalhostMatching: options.disableLocalhostMatching,
    eventSourcePolicy: options.eventSourcePolicy ?? runtimeRow('eventSourcePolicy'),
    sanitizerPolicy: options.sanitizerPolicy ?? runtimeRow('sanitizerPolicy'),
  };
}

/** The inline-script configuration; only given options travel, so the runtime's own defaults stay the single source of them. */
export function inlineScriptConfig(
  options: PreviewPolicyOptions,
): Parameters<typeof generateInlineScript>[0] {
  assertMergeDepthExplicit(options);
  const resolved = resolvePolicyOptions(options);
  return {
    // Not a wire slot: it tells the generator an omitted `mergeDepth` is deliberate.
    ...(options.defaults !== undefined ? { defaults: options.defaults } : {}),
    ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.serverURL !== undefined ? { serverURL: options.serverURL } : {}),
    ...(options.apiRoute !== undefined ? { apiRoute: options.apiRoute } : {}),
    ...(options.mergeDepth !== undefined ? { mergeDepth: options.mergeDepth } : {}),
    ...(options.revealEditedField !== undefined
      ? { revealEditedField: options.revealEditedField }
      : {}),
    ...(options.debug !== undefined ? { debug: options.debug } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(resolved.skipUnchanged !== undefined ? { skipUnchanged: resolved.skipUnchanged } : {}),
    ...(options.scopeBindingsByOwner !== undefined
      ? { scopeBindingsByOwner: options.scopeBindingsByOwner }
      : {}),
    ...(resolved.disableReferrerDetection !== undefined
      ? { disableReferrerDetection: resolved.disableReferrerDetection }
      : {}),
    ...(resolved.disableLocalhostMatching !== undefined
      ? { disableLocalhostMatching: resolved.disableLocalhostMatching }
      : {}),
    ...(resolved.eventSourcePolicy !== undefined
      ? { eventSourcePolicy: resolved.eventSourcePolicy }
      : {}),
    ...(resolved.sanitizerPolicy !== undefined
      ? { sanitizerPolicy: resolved.sanitizerPolicy }
      : {}),
    ...(options.fragments !== undefined ? { fragmentEndpoint: options.fragments.endpoint } : {}),
  };
}

/** `manageCsp` normalised: unset and `true` both mean frame-ancestors only. */
export function normalizeCspMode(value: PreviewPolicyOptions['manageCsp']): CspMode {
  if (value === false) return false;
  if (value === 'full') return 'full';
  return 'frame-ancestors';
}

/** Whether the request shows preview intent under the options; `inject: 'always'` counts as intent. */
export function previewIntentFor(
  request: PreviewRequestLike,
  options: PreviewPolicyOptions,
): boolean {
  const signals = resolvePolicyOptions(options).previewSignals;
  return (
    (options.inject ?? 'preview-only') === 'always' ||
    hasPreviewIntent(request, {
      ...(options.previewQueryParams !== undefined
        ? { queryParams: options.previewQueryParams }
        : {}),
      ...(signals !== undefined ? { signals } : {}),
      adminOrigins: options.allowedOrigins ?? [],
    })
  );
}

/** The CSP header after merging: `frame-ancestors` always, a nonce'd `script-src` only in `'full'` mode. */
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
 * `html` with the script tag after `<meta charset>`, else right after
 * `<head>`; `undefined` when there is no `<head>` to insert into.
 */
export function injectIntoHead(html: string, scriptTag: string): string | undefined {
  const head = HEAD_INSERT.exec(html);
  if (head === null) return undefined;
  const headEnd = head.index + head[0].length;
  const headClose = html.indexOf('</head', headEnd);
  const meta = META_CHARSET.exec(html.slice(headEnd, headClose === -1 ? undefined : headClose));
  const at = meta === null ? headEnd : headEnd + meta.index + meta[0].length;
  return `${html.slice(0, at)}${scriptTag}${html.slice(at)}`;
}

/** `serverURL` needs an explicit `mergeDepth` (ADR 0007, entry 10); `defaults: 'v1'` keeps the old default of 1. */
export function assertMergeDepthExplicit(options: PreviewPolicyOptions): void {
  if (options.defaults === 'v1') return;
  if (options.serverURL !== undefined && options.mergeDepth === undefined) {
    throw new Error(
      'payload-live-preview: `serverURL` needs an explicit `mergeDepth` under the 2.0 defaults — ' +
        'choose the relationship population depth deliberately (0 for none). ' +
        "Pass `defaults: 'v1'` to keep the 1.x default of 1 while migrating (ADR 0007, entry 10).",
    );
  }
}

/** The configuration errors `strict` exists to raise, at startup rather than on a public response. */
export function assertStrictConfiguration(options: PreviewPolicyOptions): void {
  if (typeof options.authorizePreview !== 'function') {
    throw new Error(
      'payload-live-preview: strict mode requires `authorizePreview` — response changes ' +
        'must be gated on a verified context, not on intent (ADR 0006).',
    );
  }
  const origins = options.allowedOrigins ?? [];
  if (origins.length === 0) {
    throw new Error(
      'payload-live-preview: strict mode requires explicit, non-empty `allowedOrigins`.',
    );
  }
  if (!isDevelopmentProcess()) {
    for (const origin of origins) {
      let protocol: string | undefined;
      try {
        protocol = new URL(origin).protocol;
      } catch {
        protocol = undefined;
      }
      if (protocol !== 'https:') {
        throw new Error(
          `payload-live-preview: strict mode requires https admin origins in production; got "${origin}".`,
        );
      }
    }
  }
  // The resolved signals, not the option: `defaults: 'v1'` fills in `referer`.
  if (resolvePolicyOptions(options).previewSignals?.includes('referer') === true) {
    throw new Error(
      "payload-live-preview: strict mode disables referrer trust; remove 'referer' from " +
        "`previewSignals` (the 'v1' profile includes it).",
    );
  }
}

/** What the policy decided for one request. */
export interface PreviewDecision {
  /** The request shows preview intent (or the adapter injects always). */
  readonly isPreview: boolean;
  /** The verified context, or `null` when there was no hook or it refused. */
  readonly authorization: AuthorizedPreviewContext | null;
  /** The hook's verdict, or `undefined` when no hook ran (no intent, or none configured). */
  readonly outcome: PreviewAuthorizationOutcome | undefined;
  /** Intent, authorization, `autoInject` and the adapter's content filter all agreed. */
  readonly inject: boolean;
  /** CSP directives to add, or `false`. Never set without intent, never after a refusal. */
  readonly cspMode: CspMode;
  /** Whether the request-scoped nonce may be handed to templates. */
  readonly exposeNonce: boolean;
}

/** The per-request hooks an adapter binds to its own request type. */
export interface PreviewDecisionHooks {
  /** The adapter's content filter, evaluated lazily once injection is otherwise decided. */
  readonly shouldInject?: () => boolean;
  /** The adapter's `authorizePreview` option, bound to the framework request. Called only on intent. */
  readonly authorize?: () =>
    PreviewAuthorizationHookResult | Promise<PreviewAuthorizationHookResult>;
}

/** A policy bound to one adapter's options. The script body depends on the options only and is built once. */
export interface PreviewPolicy {
  /**
   * Decide for a request: `hooks.authorize` runs only on intent, and a
   * `PreviewConfigurationError` from it is re-thrown while any other failure
   * becomes the `'unavailable'` refusal.
   */
  decide(request: PreviewRequestLike, hooks?: PreviewDecisionHooks): Promise<PreviewDecision>;
  /** The `<script>` tag for this policy's runtime, carrying `nonce`. */
  scriptTag(nonce: string): string;
  /** CSP header value for a decision that has a mode. */
  csp(existing: string, nonce: string, mode: Exclude<CspMode, false>): string;
  /** A fresh nonce. */
  nonce(): string;
  /** Whether `authorizePreview` is configured; `decide()` then requires the bound hook. */
  readonly authorizes: boolean;
}

const NONE: PreviewDecision = Object.freeze({
  isPreview: false,
  authorization: null,
  outcome: undefined,
  inject: false,
  cspMode: false,
  exposeNonce: false,
});

function contextFrom(result: PreviewAuthorizationHookResult): {
  readonly context: AuthorizedPreviewContext | null;
  readonly outcome: PreviewAuthorizationOutcome;
} {
  if (isAuthorizedPreviewContext(result)) return { context: result, outcome: 'authorized' };
  if (typeof result === 'object' && result !== null && 'authorized' in result) {
    if (result.authorized && isAuthorizedPreviewContext(result.context)) {
      return { context: result.context, outcome: 'authorized' };
    }
    return { context: null, outcome: result.authorized ? 'invalid' : result.outcome };
  }
  // `null`, `undefined`, a boolean, a look-alike literal: refused.
  return { context: null, outcome: 'invalid' };
}

export function createPreviewPolicy(options: PreviewPolicyOptions): PreviewPolicy {
  const resolved = resolvePolicyOptions(options);
  assertMergeDepthExplicit(options);
  const authorizes = typeof options.authorizePreview === 'function';
  if (resolved.strict) {
    assertStrictConfiguration(options);
  } else if (!authorizes) {
    warnOnce(
      'intent-only-preview',
      'preview responses are gated on client-controlled intent only. Configure `authorizePreview` ' +
        '(see authorizePreviewRequest) before production; `strict: true` enforces it. ' +
        'ADR 0006 explains why intent is not authorization.',
    );
  }
  const cspMode = normalizeCspMode(options.manageCsp);
  const autoInject = options.autoInject ?? true;
  let body: string | undefined;
  const scriptBody = (): string => {
    body ??= generateInlineScript(inlineScriptConfig(options));
    return body;
  };
  return {
    authorizes,
    async decide(request, hooks = {}) {
      if (authorizes && hooks.authorize === undefined) {
        throw new Error(
          'payload-live-preview: `authorizePreview` is configured but decide() was called ' +
            'without an `authorize` hook; bind the hook to the request (bindDecisionHooks).',
        );
      }
      const isPreview = previewIntentFor(request, options);
      if (!isPreview) return NONE;
      let authorization: AuthorizedPreviewContext | null = null;
      let outcome: PreviewAuthorizationOutcome | undefined;
      if (hooks.authorize !== undefined) {
        let result: PreviewAuthorizationHookResult;
        try {
          result = await hooks.authorize();
        } catch (error) {
          if (isPreviewConfigurationError(error)) throw error;
          result = { authorized: false, outcome: 'unavailable', context: null };
        }
        ({ context: authorization, outcome } = contextFrom(result));
        if (authorization === null) {
          return {
            isPreview,
            authorization,
            outcome,
            inject: false,
            cspMode: false,
            exposeNonce: false,
          };
        }
      }
      return {
        isPreview,
        authorization,
        outcome,
        inject: autoInject && (hooks.shouldInject?.() ?? true),
        cspMode,
        exposeNonce: true,
      };
    },
    scriptTag: (nonce) => wrapWithScriptTag(scriptBody(), { nonce }),
    csp: (existing, nonce, mode) => buildPreviewCsp(options, nonce, existing, mode),
    nonce: () => generateCspNonce(),
  };
}
