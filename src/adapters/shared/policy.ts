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
import type { PreviewAuthorizationOutcome } from '@security/preview-verdict';
import type { AuthorizedPreviewContext } from '@/types/authorized-preview';
import { assertMergeDepthExplicit } from '@/types/merge-depth';
import { generateInlineScript, wrapWithScriptTag } from '@inline/generator';
import { hasPreviewIntent, type PreviewRequestLike } from './preview-request';
import { warnOnce } from './dev-warning';
import { runAuthorizeHook, type BoundAuthorizeHook } from './authorize-hook';
import {
  inlineScriptConfig,
  resolvePolicyOptions,
  type PreviewPolicyOptions,
} from './policy-options';
import { assertStrictConfiguration } from './strict';

export type { PreviewAuthorizationHookResult } from './options';

/** How the adapter manages Content-Security-Policy, normalised. */
export type CspMode = false | 'frame-ancestors' | 'full';

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
      allowedOrigins: options.allowedOrigins ?? [],
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
  readonly authorize?: BoundAuthorizeHook;
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
        const verdict = await runAuthorizeHook(hooks.authorize);
        outcome = verdict.outcome;
        if (!verdict.authorized) {
          return {
            isPreview,
            authorization: null,
            outcome,
            inject: false,
            cspMode: false,
            exposeNonce: false,
          };
        }
        authorization = verdict.context;
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
