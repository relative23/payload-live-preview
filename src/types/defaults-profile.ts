/**
 * The defaults, row by row. 3.0 has one profile: `defaults: 'v1'`, the 1.x
 * table that 2.x kept for a staged migration, is removed (ADR 0007, row 21).
 * Each row belongs to exactly one side — the adapter's request decision or
 * the browser runtime — and a test asserts the table assigns every readiness
 * row that has an option, so a row added later cannot be forgotten.
 *
 * It lives in the leaf `types` domain, like `merge-depth.ts`, because the
 * inline generator reads the table too, and the generator is server-side
 * code that may not reach the browser runtime in `core`.
 */

/** The one profile. The option stays so that a configuration which names it keeps working. */
export type DefaultsProfile = 'v2';

/** How the runtime decides which windows may post updates. */
export type EventSourcePolicy = 'any' | 'parent-or-opener';

/** Readiness rows that are options, keyed by the option they set. */
export const READINESS_ROWS = Object.freeze({
  strict: 'production response changes require an authorized context',
  previewSignals: 'query-only intent signal',
  disableReferrerDetection: 'referrer trust off',
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
