import { describe, expect, it } from 'vitest';
import { READINESS_ROWS, V2_ADAPTER_DEFAULTS, V2_RUNTIME_DEFAULTS } from '@/types/defaults-profile';
import { withProfileDefaults, type LivePreviewClientConfig } from '@client/config';

/**
 * ADR 0007 §1: the defaults table sets every readiness row that has an option.
 * This test is the mechanism that makes a forgotten row a failing build: add a
 * row to READINESS_ROWS and one of the two halves of the table must set it.
 */
describe('the defaults table covers every readiness row', () => {
  it('assigns each row to exactly one of the adapter or runtime halves', () => {
    const rows = Object.keys(READINESS_ROWS).sort();
    const covered = [
      ...Object.keys(V2_ADAPTER_DEFAULTS),
      ...Object.keys(V2_RUNTIME_DEFAULTS),
    ].sort();
    expect(covered).toEqual(rows);
    // No key sits in both halves — a row lives in one place.
    const adapterKeys = new Set(Object.keys(V2_ADAPTER_DEFAULTS));
    for (const key of Object.keys(V2_RUNTIME_DEFAULTS)) expect(adapterKeys.has(key)).toBe(false);
  });

  it('holds the hardened value of every row, written out', () => {
    // The 1.x table that `defaults: 'v1'` restored until 3.0 had the opposite in each row.
    expect(V2_ADAPTER_DEFAULTS).toEqual({ strict: true, previewSignals: ['query'] });
    expect(V2_RUNTIME_DEFAULTS).toEqual({
      enableReferrerDetection: false,
      eventSourcePolicy: 'parent-or-opener',
      skipUnchanged: true,
      sanitizerPolicy: 'strict',
    });
  });

  it('is frozen, so the table cannot drift at runtime', () => {
    expect(Object.isFrozen(V2_ADAPTER_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(V2_RUNTIME_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(READINESS_ROWS)).toBe(true);
  });
});

describe('withProfileDefaults (client)', () => {
  it('fills the runtime rows and leaves explicit options alone', () => {
    for (const named of [{}, { defaults: 'v2' }] as const) {
      expect(withProfileDefaults(named)).toMatchObject({
        skipUnchanged: true,
        enableReferrerDetection: false,
        eventSourcePolicy: 'parent-or-opener',
        sanitizerPolicy: 'strict',
      });
    }
    expect(
      withProfileDefaults({ defaults: 'v2', skipUnchanged: false, eventSourcePolicy: 'any' }),
    ).toMatchObject({
      skipUnchanged: false,
      enableReferrerDetection: false,
      eventSourcePolicy: 'any',
    });
  });

  it("refuses `defaults: 'v1'`, which 3.0 removed, instead of filling other rows than it asked for", () => {
    const removed = { allowedOrigins: ['https://admin.example.com'], defaults: 'v1' };

    expect(() => withProfileDefaults(removed as LivePreviewClientConfig)).toThrow(
      "payload-live-preview: `defaults: 'v1'` was removed in 3.0. `pll migrate` writes the 1.x " +
        "rows it stood for into your options. Two cannot be kept: `strict: false` and 'referer' " +
        'among the preview signals (ADR 0007, row 21).',
    );
  });
});
