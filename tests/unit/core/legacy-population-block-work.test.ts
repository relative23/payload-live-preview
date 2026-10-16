/**
 * Finding a block definition is traversal work, even when its fields are empty.
 * Repeated rows share the same planner budget as their actual candidate scans.
 */
import { describe, expect, it } from 'vitest';
import { planLegacyPopulation } from '@core/legacy-population';
import { parseFieldSchema } from '@schema/parser';
import type { PayloadBlockSchema, PayloadFieldSchema } from '@/types/payload-protocol';

const definitions = (length: number): PayloadBlockSchema[] =>
  Array.from({ length }, (_, index) => ({ slug: `block${index}`, fields: [] }));
const field = (name: string, length: number): PayloadFieldSchema => ({
  name,
  type: 'blocks',
  blocks: definitions(length),
});
const row = (index: number) => ({ blockType: `block${index}` });
const normalized = (length: number) => {
  const schema = parseFieldSchema([field('layout', length)]);
  expect(schema).toHaveLength(1);
  expect(schema[0]?.blocks).toHaveLength(length);
  return schema;
};
const plan = (data: Record<string, unknown>, schema: readonly PayloadFieldSchema[]) =>
  planLegacyPopulation(data, schema, 'https://cms.example.com', '/api', 1);

describe('bounded block-definition lookup work', () => {
  it('refuses repeated last-definition scans from a bounded normalized schema', () => {
    const schema = normalized(4_000);
    expect(() => plan({ layout: [row(3_999), row(3_999), row(3_999)] }, schema)).toThrow(
      /invalid or oversized legacy population/u,
    );
  });

  it('refuses 10,001 direct candidate scans without relying on parser normalization', () => {
    expect(() => plan({ layout: [row(10_000)] }, [field('layout', 10_001)])).toThrow(
      /invalid or oversized legacy population/u,
    );
  });

  it('shares candidate lookup work across separate block fields', () => {
    expect(() =>
      plan({ first: [row(4_999)], second: [row(4_999)] }, [
        field('first', 5_000),
        field('second', 5_000),
      ]),
    ).toThrow(/invalid or oversized legacy population/u);
  });

  it('accepts exactly 10,000 planner nodes for one last-definition lookup', () => {
    // Root + field + 9,997 candidate checks + the selected empty-field walk.
    const data = { layout: [row(9_996)] };
    expect(plan(data, [field('layout', 9_997)])).toEqual({ doc: data, requests: [] });
  });

  it('accepts the exact shared boundary across two normalized block rows', () => {
    // Root + field + 2 × (4,998 candidate checks + one empty-field walk).
    const data = { layout: [row(4_997), row(4_997)] };
    expect(plan(data, normalized(4_998))).toEqual({ doc: data, requests: [] });
  });

  it('accepts exactly 10,000 shared planner nodes across two block fields', () => {
    const data = { first: [row(4_996)], second: [row(4_997)] };
    expect(plan(data, [field('first', 4_997), field('second', 4_998)])).toEqual({
      doc: data,
      requests: [],
    });
  });

  it('charges actual candidate scans instead of imposing a definition-count cap', () => {
    const data = { layout: [row(0)] };
    expect(plan(data, [field('layout', 10_001)])).toEqual({ doc: data, requests: [] });
  });

  it('preserves a bounded normalized lookup that selects the final definition', () => {
    const data = { layout: [row(3_999)] };
    expect(plan(data, normalized(4_000))).toEqual({ doc: data, requests: [] });
  });
});
