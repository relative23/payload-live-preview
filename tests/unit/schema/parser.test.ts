import { describe, expect, it } from 'vitest';
import { parseFieldSchema } from '@schema/parser';

describe('parseFieldSchema', () => {
  it('parses a simple flat schema', () => {
    const result = parseFieldSchema([
      { name: 'title', type: 'text' },
      { name: 'count', type: 'number' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe('text');
  });

  it('drops entries without a name', () => {
    const result = parseFieldSchema([{ type: 'text' }, { name: 'ok', type: 'text' }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('ok');
  });

  it('drops entries without a type', () => {
    const result = parseFieldSchema([{ name: 'a' }, { name: 'b', type: 'text' }]);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for non-arrays', () => {
    expect(parseFieldSchema(null)).toEqual([]);
    expect(parseFieldSchema(undefined)).toEqual([]);
    expect(parseFieldSchema('not an array')).toEqual([]);
    expect(parseFieldSchema({})).toEqual([]);
  });

  it('parses nested fields recursively', () => {
    const result = parseFieldSchema([
      {
        name: 'hero',
        type: 'group',
        fields: [
          { name: 'title', type: 'text' },
          { name: 'subtitle', type: 'text' },
        ],
      },
    ]);
    expect(result[0]?.fields).toHaveLength(2);
    expect(result[0]?.fields?.[0]?.name).toBe('title');
  });

  it('parses array fields with nested fields', () => {
    const result = parseFieldSchema([
      {
        name: 'items',
        type: 'array',
        fields: [{ name: 'label', type: 'text' }],
      },
    ]);
    expect(result[0]?.fields).toHaveLength(1);
  });

  it('parses blocks fields with block definitions', () => {
    const result = parseFieldSchema([
      {
        name: 'layout',
        type: 'blocks',
        blocks: [
          {
            slug: 'callout',
            fields: [{ name: 'message', type: 'text' }],
          },
        ],
      },
    ]);
    expect(result[0]?.blocks).toHaveLength(1);
    expect(result[0]?.blocks?.[0]?.slug).toBe('callout');
    expect(result[0]?.blocks?.[0]?.fields).toHaveLength(1);
  });

  it('drops blocks without a slug', () => {
    const result = parseFieldSchema([
      {
        name: 'layout',
        type: 'blocks',
        blocks: [{ fields: [] }, { slug: 'ok', fields: [] }],
      },
    ]);
    expect(result[0]?.blocks).toHaveLength(1);
  });

  it('drops non-object entries', () => {
    const result = parseFieldSchema([null, 'string', 42, true, { name: 'ok', type: 'text' }]);
    expect(result).toHaveLength(1);
  });

  it('preserves extra properties', () => {
    const result = parseFieldSchema([
      { name: 'title', type: 'text', label: 'Title', required: true },
    ]);
    expect(result[0]?.label).toBe('Title');
    expect(result[0]?.required).toBe(true);
  });

  it('strips empty fields/blocks arrays', () => {
    const result = parseFieldSchema([{ name: 'x', type: 'text', fields: [], blocks: [] }]);
    expect(result[0]?.fields).toBeUndefined();
    expect(result[0]?.blocks).toBeUndefined();
  });
});
