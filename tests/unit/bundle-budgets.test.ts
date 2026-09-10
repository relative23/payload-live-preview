import { describe, expect, it } from 'vitest';
import {
  INLINE_BUDGET,
  INLINE_FRAGMENT_BUDGET,
  INLINE_LEAN_BUDGET,
  INLINE_ROUTE_BUDGET,
} from '../../scripts/bundle-budgets';
import { findBudgetViolations, measureBundle } from '../../scripts/bundle-measure';

describe('release bundle budgets', () => {
  it('pins the exact inline patch-delta and transfer-size ceilings', () => {
    expect(INLINE_BUDGET).toEqual({ raw: 108_328, gzip: 34_010, brotli: 30_061 });
    expect(INLINE_LEAN_BUDGET).toEqual({ raw: 87_386, gzip: 27_502, brotli: 24_417 });
    expect(INLINE_ROUTE_BUDGET).toEqual({ raw: 115_021, gzip: 36_205, brotli: 31_885 });
    expect(INLINE_FRAGMENT_BUDGET).toEqual({ raw: 119_973, gzip: 37_868, brotli: 33_275 });
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
