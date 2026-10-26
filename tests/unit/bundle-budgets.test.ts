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
    // 2026-10-16 (the json-only population body refuses an interruption): +12/+2/+75 default,
    // +12/+2/0 lean, +12/+10/+26 route, +12/+11/+15 fragments (Brotli rises only where it rose);
    // reserves unchanged.
    // 2026-10-10 (PR 125, ADR 0008 §10): +66/+14/+16 default, +21/+8/+14 lean, +111/+26/+62 route,
    // +111/+27/+74 fragments; reserves unchanged.
    // 2026-10-08: paired Node24.19/npm12.0.2, epoch1791096072; after empty Payload2
    // fields and fragment response fixes. Exact measured deltas retain each
    // profile's previous raw/gzip reserves and its 120-byte Brotli reserve.
    // 2026-10-23 (the scheduler's frame fallback): +297/+68/+130 default, +297/+71/+75 lean,
    // +297/+68/+136 route, +297/+68/+117 fragments; reserves unchanged.
    // 2026-10-23 (the Version PR's own build): gzip + 5 B over its measurement; raw and Brotli unchanged.
    // 2026-10-25 (a saved-only route render runs again on Payload's save): +368/+145/+113 default,
    // +159/+32/+3 lean, +368/+163/+130 route, +368/+137/+93 fragments; reserves unchanged.
    expect(INLINE_BUDGET).toEqual({ raw: 145_642, gzip: 45_801, brotli: 40_259 });
    expect(INLINE_LEAN_BUDGET).toEqual({ raw: 118_305, gzip: 37_147, brotli: 32_788 });
    expect(INLINE_ROUTE_BUDGET).toEqual({ raw: 154_237, gzip: 48_624, brotli: 42_329 });
    expect(INLINE_FRAGMENT_BUDGET).toEqual({ raw: 159_822, gzip: 50_582, brotli: 43_934 });
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
