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
 * it to its framework's response.
 *
 * Since 1.1.0 the decision has an authorization step (ADR 0006): when the
 * adapter is configured with `authorizePreview`, a request with intent is
 * verified before anything privileged is decided, and a refusal blocks
 * injection, CSP changes and nonce exposure regardless of `autoInject` or
 * `shouldInject`. Without the hook the 1.0 behaviour — intent only — remains
 * through 1.x, announced once per process outside production; `strict` (and
 * therefore `defaults: 'v2'`) refuses to run without it.
 *
 * @module @adapters/shared/policy
 */

import {
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  generateCspNonce,
  mergeCspHeader,
} from '@security/csp';
import type {
  PreviewAuthorization,
  PreviewAuthorizationOutcome,
} from '@security/preview-authorization';
// The brand check comes from the leaf `types` domain on purpose: importing it
// through the security module would pull the HMAC and session code into
// every adapter bundle for a check that is ten lines long.
import {
  isAuthorizedPreviewContext,
  type AuthorizedPreviewContext,
} from '@/types/authorized-preview';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import {
  adapterDefaultsFor,
  runtimeDefaultsFor,
  V2_RUNTIME_DEFAULTS,
  type DefaultsProfile,
} from '@core/defaults-profile';
import { hasPreviewIntent, type PreviewRequestLike, type PreviewSignal } from './preview-request';
import { isDevelopmentProcess, warnOnce } from './deprecation';

/** How the adapter manages Content-Security-Policy, normalised. */
export type CspMode = false | 'frame-ancestors' | 'full';

/**
 * What an adapter's `authorizePreview` hook may resolve to: the full result
 * of `authorizePreviewRequest()`, a bare context, or nothing. Anything that is
 * not a context produced by `authorizePreviewRequest()` is a refusal — a
 * `{ authorized: true }` literal included.
 */
export type PreviewAuthorizationHookResult =
  PreviewAuthorization | AuthorizedPreviewContext | null | undefined;

/**
 * The options every adapter shares. Each adapter declares its own public
 * interface — those are part of its API report — and this is the structural
 * subset the policy reads from any of them. `authorizePreview` is typed
 * loosely here because each adapter binds it to its own request type; the
 * policy only needs to know whether it exists.
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
  readonly scopeBindingsByOwner?: boolean;
  readonly sanitizerPolicy?: 'compat' | 'strict';
  /** Server-rendered fragment boundaries (ADR 0011): the same-origin endpoint the runtime posts to. */
  readonly fragments?: { readonly endpoint: string };
  readonly inject?: 'preview-only' | 'always';
  readonly autoInject?: boolean;
  readonly previewQueryParams?: readonly string[];
  readonly previewSignals?: readonly PreviewSignal[];
  readonly manageCsp?: boolean | 'frame-ancestors' | 'full';
  readonly strictDynamic?: boolean;
  readonly frameAncestorsExtra?: readonly string[];
  readonly scriptSrcExtra?: readonly string[];
  readonly strict?: boolean;
  readonly defaults?: DefaultsProfile;
  readonly authorizePreview?: (...args: never[]) => unknown;
}

/** Matches the opening `<head>` tag the runtime script is inserted after. */
export const HEAD_INSERT = /<head(\s[^>]*)?>/i;

/** `text/html` with or without parameters. */
export const HTML_CONTENT_TYPE = /text\/html/i;

/**
 * The options after the `defaults` profile is applied: explicit options win,
 * the profile fills the rest, and `v1` fills nothing so an empty options
 * object still yields an empty inline configuration.
 */
export interface ResolvedPolicyOptions {
  readonly strict: boolean;
  readonly previewSignals: readonly PreviewSignal[] | undefined;
  readonly skipUnchanged: boolean | undefined;
  readonly disableReferrerDetection: boolean | undefined;
  readonly eventSourcePolicy: 'any' | 'parent-or-opener' | undefined;
  readonly sanitizerPolicy: 'compat' | 'strict' | undefined;
}

export function resolvePolicyOptions(options: PreviewPolicyOptions): ResolvedPolicyOptions {
  const adapter = adapterDefaultsFor(options.defaults);
  const runtime = runtimeDefaultsFor(options.defaults);
  // 2.0: the inline runtime defaults to the v2 rows, so a row is written into
  // the inline configuration only when the resolved profile differs from that
  // — i.e. for an explicit `defaults: 'v1'` consumer staging the migration.
  const runtimeRow = <K extends keyof typeof V2_RUNTIME_DEFAULTS>(
    key: K,
  ): (typeof V2_RUNTIME_DEFAULTS)[K] | undefined =>
    runtime[key] !== V2_RUNTIME_DEFAULTS[key] ? runtime[key] : undefined;
  return {
    strict: options.strict ?? adapter.strict,
    previewSignals: options.previewSignals ?? adapter.previewSignals,
    skipUnchanged: options.skipUnchanged ?? runtimeRow('skipUnchanged'),
    disableReferrerDetection: runtimeRow('disableReferrerDetection'),
    eventSourcePolicy: runtimeRow('eventSourcePolicy'),
    sanitizerPolicy: options.sanitizerPolicy ?? runtimeRow('sanitizerPolicy'),
  };
}

