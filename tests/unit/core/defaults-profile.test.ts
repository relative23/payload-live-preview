import { describe, expect, it } from 'vitest';
import {
  READINESS_ROWS,
  V1_ADAPTER_DEFAULTS,
  V1_RUNTIME_DEFAULTS,
  V2_ADAPTER_DEFAULTS,
  V2_RUNTIME_DEFAULTS,
  adapterDefaultsFor,
  runtimeDefaultsFor,
} from '@core/defaults-profile';
import { withProfileDefaults } from '@client/config';

/**
 * ADR 0007 §1: the profile is one switch that sets every readiness row that
 * has an option. This test is the mechanism that makes a forgotten row a
 * failing build rather than a 2.0 surprise: add a row to READINESS_ROWS and
 * one of the two profiles must set it.
 */

describe("defaults: 'v2' covers every readiness row", () => {
  it('assigns each row to exactly one of the adapter or runtime profiles', () => {
    const rows = Object.keys(READINESS_ROWS).sort();
    const covered = [
      ...Object.keys(V2_ADAPTER_DEFAULTS),
      ...Object.keys(V2_RUNTIME_DEFAULTS),
    ].sort();
    expect(covered).toEqual(rows);
    // No key sits in both profiles — a row lives in one place.
    const adapterKeys = new Set(Object.keys(V2_ADAPTER_DEFAULTS));
    for (const key of Object.keys(V2_RUNTIME_DEFAULTS)) expect(adapterKeys.has(key)).toBe(false);
  });

  it('differs from v1 on every row, so each row is an actual flip', () => {
    for (const key of Object.keys(V2_ADAPTER_DEFAULTS) as (keyof typeof V2_ADAPTER_DEFAULTS)[]) {
      expect(V2_ADAPTER_DEFAULTS[key], key).not.toEqual(V1_ADAPTER_DEFAULTS[key]);
    }
    for (const key of Object.keys(V2_RUNTIME_DEFAULTS) as (keyof typeof V2_RUNTIME_DEFAULTS)[]) {
      expect(V2_RUNTIME_DEFAULTS[key], key).not.toEqual(V1_RUNTIME_DEFAULTS[key]);
    }
  });

  it('is frozen, so a profile cannot drift at runtime', () => {
    expect(Object.isFrozen(V2_ADAPTER_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(V2_RUNTIME_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(READINESS_ROWS)).toBe(true);
  });

  it('resolves v2 for v2 and v1 for everything else', () => {
    expect(adapterDefaultsFor('v2')).toBe(V2_ADAPTER_DEFAULTS);
    expect(adapterDefaultsFor('v1')).toBe(V1_ADAPTER_DEFAULTS);
    expect(adapterDefaultsFor(undefined)).toBe(V1_ADAPTER_DEFAULTS);
    expect(runtimeDefaultsFor('v2')).toBe(V2_RUNTIME_DEFAULTS);
    expect(runtimeDefaultsFor(undefined)).toBe(V1_RUNTIME_DEFAULTS);
  });
});

describe('withProfileDefaults (client)', () => {
  it('fills the runtime rows under v2 and leaves explicit options alone', () => {
    expect(withProfileDefaults({ defaults: 'v2' })).toMatchObject({
      skipUnchanged: true,
      disableReferrerDetection: true,
      eventSourcePolicy: 'parent-or-opener',
    });
    expect(
      withProfileDefaults({ defaults: 'v2', skipUnchanged: false, eventSourcePolicy: 'any' }),
    ).toMatchObject({
      skipUnchanged: false,
      disableReferrerDetection: true,
      eventSourcePolicy: 'any',
    });
  });

  it('returns the same object under v1 or no profile', () => {
    const config = { allowedOrigins: ['https://admin.example.com'] };
    expect(withProfileDefaults(config)).toBe(config);
    expect(withProfileDefaults({ ...config, defaults: 'v1' })).toEqual({
      ...config,
      defaults: 'v1',
    });
  });
});
