/**
 * The options the policy reads, and what they resolve to: the defaults table
 * fills what an adapter left unset, and the inline-script config carries only
 * what was given so the runtime's own defaults stay the single source of them.
 */

import type { generateInlineScript } from '@inline/generator';
import * as V2_ADAPTER_DEFAULTS from '@/runtime/types/adapter-defaults';
import { refuseRemovedOptions } from '@/runtime/types/removed-options';
import { assertMergeDepthExplicit } from '@/runtime/types/merge-depth';
import type { InlineScriptConfig } from '@/runtime/types/inline-config';
import type { PreviewSignal } from './preview-request';
import type { PreviewAdapterOptions } from './options';

/** The structural subset of any adapter's options the policy reads; hooks are bound per request. */
export type PreviewPolicyOptions = PreviewAdapterOptions<never>;

/** The options after the defaults table: explicit options win, the table fills the rest. */
export interface ResolvedPolicyOptions {
  readonly previewSignals: readonly PreviewSignal[];
  readonly skipUnchanged: boolean | undefined;
  readonly enableReferrerDetection: boolean | undefined;
  readonly enableLocalhostMatching: boolean | undefined;
  readonly eventSourcePolicy: 'any' | 'parent-or-opener' | undefined;
  readonly sanitizerPolicy: 'compat' | 'strict' | undefined;
}

export function resolvePolicyOptions(options: PreviewPolicyOptions): ResolvedPolicyOptions {
  refuseRemovedOptions(options);
  // The runtime's own fallbacks are the same table, so only what was given travels.
  return {
    previewSignals: options.previewSignals ?? V2_ADAPTER_DEFAULTS.previewSignals,
    skipUnchanged: options.skipUnchanged,
    enableReferrerDetection: options.enableReferrerDetection,
    enableLocalhostMatching: options.enableLocalhostMatching,
    eventSourcePolicy: options.eventSourcePolicy,
    sanitizerPolicy: options.sanitizerPolicy,
  };
}

/**
 * What an adapter knows about the page beyond what a project configured: its
 * hydration owner and the document events its router fires after a commit.
 * These are facts, not project options.
 */
export type PageFacts = Pick<InlineScriptConfig, 'hydration' | 'softNavigationEvents'>;

/** The inline-script configuration; only given options travel, so the runtime's own defaults stay the single source of them. */
export function inlineScriptConfig(
  options: PreviewPolicyOptions,
  facts: PageFacts = {},
): Parameters<typeof generateInlineScript>[0] {
  assertMergeDepthExplicit(options);
  const resolved = resolvePolicyOptions(options);
  // A page a framework hydrates belongs to that framework's router: unless the project chose a
  // route strategy or a fragment endpoint, the route is refreshed through the router alone.
  const route =
    options.routeStrategy ??
    (facts.hydration !== undefined && options.fragments === undefined
      ? V2_ADAPTER_DEFAULTS.routeStrategy
      : undefined);
  return {
    ...(options.allowedOrigins !== undefined ? { allowedOrigins: options.allowedOrigins } : {}),
    ...(options.serverURL !== undefined ? { serverURL: options.serverURL } : {}),
    ...(options.apiRoute !== undefined ? { apiRoute: options.apiRoute } : {}),
    ...(options.mergeDepth !== undefined ? { mergeDepth: options.mergeDepth } : {}),
    ...(options.mergeTimeoutMs !== undefined ? { mergeTimeoutMs: options.mergeTimeoutMs } : {}),
    ...(options.internalLinkPattern !== undefined
      ? { internalLinkPattern: options.internalLinkPattern }
      : {}),
    ...(options.revealEditedField !== undefined
      ? { revealEditedField: options.revealEditedField }
      : {}),
    ...(options.debug !== undefined ? { debug: options.debug } : {}),
    ...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.enableVisibilityGate !== undefined
      ? { enableVisibilityGate: options.enableVisibilityGate }
      : {}),
    ...(options.visibilityGateThreshold !== undefined
      ? { visibilityGateThreshold: options.visibilityGateThreshold }
      : {}),
    ...(resolved.skipUnchanged !== undefined ? { skipUnchanged: resolved.skipUnchanged } : {}),
    ...(options.scopeBindingsByOwner !== undefined
      ? { scopeBindingsByOwner: options.scopeBindingsByOwner }
      : {}),
    ...(resolved.enableReferrerDetection !== undefined
      ? { enableReferrerDetection: resolved.enableReferrerDetection }
      : {}),
    ...(resolved.enableLocalhostMatching !== undefined
      ? { enableLocalhostMatching: resolved.enableLocalhostMatching }
      : {}),
    ...(resolved.eventSourcePolicy !== undefined
      ? { eventSourcePolicy: resolved.eventSourcePolicy }
      : {}),
    ...(resolved.sanitizerPolicy !== undefined
      ? { sanitizerPolicy: resolved.sanitizerPolicy }
      : {}),
    ...(options.fragments !== undefined ? { fragmentEndpoint: options.fragments.endpoint } : {}),
    // Only when no endpoint is configured: that prelude carries the route
    // strategy already, and asking for both would emit the larger one twice.
    // Fragments carry the route prelude, but only this slot says when it may run.
    ...(route === 'after-save' ||
    route === 'router' ||
    (route === true && options.fragments === undefined)
      ? { routeStrategy: route }
      : {}),
    ...(options.onUnfaithfulPatch !== undefined
      ? { onUnfaithfulPatch: options.onUnfaithfulPatch }
      : {}),
    ...(options.autoBind !== undefined ? { autoBind: options.autoBind } : {}),
    ...(options.subfieldCoverage !== undefined
      ? { subfieldCoverage: options.subfieldCoverage }
      : {}),
    ...(options.hydration !== undefined || facts.hydration !== undefined
      ? { hydration: options.hydration ?? facts.hydration }
      : {}),
    ...(facts.softNavigationEvents !== undefined
      ? { softNavigationEvents: facts.softNavigationEvents }
      : {}),
  };
}