/**
 * The inline-script configuration an adapter's options describe.
 *
 * Only options that were given are forwarded, so the generated config carries
 * no defaults of its own and the runtime's defaults stay the single source of
 * them — the wire-format tests pin that an empty options object yields an
 * empty config. `defaults: 'v2'` adds exactly the runtime rows the profile
 * flips.
 */
export function inlineScriptConfig(
  options: PreviewPolicyOptions,
): Parameters<typeof generateInlineScript>[0] {
  const resolved = resolvePolicyOptions(options);
  return {
    ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.serverURL !== undefined ? { serverURL: options.serverURL } : {}),
    ...(options.apiRoute !== undefined ? { apiRoute: options.apiRoute } : {}),
    ...(options.mergeDepth !== undefined ? { mergeDepth: options.mergeDepth } : {}),
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
    ...(resolved.eventSourcePolicy !== undefined
      ? { eventSourcePolicy: resolved.eventSourcePolicy }
      : {}),
    ...(resolved.sanitizerPolicy !== undefined
      ? { sanitizerPolicy: resolved.sanitizerPolicy }
      : {}),
    ...(options.fragments !== undefined ? { fragmentEndpoint: options.fragments.endpoint } : {}),
  };
}

/** `manageCsp` as the adapters have always read it: unset and `true` both mean frame-ancestors only. */
export function normalizeCspMode(value: PreviewPolicyOptions['manageCsp']): CspMode {
  if (value === false) return false;
  if (value === 'full') return 'full';
  return 'frame-ancestors';
}

/**
 * Whether the request shows preview intent under an adapter's options —
 * `hasPreviewIntent()` with the adapter's option names, plus `inject: 'always'`.
 *
 * Intent, not authorization: a query parameter, an iframe fetch destination or
 * an admin referer says an editor *may* be looking, and nothing more.
 */
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

/**
 * Raise the configuration errors `strict` exists to raise. Called once when
 * the policy is created, so a misconfigured deployment fails at startup
 * rather than serving public responses quietly.
 */
/**
 * 2.0 (ADR 0007, entry 10): when a deployment enables server-side merging by
 * setting `serverURL`, it must also choose a `mergeDepth` rather than inherit
 * a silent default. Under an explicit `defaults: 'v1'` the 1.x default (depth
 * 1) still applies, so a staged migration keeps working.
 */
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
  if (options.previewSignals?.includes('referer') === true) {
    throw new Error(
      "payload-live-preview: strict mode disables referrer trust; remove 'referer' from `previewSignals`.",
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
  /** The runtime is to be injected: intent, authorization, `autoInject` and the adapter's own content filter all agreed. */
  readonly inject: boolean;
  /** CSP directives to add, or `false` for none. Never set without intent, never set after a refusal. */
  readonly cspMode: CspMode;
  /** Whether the request-scoped nonce may be handed to templates (`locals`, `context`, a header). */
  readonly exposeNonce: boolean;
}

/** The per-request hooks an adapter binds to its own request type. */
export interface PreviewDecisionHooks {
  /** The adapter's content filter, evaluated lazily and only once injection is otherwise decided. */
  readonly shouldInject?: () => boolean;
  /** The adapter's `authorizePreview` option, bound to the framework request. Called only on intent. */
  readonly authorize?: () =>
    PreviewAuthorizationHookResult | Promise<PreviewAuthorizationHookResult>;
}

/**
 * A policy bound to one adapter's options. The inline script body is built
 * once and reused: it depends only on the options, never on the request.
 */
export interface PreviewPolicy {
  /**
   * Decide for a request. `hooks.authorize` runs only when intent was found,
   * so public requests never pay for a verification; `hooks.shouldInject`
   * runs only when injection is otherwise decided. `shouldInject` gates
   * injection only — never CSP — which is what it has always meant and what
   * the docs say it is not: an authorization boundary.
   */
  decide(request: PreviewRequestLike, hooks?: PreviewDecisionHooks): Promise<PreviewDecision>;
  /** The `<script>` tag for this policy's runtime, carrying `nonce`. */
  scriptTag(nonce: string): string;
  /** CSP header value for a decision that has a mode. */
  csp(existing: string, nonce: string, mode: Exclude<CspMode, false>): string;
  /** A fresh nonce. Adapters that reuse a nonce from the response call this only when there is none. */
  nonce(): string;
  /** Whether `authorizePreview` is configured — adapters use it to decide whether to bind the hook. */
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
      const isPreview = previewIntentFor(request, options);
      if (!isPreview) return NONE;
      let authorization: AuthorizedPreviewContext | null = null;
      let outcome: PreviewAuthorizationOutcome | undefined;
      if (hooks.authorize !== undefined) {
        let result: PreviewAuthorizationHookResult;
        try {
          result = await hooks.authorize();
        } catch {
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
