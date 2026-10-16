// 2026-10-04 (2.1.0): stop superseded merges after diagnostics and simplify legacy
// relation planning. Paired Node24.19/npm12.0.2 measurements at epoch1791096072 move
// changed rows by their measured deltas and preserve existing raw/gzip/Brotli reserves.
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
    // 2026-10-08: paired Node24.19/npm12.0.2, epoch1791096072; after empty Payload2
    // fields and fragment response fixes. Exact measured deltas retain each
    // profile's previous raw/gzip reserves and its 120-byte Brotli reserve.
    expect(INLINE_BUDGET).toEqual({ raw: 144_568, gzip: 45_499, brotli: 39_884 });
    expect(INLINE_LEAN_BUDGET).toEqual({ raw: 117_485, gzip: 36_927, brotli: 32_630 });
    expect(INLINE_ROUTE_BUDGET).toEqual({ raw: 153_118, gzip: 48_291, brotli: 41_947 });
    expect(INLINE_FRAGMENT_BUDGET).toEqual({ raw: 158_703, gzip: 50_272, brotli: 43_573 });
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
