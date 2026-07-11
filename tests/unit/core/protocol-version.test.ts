import { describe, expect, it } from 'vitest';
import {
  LIBRARY_PROTOCOL_VERSION,
  hasCapability,
  negotiateProtocol,
} from '@core/protocol-version';

describe('protocol negotiation', () => {
  it('exposes a positive integer LIBRARY_PROTOCOL_VERSION', () => {
    expect(LIBRARY_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(LIBRARY_PROTOCOL_VERSION)).toBe(true);
  });

  it('falls back to v1 when remote does not advertise', () => {
    const result = negotiateProtocol(undefined);
    expect(result.theirs).toBeUndefined();
    expect(result.negotiated).toBe(1);
    expect(result.capabilities.has('basic')).toBe(true);
    expect(result.capabilities.has('schema-json')).toBe(false);
  });

  it('takes the minimum of ours and theirs', () => {
    const result = negotiateProtocol(2);
    expect(result.theirs).toBe(2);
    expect(result.negotiated).toBe(Math.min(2, LIBRARY_PROTOCOL_VERSION));
    expect(result.capabilities.has('schema-json')).toBe(true);
    expect(result.capabilities.has('nested-arrays')).toBe(false);
  });

  it('caps at the library version when theirs is higher', () => {
    const result = negotiateProtocol(LIBRARY_PROTOCOL_VERSION + 5);
    expect(result.negotiated).toBe(LIBRARY_PROTOCOL_VERSION);
    expect(result.capabilities.has('nested-arrays')).toBe(true);
  });

  it('treats non-finite remote values as v1', () => {
    expect(negotiateProtocol(Number.NaN).negotiated).toBe(1);
    expect(negotiateProtocol(Number.POSITIVE_INFINITY).negotiated).toBe(1);
    expect(negotiateProtocol(-1).negotiated).toBe(1);
    expect(negotiateProtocol(0).negotiated).toBe(1);
  });

  it('floors fractional remote versions', () => {
    const result = negotiateProtocol(2.7);
    expect(result.theirs).toBe(2);
    expect(result.negotiated).toBe(Math.min(2, LIBRARY_PROTOCOL_VERSION));
  });

  it('enables nested-arrays only at v4+', () => {
    expect(hasCapability(negotiateProtocol(3), 'nested-arrays')).toBe(false);
    expect(hasCapability(negotiateProtocol(4), 'nested-arrays')).toBe(true);
  });

  it('enables preview-token at v3+', () => {
    expect(hasCapability(negotiateProtocol(2), 'preview-token')).toBe(false);
    expect(hasCapability(negotiateProtocol(3), 'preview-token')).toBe(true);
  });
});
