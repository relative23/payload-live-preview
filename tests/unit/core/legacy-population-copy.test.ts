/**
 * Legacy form values and REST records are copied before population can mutate
 * them. These controls keep valid editor data independent and bound malformed
 * or oversized structured values before a credentialed request is possible.
 */
import { describe, expect, it, vi } from 'vitest';
import { copyLegacyData } from '@core/legacy-population';
import { DataMerger } from '@core/data-merger';

function nested(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) value = { child: value };
  return value;
}

describe('legacy population — independent structured copies', () => {
  it('preserves all structured scalar values and dense arrays without retaining input containers', () => {
    const shared = { name: 'Ada', values: [0, -0, false, true, null, undefined, ''] };
    const raw = { first: shared, second: shared, title: 'Typed', empty: [] };
    const result = copyLegacyData(raw) as typeof raw;
    expect(result).toEqual(raw);
    expect(result).not.toBe(raw);
    expect(result.first).not.toBe(shared);
    expect(result.second).not.toBe(shared);
    expect(result.first).not.toBe(result.second);
    expect(result.first.values).not.toBe(shared.values);
    expect(result.empty).not.toBe(raw.empty);
    expect(Object.is(result.first.values[1], -0)).toBe(true);
    result.first.name = 'Edited copy';
    expect(raw.first.name).toBe('Ada');
    expect(result.second.name).toBe('Ada');
  });

  it('retains undefined own values rather than dropping them from the editor document', () => {
    const result = copyLegacyData({ cleared: undefined }) as Record<string, unknown>;
    expect(Object.hasOwn(result, 'cleared')).toBe(true);
    expect(result['cleared']).toBeUndefined();
  });

  it('copies own prototype-named data without changing object prototypes', () => {
    const raw: unknown = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":"data","prototype":"data","title":"Typed"}',
    );
    const result = copyLegacyData(raw) as Record<string, unknown>;
    expect(result).toEqual(raw);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(result['__proto__']).toEqual({ polluted: true });
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
    result['title'] = 'Updated';
    Reflect.deleteProperty(result, 'constructor');
    expect(result['title']).toBe('Updated');
    expect(Object.hasOwn(result, 'constructor')).toBe(false);
    expect(Reflect.get(raw as object, 'title')).toBe('Typed');
    expect(Object.hasOwn(raw as object, 'constructor')).toBe(true);
  });

  it.each([
    ['a nonfinite number', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['a bigint', 1n],
    ['a symbol', Symbol('value')],
    ['a function', () => 'value'],
    ['a date', new Date(0)],
    ['a map', new Map([['key', 'value']])],
    ['a set', new Set(['value'])],
    ['a boxed string', Object('value') as unknown],
  ])('refuses %s before attempting a legacy read', async (_name, value) => {
    expect(() => copyLegacyData({ value })).toThrow();
    const fetchFn = vi.fn<typeof fetch>();
    const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });
    const request = { schema: [], data: { value } };
    expect(merger.canMerge(request)).toBe(false);
    await expect(merger.merge(request)).resolves.toEqual({ status: 'unavailable' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses genuine object and array cycles while allowing repeated acyclic references', () => {
    const object: Record<string, unknown> = {};
    object['self'] = object;
    const array: unknown[] = [];
    array.push(array);
    expect(() => copyLegacyData(object)).toThrow();
    expect(() => copyLegacyData(array)).toThrow();
    const shared = { value: 'A' };
    expect(copyLegacyData({ first: shared, second: shared })).toEqual({
      first: { value: 'A' },
      second: { value: 'A' },
    });
  });

  it('accepts copied values at depth 64 and refuses a value one level deeper', () => {
    const accepted = nested(64);
    expect(copyLegacyData(accepted)).toEqual(accepted);
    expect(() => copyLegacyData(nested(65))).toThrow();
  });

  it('shares a 10,000-node ceiling across the complete copied value', () => {
    const accepted = Array.from({ length: 9_999 }, () => null);
    expect(copyLegacyData(accepted)).toEqual(accepted);
    expect(() => copyLegacyData(Array.from({ length: 10_000 }, () => null))).toThrow();
    const split = {
      first: Array.from({ length: 4_998 }, () => 0),
      second: Array.from({ length: 4_999 }, () => 0),
    };
    expect(copyLegacyData(split)).toEqual(split);
    expect(() => copyLegacyData({ ...split, extra: 0 })).toThrow();
  });

  it('shares a one-MiB character ceiling across separate strings', () => {
    const accepted = { first: 'a'.repeat(524_288), second: 'b'.repeat(524_288) };
    expect(copyLegacyData(accepted)).toEqual(accepted);
    expect(() => copyLegacyData({ ...accepted, extra: 'c' })).toThrow();
  });

  it('refuses sparse arrays instead of turning missing entries into accepted values', () => {
    const sparse: unknown[] = ['A'];
    sparse.length = 2;
    expect(() => copyLegacyData({ sparse })).toThrow();
    expect(() => copyLegacyData(Array.from({ length: 10_001 }, () => null))).toThrow();
    expect(copyLegacyData({ dense: ['A', undefined] })).toEqual({ dense: ['A', undefined] });
  });
});
