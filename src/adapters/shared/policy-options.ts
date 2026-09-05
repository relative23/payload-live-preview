/**
 * The options the policy reads, and what they resolve to: the `defaults`
 * profile fills what an adapter left unset, and the inline-script config
 * carries only what was given so the runtime's own defaults stay the single
 * source of them.
 */

import type { generateInlineScript } from '@inline/generator';
import {
  adapterDefaultsFor,
  runtimeDefaultsFor,
  V2_RUNTIME_DEFAULTS,
} from '@core/defaults-profile';
import { assertMergeDepthExplicit } from '@/types/merge-depth';
import type { PreviewSignal } from './preview-request';
import type { PreviewAdapterOptions } from './options';

/** The structural subset of any adapter's options the policy reads; hooks are bound per request. */
export interface PreviewPolicyOptions extends PreviewAdapterOptions<never> {
  /** Server-rendered fragment boundaries (ADR 0011): the same-origin endpoint the runtime posts to. */
  readonly fragments?: { readonly endpoint: string };
}

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
