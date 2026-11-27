import { describe, expect, it } from 'vitest';
import { READINESS_ROWS, V2_ADAPTER_DEFAULTS, V2_RUNTIME_DEFAULTS } from '@/types/defaults-profile';

/**
 * ADR 0007 §1: the defaults table sets every readiness row that has an option.
 * This test is the mechanism that makes a forgotten row a failing build: add a
 * row to READINESS_ROWS and one of the two halves of the table must set it.
 */
describe('the defaults table covers every readiness row', () => {
  it('assigns each row to exactly one of the adapter or runtime halves', () => {
    const adapterKeys = new Set(Object.keys(V2_ADAPTER_DEFAULTS));
    const runtimeKeys = new Set(Object.keys(V2_RUNTIME_DEFAULTS));
    const unassigned = Object.keys(READINESS_ROWS).filter(
      (row) => !adapterKeys.has(row) && !runtimeKeys.has(row),
    );
    expect(unassigned).toEqual([]);
    // No key sits in both halves — a row lives in one place.
    expect([...runtimeKeys].filter((key) => adapterKeys.has(key))).toEqual([]);
  });

  it('holds every row, written out', () => {
    // The 1.x table that `defaults: 'v1'` restored until 3.0 had the opposite in the six
    // readiness rows; the others are the values each part of the package fell back to.
    expect({ ...V2_ADAPTER_DEFAULTS }).toEqual({
      strict: true,
      previewSignals: ['query'],
      previewQueryParams: ['preview', 'draft', 'livePreview'],
      inject: 'preview-only',
      autoInject: true,
      manageCsp: 'frame-ancestors',
      strictDynamic: false,
      assetPath: '/payload-live-preview',
    });
    expect({ ...V2_RUNTIME_DEFAULTS }).toEqual({
      debounceMs: 50,
      heartbeatMs: 0,
      enableA11y: true,
      enableVisibilityGate: true,
      visibilityGateThreshold: 50,
      intersectionRootMargin: '200px',
      enableReferrerDetection: false,
      enableLocalhostMatching: true,
      eventSourcePolicy: 'parent-or-opener',
      skipUnchanged: true,
      sanitizerPolicy: 'strict',
      scopeBindingsByOwner: false,
      revealEditedField: false,
      onUnfaithfulPatch: 'escalate',
      autoBind: 'off',
      subfieldCoverage: 'declared',
    });
  });

  it('cannot be written to, so the table cannot drift at runtime', () => {
    expect(Object.isFrozen(V2_ADAPTER_DEFAULTS.previewSignals)).toBe(true);
    expect(Object.isFrozen(V2_ADAPTER_DEFAULTS.previewQueryParams)).toBe(true);
    expect(Object.isFrozen(READINESS_ROWS)).toBe(true);
    // Each half is a module: its exports are read-only bindings.
    expect(() => {
      (V2_ADAPTER_DEFAULTS as { strict: boolean }).strict = false;
    }).toThrow(TypeError);
    expect(() => {
      (V2_RUNTIME_DEFAULTS as { skipUnchanged: boolean }).skipUnchanged = false;
    }).toThrow(TypeError);
    expect(V2_ADAPTER_DEFAULTS.strict).toBe(true);
    expect(V2_RUNTIME_DEFAULTS.skipUnchanged).toBe(true);
  });
});
