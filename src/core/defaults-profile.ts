/**
 * The `defaults: 'v2'` profile: every 2.0 default that already exists as a
 * 1.x option, applied at once.
 *
 * ADR 0007 fixes the rule — the profile is one switch, individual options
 * override it, and a test asserts the profile assigns every readiness row
 * that has an option, so a row added later cannot be forgotten. The rows are
 * listed here by name so that test reads the same table this module applies.
 *
 * Adapters and the client runtime both consume this: the adapter rows shape
 * the request decision and the inline configuration, the runtime rows shape
 * the browser side. A row lives in exactly one of the two.
 *
 * @module @core/defaults-profile
 */

/** `'v1'` is today's behaviour; `'v2'` is what 2.0 will make the default. */
export type DefaultsProfile = 'v1' | 'v2';

/** How the runtime decides which windows may post updates. */
export type EventSourcePolicy = 'any' | 'parent-or-opener';

/**
 * Readiness-table rows that are options in this release, keyed by the option
 * they set. Rows the table lists without an option yet (draft helpers on the
 * server subpath, merge depth, sanitizer policy, closed barrels) join here
 * in the release that adds the option.
 */
export const READINESS_ROWS = Object.freeze({
  strict: 'production response changes require an authorized context',
  previewSignals: 'query-only intent signal',
  disableReferrerDetection: 'referrer trust off outside local dev',
  eventSourcePolicy: 'messages must come from parent/opener',
  skipUnchanged: 'skip unchanged bindings by default',
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
}

export const V2_ADAPTER_DEFAULTS: AdapterProfileDefaults = Object.freeze({
  strict: true,
  previewSignals: Object.freeze(['query'] as const),
});

export const V2_RUNTIME_DEFAULTS: RuntimeProfileDefaults = Object.freeze({
  disableReferrerDetection: true,
  eventSourcePolicy: 'parent-or-opener',
  skipUnchanged: true,
});

/** Today's defaults, spelled out so the two profiles are comparable row by row. */
export const V1_ADAPTER_DEFAULTS: AdapterProfileDefaults = Object.freeze({
  strict: false,
  previewSignals: Object.freeze(['query', 'fetch-dest', 'referer'] as const),
});

export const V1_RUNTIME_DEFAULTS: RuntimeProfileDefaults = Object.freeze({
  disableReferrerDetection: false,
  eventSourcePolicy: 'any',
  skipUnchanged: false,
});

export function adapterDefaultsFor(profile: DefaultsProfile | undefined): AdapterProfileDefaults {
  return profile === 'v2' ? V2_ADAPTER_DEFAULTS : V1_ADAPTER_DEFAULTS;
}

export function runtimeDefaultsFor(profile: DefaultsProfile | undefined): RuntimeProfileDefaults {
  return profile === 'v2' ? V2_RUNTIME_DEFAULTS : V1_RUNTIME_DEFAULTS;
}
