import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

export interface BundleMeasurement {
  readonly raw: number;
  readonly gzip: number;
  readonly brotli: number;
}

export type BundleBudget = BundleMeasurement;

/** Exact inline patch-delta and transfer-size ceilings used by the release gate. */
export const INLINE_BUDGET = { raw: 66_000, gzip: 20_400, brotli: 18_100 } as const;

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
