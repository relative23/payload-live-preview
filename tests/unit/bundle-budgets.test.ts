import { describe, expect, it } from 'vitest';
import { findBudgetViolations, INLINE_BUDGET, measureBundle } from '../../scripts/bundle-budgets';

describe('release bundle budgets', () => {
  it('pins the exact inline patch-delta and transfer-size ceilings', () => {
    expect(INLINE_BUDGET).toEqual({ raw: 65_000, gzip: 19_930, brotli: 17_500 });
  });

  it('measures raw, gzip, and Brotli bytes deterministically', () => {
    const input = 'payload-live-preview '.repeat(100);

    const measurement = measureBundle(input);

    expect(measurement).toEqual(measureBundle(Buffer.from(input)));
    expect(measurement.raw).toBe(Buffer.byteLength(input));
    expect(measurement.gzip).toBeGreaterThan(0);
    expect(measurement.gzip).toBeLessThan(measurement.raw);
    expect(measurement.brotli).toBeGreaterThan(0);
    expect(measurement.brotli).toBeLessThan(measurement.raw);
  });

  it('reports every exceeded dimension with its exact limit', () => {
    expect(
      findBudgetViolations({ raw: 101, gzip: 51, brotli: 40 }, { raw: 100, gzip: 50, brotli: 40 }),
    ).toEqual([
      { metric: 'raw', actual: 101, limit: 100 },
      { metric: 'gzip', actual: 51, limit: 50 },
    ]);
  });

  it('accepts measurements exactly on every boundary', () => {
    const boundary = { raw: 100, gzip: 50, brotli: 40 };
    expect(findBudgetViolations(boundary, boundary)).toEqual([]);
  });
});
