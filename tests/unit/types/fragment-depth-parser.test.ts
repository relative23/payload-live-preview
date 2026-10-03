/**
 * JSON depth counts object properties and array elements consistently.
 * Invalid caps must be refused before traversing untrusted fields.
 */
import { describe, expect, it } from 'vitest';
import { parseFragmentRequest, parseFragmentRequestResult } from '@/types/fragment-protocol';

const body = { fragment: 'hero', route: '/', search: '?preview=true', revision: 1 };
function fieldsAt(depth: number, shape: 'object' | 'array' | 'mixed'): Record<string, unknown> {
  let value: unknown = null;
  for (let i = 1; i < depth; i += 1) {
    value = shape === 'object' || (shape === 'mixed' && i % 2 === 0) ? { child: value } : [value];
  }
  return { child: value };
}

describe('fragment parser depth caps', () => {
  it.each(['object', 'array', 'mixed'] as const)('counts %s edges at the hard ceiling', (shape) => {
    const at = { ...body, fields: fieldsAt(64, shape) };
    const past = { ...body, fields: fieldsAt(65, shape) };
    expect(parseFragmentRequest(at)).not.toBeNull();
    expect(parseFragmentRequestResult(at)).not.toBeNull();
    expect(parseFragmentRequest(past)).toBeNull();
    expect(parseFragmentRequestResult(past)).toBe('field-depth');
  });

  it.each([1, 12, 24, 63])('enforces the lower cap %i without altering the default', (cap) => {
    expect(parseFragmentRequest({ ...body, fields: fieldsAt(cap, 'mixed') }, cap)).not.toBeNull();
    const past = { ...body, fields: fieldsAt(cap + 1, 'mixed') };
    expect(parseFragmentRequest(past, cap)).toBeNull();
    expect(parseFragmentRequestResult(past, cap)).toBe('field-depth');
    expect(parseFragmentRequest(past)).not.toBeNull();
  });

  it.each([-1, 0.5, 65, 20000, NaN, Infinity, '24', null])(
    'refuses invalid direct-parser cap %s',
    (cap) => {
      const value = { ...body, fields: {} };
      expect(parseFragmentRequest(value, cap as number)).toBeNull();
      expect(parseFragmentRequestResult(value, cap as number)).toBeNull();
    },
  );

  it('distinguishes wrong metadata and fields shape from a depth refusal', () => {
    const fields = fieldsAt(65, 'array');
    for (const override of [
      { fragment: '../secret' },
      { route: '' },
      { search: 'preview=true' },
      { revision: -1 },
      { locale: 4 },
      { fields: [] },
    ]) {
      const value = { ...body, fields, ...override };
      expect(parseFragmentRequestResult(value)).toBeNull();
      expect(parseFragmentRequest(value)).toBeNull();
    }
  });
});
