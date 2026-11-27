/**
 * The defaults, row by row, and the one place a default is written. Whoever
 * applies one reads it here: the runtime and its parts, the origin detector,
 * the hooks, the adapters' request policy and `pll doctor`; a gate holds
 * `docs/options.md` to the same rows. The merger's own fallbacks (`apiRoute`,
 * the depth) are not rows: it is in the trusted core and keeps them.
 *
 * 3.0 has one profile: `defaults: 'v1'`, the 1.x table that 2.x kept for a
 * staged migration, is removed (ADR 0007, row 21). Each row belongs to exactly
 * one side — the adapter's request decision or the browser runtime — and a
 * test asserts the table assigns every readiness row that has an option, so a
 * row added later cannot be forgotten.
 *
 * It lives in the leaf `types` domain, like `merge-depth.ts`, because the
 * browser runtime in `core` and server-side code such as the inline generator
 * and the doctor both read it, and neither may reach the other.
 */

/** The one profile. The option stays so that a configuration which names it keeps working. */
export type DefaultsProfile = 'v2';

/** How the runtime decides which windows may post updates. */
export type EventSourcePolicy = 'any' | 'parent-or-opener';

/** Readiness rows that are options, keyed by the option they set. */
export const READINESS_ROWS = /* @__PURE__ */ Object.freeze({
  strict: 'production response changes require an authorized context',
  previewSignals: 'query-only intent signal',
  enableReferrerDetection: 'referrer trust off',
  eventSourcePolicy: 'messages must come from parent/opener',
  skipUnchanged: 'skip unchanged bindings by default',
  sanitizerPolicy: 'hardened sanitizer id/data-* policy',
} as const);

/**
 * The rows an adapter's request decision reads: the exports of `adapter-defaults.ts`, one per
 * row, as one object for whoever reads the table whole.
 */
export * as V2_ADAPTER_DEFAULTS from './adapter-defaults';

/**
 * The rows the browser runtime, the client and the hooks read: the exports of
 * `runtime-defaults.ts`. Code that is bundled imports the module of its half itself, as a
 * namespace, so that the bundler resolves each row and leaves the others out.
 */
export * as V2_RUNTIME_DEFAULTS from './runtime-defaults';
