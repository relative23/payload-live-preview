import { describe, expect, it } from 'vitest';
import {
  findBudgetViolations,
  INLINE_BUDGET,
  INLINE_FRAGMENT_BUDGET,
  INLINE_LEAN_BUDGET,
  INLINE_ROUTE_BUDGET,
  measureBundle,
} from '../../scripts/bundle-budgets';

describe('release bundle budgets', () => {
  it('pins the exact inline patch-delta and transfer-size ceilings', () => {
    expect(INLINE_BUDGET).toEqual({ raw: 103_720, gzip: 32_450, brotli: 28_750 });
    expect(INLINE_LEAN_BUDGET).toEqual({ raw: 85_720, gzip: 26_820, brotli: 23_850 });
    expect(INLINE_ROUTE_BUDGET).toEqual({ raw: 110_170, gzip: 34_590, brotli: 30_470 });
    expect(INLINE_FRAGMENT_BUDGET).toEqual({ raw: 115_100, gzip: 36_220, brotli: 31_900 });
  });

  it('keeps the lean profile a saving, and names how much of one', () => {
    // The number is the point of the profile: a page pays 32 KB or 26 KB, and
    // the docs quote this difference. If it shrinks below a fifth, the profile
    // stops being worth the second artifact and its second behaviour.
    const saved = INLINE_BUDGET.gzip - INLINE_LEAN_BUDGET.gzip;
    expect(saved).toBeGreaterThan(INLINE_BUDGET.gzip * 0.15);
  });

  it('keeps the route prelude the cheaper of the two strategy preludes', () => {
    // The reason `routeStrategy` exists as its own option: a page that only
    // refreshes its route must not carry the fragment client.
    expect(INLINE_ROUTE_BUDGET.gzip).toBeGreaterThan(INLINE_BUDGET.gzip);
    expect(INLINE_ROUTE_BUDGET.gzip).toBeLessThan(INLINE_FRAGMENT_BUDGET.gzip);
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
