import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

export interface BundleMeasurement {
  readonly raw: number;
  readonly gzip: number;
  readonly brotli: number;
}

export type BundleBudget = BundleMeasurement;

/** Exact inline patch-delta and transfer-size ceilings used by the release gate. */
// Set 2026-08-27 (hybrid): the plain runtime measured 25 986 gzip, +1 050 on
// the 24 936 before the strategy seam (plan/covers, the capability context a
// fragment strategy is handed, morph and fallback patch, LP08xx codes). The
// seam is what lets a page without `fragments` carry no fragment client at
// all; the client itself is the difference to INLINE_FRAGMENT_BUDGET.
export const INLINE_BUDGET = { raw: 86_713, gzip: 26_897, brotli: 23_613 } as const;
// The inline script with the fragment prelude ahead of the runtime (ADR 0011);
// only a page configured with `fragments` receives it. Measured 2026-08-28
// (grew with the reveal-edited-field runtime).
export const INLINE_FRAGMENT_BUDGET = { raw: 96_441, gzip: 30_121, brotli: 26_260 } as const;

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
