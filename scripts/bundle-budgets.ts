import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

export interface BundleMeasurement {
  readonly raw: number;
  readonly gzip: number;
  readonly brotli: number;
}

export type BundleBudget = BundleMeasurement;

/** Exact inline transfer-size ceilings used by the release gate. */
// Set 2026-08-28 after the 2.0 correctness pass: 26 910 → 28 736 gzip. The
// +1 745 is new behaviour, not slack — Payload 3.x link/table/inline-block
// rendering, class-based Lexical output, `mailto:` and responsive-image
// writes, local-time date inputs, one value contract across the renderers,
// the morph's focus and selection restore, and the scheduler's flush deadline.
// A page without `fragments` still carries no fragment client at all; that
// client is the difference to INLINE_FRAGMENT_BUDGET.
//
// Raised again the same day: 28 736 → 28 923 gzip. The +187 buys the reveal's
// identity ledger, which lets a field the server re-renders be recognised as
// the edited one, the binding-level reveal that picks the edited document's
// element when a page previews several, and a rejection boundary around the
// update pipeline so an unexpected throw is logged instead of escaping.
//
// Raised 2026-09-04: 28 923 → 28 966 gzip. The +43 makes the reveal ledger
// record what a revision revealed rather than what it saw, so a message that
// supersedes one before its reveal point still owes — and pays — the reveal.
// A slow first reveal caused the admin to re-send, and the re-send cancelled
// the only reveal there was; Firefox in CI reproduced it one run in seven.
//
// Raised 2026-09-05: 28 966 → 29 035 gzip. The +69 is net. The sanitizer
// policy became instance state (ADR 0002) — it travels through the runtime
// options into every render context, so two clients on one page no longer
// share whichever policy was set last — and that costs about a hundred bytes;
// the LRU helpers behind both caches and the fragment client's shared abort
// scaffolding give a third of it back. The reveal ledger as its own module and
// the `revision` and `hidesWhenEmpty` names are free.
export const INLINE_BUDGET = { raw: 93_591, gzip: 29_035, brotli: 25_777 } as const;
// The inline script with the fragment prelude ahead of the runtime (ADR 0011);
// only a page configured with `fragments` receives it. The prelude itself grew
// by the bounded streaming reader that replaced an unbounded `response.text()`.
export const INLINE_FRAGMENT_BUDGET = { raw: 104_954, gzip: 32_827, brotli: 28_954 } as const;

export interface BudgetViolation {
  readonly metric: keyof BundleMeasurement;
  readonly actual: number;
  readonly limit: number;
}

/** Measure the exact bytes used by the release-size gate. */
export function measureBundle(input: string | Uint8Array): BundleMeasurement {
  const bytes = typeof input === 'string' ? Buffer.from(input) : Buffer.from(input);
  return {
    raw: bytes.byteLength,
    gzip: gzipSync(bytes, { level: 9 }).byteLength,
    brotli: brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
  };
}

/** Return every exceeded dimension rather than hiding failures behind the first one. */
export function findBudgetViolations(
  measurement: BundleMeasurement,
  budget: BundleBudget,
): readonly BudgetViolation[] {
  const violations: BudgetViolation[] = [];
  for (const metric of ['raw', 'gzip', 'brotli'] as const) {
    if (measurement[metric] > budget[metric]) {
      violations.push({ metric, actual: measurement[metric], limit: budget[metric] });
    }
  }
  return violations;
}
