/**
 * Polymorphic targets are work even when the document selects one collection.
 * Charge their copying and validation to each operation's existing node budget.
 */
import { describe, expect, it } from 'vitest';
import { planLegacyPopulation } from '@core/legacy-population';
import { parseFieldSchema } from '@schema/parser';
import type { PayloadFieldSchema } from '@/types/payload-protocol';

const targets = (length: number): string[] =>
  Array.from({ length }, (_, index) => `collection${index}`);
const field = (name: string, relationTo: string[], hasMany = false): PayloadFieldSchema => ({
  name,
  type: 'relationship',
  relationTo,
  hasMany,
});
const reference = (collection = 'collection0', value = 'A') => ({ relationTo: collection, value });
const plan = (data: Record<string, unknown>, schema: readonly PayloadFieldSchema[]) =>
  planLegacyPopulation(data, schema, 'https://cms.example.com', '/api', 1);

describe('polymorphic target work in schema parsing', () => {
  it('refuses 10,001 targets instead of copying metadata outside its node budget', () => {
    expect(parseFieldSchema([field('author', targets(10_001))])).toHaveLength(0);
  });

  it('shares one node budget across separate fields referencing the same target list', () => {
    const allowed = targets(5_000);
    expect(parseFieldSchema([field('first', allowed), field('second', allowed)])).toHaveLength(0);
  });

  it('accepts exactly 10,000 nodes including the root, field and target entries', () => {
    const allowed = targets(9_998);
    const parsed = parseFieldSchema([field('author', allowed)]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.relationTo).toEqual(allowed);
    expect(parsed[0]?.relationTo).not.toBe(allowed);
  });

  it('preserves the shared boundary across two target lists and two fields', () => {
    const parsed = parseFieldSchema([
      field('first', targets(4_998)),
      field('second', targets(4_999)),
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.relationTo).toHaveLength(4_998);
    expect(parsed[1]?.relationTo).toHaveLength(4_999);
  });

  it('keeps opaque unrelated metadata outside the recognized target traversal', () => {
    const opaque = targets(10_001);
    const inherited = { unrelated: opaque };
    const raw = Object.assign(Object.create(inherited) as Record<string, unknown>, {
      name: 'title',
      type: 'text',
      extra: opaque,
    });
    const parsed = parseFieldSchema([raw]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.['extra']).toBe(opaque);
    expect(Object.hasOwn(parsed[0] ?? {}, 'unrelated')).toBe(false);
  });
});

describe('polymorphic target work in direct legacy planning', () => {
  it('refuses 10,001 valid targets without relying on normalized parser input', () => {
    const allowed = targets(10_001);
    expect(() =>
      plan({ author: reference('collection10000') }, [field('author', allowed)]),
    ).toThrow(/invalid or oversized legacy population/u);
  });

  it('shares validation work across fields that reuse a target list', () => {
    const allowed = targets(5_000);
    expect(() =>
      plan({ first: reference(), second: reference() }, [
        field('first', allowed),
        field('second', allowed),
      ]),
    ).toThrow(/invalid or oversized legacy population/u);
  });

  it('bounds repeated target-list scans for a hasMany relationship', () => {
    expect(() =>
      plan({ authors: [reference(), reference('collection0', 'B')] }, [
        field('authors', targets(5_000), true),
      ]),
    ).toThrow(/invalid or oversized legacy population/u);
  });

  it('accepts the shared node boundary with more than 25 allowed definitions', () => {
    const allowed = targets(9_998);
    const result = plan({ author: reference('collection9997') }, [field('author', allowed)]);
    expect(result.requests).toHaveLength(1);
    expect(new URL(result.requests[0]?.url ?? '').pathname).toBe('/api/collection9997');
    expect(result.requests[0]?.ids).toEqual(new Set(['A']));
  });

  it('accepts exactly 10,000 shared nodes across two fields', () => {
    const result = plan({ first: reference(), second: reference() }, [
      field('first', targets(4_998)),
      field('second', targets(4_999)),
    ]);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.slots).toHaveLength(2);
  });

  it('accepts exactly 10,000 shared nodes across two hasMany references', () => {
    const result = plan({ authors: [reference(), reference('collection0', 'B')] }, [
      field('authors', targets(4_999), true),
    ]);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.ids).toEqual(new Set(['A', 'B']));
  });
});
