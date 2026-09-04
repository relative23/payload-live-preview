/**
 * The two defaults profiles, row by row. 2.0 ships `v2`; `defaults: 'v1'` opts
 * back into the 1.x table for a staged migration. Each row belongs to exactly
 * one side — the adapter's request decision or the browser runtime — and a
 * test asserts the profile assigns every readiness row that has an option, so
 * a row added later cannot be forgotten. See ADR 0007.
 */

/** `'v2'` is the 2.0 default; `'v1'` is the 1.x table. */
export type DefaultsProfile = 'v1' | 'v2';

/** How the runtime decides which windows may post updates. */
export type EventSourcePolicy = 'any' | 'parent-or-opener';

/** Readiness rows that are options, keyed by the option they set. */
export const READINESS_ROWS = Object.freeze({
  strict: 'production response changes require an authorized context',
  previewSignals: 'query-only intent signal',
  disableReferrerDetection: 'referrer trust off outside local dev',
  eventSourcePolicy: 'messages must come from parent/opener',
  skipUnchanged: 'skip unchanged bindings by default',
  sanitizerPolicy: 'hardened sanitizer id/data-* policy',
} as const);

/** Options an adapter's request decision reads from the profile. */
export interface AdapterProfileDefaults {
  readonly strict: boolean;
  readonly previewSignals: readonly ('query' | 'fetch-dest' | 'referer')[];
}

/** Options the browser runtime reads from the profile (through the inline configuration). */
export interface RuntimeProfileDefaults {
  readonly disableReferrerDetection: boolean;
  readonly eventSourcePolicy: EventSourcePolicy;
  readonly skipUnchanged: boolean;
  readonly sanitizerPolicy: 'compat' | 'strict';
}

export const V2_ADAPTER_DEFAULTS: AdapterProfileDefaults = Object.freeze({
  strict: true,
  previewSignals: Object.freeze(['query'] as const),
});

export const V2_RUNTIME_DEFAULTS: RuntimeProfileDefaults = Object.freeze({
  disableReferrerDetection: true,
  eventSourcePolicy: 'parent-or-opener',
  skipUnchanged: true,
  sanitizerPolicy: 'strict',
});

/** The 1.x table, spelled out so the profiles compare row by row. */
export const V1_ADAPTER_DEFAULTS: AdapterProfileDefaults = Object.freeze({
  strict: false,
  previewSignals: Object.freeze(['query', 'fetch-dest', 'referer'] as const),
});

export const V1_RUNTIME_DEFAULTS: RuntimeProfileDefaults = Object.freeze({
  disableReferrerDetection: false,
  eventSourcePolicy: 'any',
  skipUnchanged: false,
  sanitizerPolicy: 'compat',
});

/** Only an explicit `'v1'` opts out; everything else gets the hardened rows. */
export function adapterDefaultsFor(profile: DefaultsProfile | undefined): AdapterProfileDefaults {
  return profile === 'v1' ? V1_ADAPTER_DEFAULTS : V2_ADAPTER_DEFAULTS;
}

export function runtimeDefaultsFor(profile: DefaultsProfile | undefined): RuntimeProfileDefaults {
  return profile === 'v1' ? V1_RUNTIME_DEFAULTS : V2_RUNTIME_DEFAULTS;
}
