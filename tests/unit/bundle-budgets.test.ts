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
    // H13's measured delta for the revision display state (ADR 0023), prior cushions kept.
    expect(INLINE_BUDGET).toEqual({ raw: 134_708, gzip: 42_242, brotli: 37_100 });
    expect(INLINE_LEAN_BUDGET).toEqual({ raw: 107_984, gzip: 33_810, brotli: 29_929 });
    expect(INLINE_ROUTE_BUDGET).toEqual({ raw: 143_078, gzip: 44_694, brotli: 39_021 });
    expect(INLINE_FRAGMENT_BUDGET).toEqual({ raw: 148_534, gzip: 46_583, brotli: 40_646 });
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
