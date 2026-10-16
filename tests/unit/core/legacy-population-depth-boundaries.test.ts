/**
 * Shallow editor values can still cross the planner depth through transparent
 * schema rows. Container and rich-text traversal share that depth independently
 * of the structured-data copy ceiling.
 */
import { describe, expect, it } from 'vitest';
import { planLegacyPopulation } from '@core/legacy-population';
import type { PayloadFieldSchema } from '@/types/payload-protocol';

const author: PayloadFieldSchema = { name: 'author', type: 'relationship', relationTo: 'authors' };
const plan = (data: Record<string, unknown>, schema: readonly PayloadFieldSchema[]) =>
  planLegacyPopulation(data, schema, 'https://cms.example.com', '/api', 1);

function transparentRows(count: number, leaf: PayloadFieldSchema): readonly PayloadFieldSchema[] {
  let fields: readonly PayloadFieldSchema[] = [leaf];
  for (let index = 0; index < count; index += 1) {
    fields = [{ name: `layout${index}`, type: 'row', fields }];
  }
  return fields;
}

function authorPlan(data: Record<string, unknown>, schema: readonly PayloadFieldSchema[]): void {
  const planned = plan(data, schema);
  expect(planned.requests).toHaveLength(1);
  expect(planned.requests[0]?.ids).toEqual(new Set(['A']));
  expect(planned.doc).toEqual(data);
  expect(planned.doc).not.toBe(data);
}

describe('legacy population — shared planner depth across field kinds', () => {
  it.each(['group', 'tabs'] as const)(
    'accepts depth 64 and refuses depth 65 across transparent rows and a named %s',
    (type) => {
      const field: PayloadFieldSchema = { name: 'content', type, fields: [author] };
      const raw = { content: { author: 'A' } };
      authorPlan(raw, transparentRows(63, field));
      expect(() => plan(raw, transparentRows(64, field))).toThrow();
      expect(raw).toEqual({ content: { author: 'A' } });
    },
  );

  it('accepts depth 64 and refuses depth 65 across transparent rows and an array row', () => {
    const field: PayloadFieldSchema = { name: 'items', type: 'array', fields: [author] };
    const raw = { items: [{ author: 'A' }] };
    authorPlan(raw, transparentRows(63, field));
    expect(() => plan(raw, transparentRows(64, field))).toThrow();
    expect(raw).toEqual({ items: [{ author: 'A' }] });
  });

  it('accepts depth 64 and refuses depth 65 across transparent rows and a selected block', () => {
    const field: PayloadFieldSchema = {
      name: 'items',
      type: 'blocks',
      blocks: [{ slug: 'quote', fields: [author] }],
    };
    const raw = { items: [{ blockType: 'quote', author: 'A' }] };
    authorPlan(raw, transparentRows(63, field));
    expect(() => plan(raw, transparentRows(64, field))).toThrow();
    expect(raw).toEqual({ items: [{ blockType: 'quote', author: 'A' }] });
  });

  it('accepts depth 64 and refuses depth 65 through nested rich-text values after transparent rows', () => {
    const field: PayloadFieldSchema = { name: 'body', type: 'richText' };
    const raw = { body: ['Text'] };
    expect(plan(raw, transparentRows(62, field))).toEqual({ doc: raw, requests: [] });
    expect(() => plan(raw, transparentRows(63, field))).toThrow();
    expect(raw).toEqual({ body: ['Text'] });
  });

  it('accepts depth 64 and refuses depth 65 when entering rich text after transparent rows', () => {
    const field: PayloadFieldSchema = { name: 'body', type: 'richText' };
    const raw = { body: 'Text' };
    expect(plan(raw, transparentRows(63, field))).toEqual({ doc: raw, requests: [] });
    expect(() => plan(raw, transparentRows(64, field))).toThrow();
    expect(raw).toEqual({ body: 'Text' });
  });
});
