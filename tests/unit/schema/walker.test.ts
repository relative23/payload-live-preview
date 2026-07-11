import { describe, expect, it } from 'vitest';
import { buildSchemaIndex, lookupBlockSchema, lookupSchema } from '@schema/walker';
import { parseFieldSchema } from '@schema/parser';

describe('buildSchemaIndex — flat', () => {
  it('indexes top-level fields', () => {
    const index = buildSchemaIndex(
      parseFieldSchema([
        { name: 'title', type: 'text' },
        { name: 'count', type: 'number' },
      ]),
    );
    expect(index.size).toBe(2);
    expect(index.get('title')?.type).toBe('text');
    expect(index.get('count')?.type).toBe('number');
  });
});

describe('buildSchemaIndex — group', () => {
  it('flattens group fields into dotted paths', () => {
    const index = buildSchemaIndex(
      parseFieldSchema([
        {
          name: 'hero',
          type: 'group',
          fields: [
            { name: 'title', type: 'text' },
            { name: 'subtitle', type: 'text' },
          ],
        },
      ]),
    );
    expect(index.get('hero')?.type).toBe('group');
    expect(index.get('hero.title')?.type).toBe('text');
    expect(index.get('hero.subtitle')?.type).toBe('text');
  });

  it('handles deeply nested groups', () => {
    const index = buildSchemaIndex(
      parseFieldSchema([
        {
          name: 'a',
          type: 'group',
          fields: [
            {
              name: 'b',
              type: 'group',
              fields: [{ name: 'c', type: 'text' }],
            },
          ],
        },
      ]),
    );
    expect(index.get('a.b.c')?.type).toBe('text');
  });
});

describe('buildSchemaIndex — array', () => {
  it('uses wildcard segment for array children', () => {
    const index = buildSchemaIndex(
      parseFieldSchema([
        {
          name: 'items',
          type: 'array',
          fields: [{ name: 'label', type: 'text' }],
        },
      ]),
    );
    expect(index.get('items')?.type).toBe('array');
    expect(index.get('items.*.label')?.type).toBe('text');
  });
});

describe('buildSchemaIndex — blocks', () => {
  it('flattens each block into its slug segment', () => {
    const index = buildSchemaIndex(
      parseFieldSchema([
        {
          name: 'layout',
          type: 'blocks',
          blocks: [
            {
              slug: 'callout',
              fields: [{ name: 'text', type: 'text' }],
            },
            {
              slug: 'image',
              fields: [{ name: 'caption', type: 'text' }],
            },
          ],
        },
      ]),
    );
    expect(index.get('layout.*.callout.text')?.type).toBe('text');
    expect(index.get('layout.*.image.caption')?.type).toBe('text');
  });
});

describe('buildSchemaIndex — structural containers', () => {
  it('flattens tabs/row/collapsible into their inner fields', () => {
    const index = buildSchemaIndex(
      parseFieldSchema([
        {
          name: '_tabs',
          type: 'tabs',
          fields: [
            { name: 'title', type: 'text' },
            {
              name: '_row',
              type: 'row',
              fields: [
                { name: 'count', type: 'number' },
                {
                  name: '_collapsible',
                  type: 'collapsible',
                  fields: [{ name: 'note', type: 'text' }],
                },
              ],
            },
          ],
        },
      ]),
    );
    expect(index.get('title')?.type).toBe('text');
    expect(index.get('count')?.type).toBe('number');
    expect(index.get('note')?.type).toBe('text');
    expect(index.get('_tabs')).toBeUndefined();
    expect(index.get('_row')).toBeUndefined();
    expect(index.get('_collapsible')).toBeUndefined();
  });
});

describe('lookupSchema', () => {
  const index = buildSchemaIndex(
    parseFieldSchema([
      {
        name: 'items',
        type: 'array',
        fields: [{ name: 'label', type: 'text' }],
      },
    ]),
  );

  it('finds direct paths', () => {
    expect(lookupSchema(index, 'items')?.type).toBe('array');
  });

  it('resolves numeric array indices to wildcard paths', () => {
    expect(lookupSchema(index, 'items.0.label')?.type).toBe('text');
    expect(lookupSchema(index, 'items.42.label')?.type).toBe('text');
  });

  it('returns undefined for unknown paths', () => {
    expect(lookupSchema(index, 'mystery')).toBeUndefined();
  });
});

describe('lookupBlockSchema', () => {
  const index = buildSchemaIndex(
    parseFieldSchema([
      {
        name: 'layout',
        type: 'blocks',
        blocks: [
          { slug: 'callout', fields: [{ name: 'text', type: 'text' }] },
          { slug: 'image', fields: [{ name: 'caption', type: 'text' }] },
        ],
      },
    ]),
  );

  it('finds the right block by slug', () => {
    expect(lookupBlockSchema(index, 'layout', 'callout')?.slug).toBe('callout');
    expect(lookupBlockSchema(index, 'layout', 'image')?.slug).toBe('image');
  });

  it('returns undefined for unknown blocks', () => {
    expect(lookupBlockSchema(index, 'layout', 'mystery')).toBeUndefined();
  });

  it('returns undefined when the field is not a blocks field', () => {
    expect(lookupBlockSchema(index, 'not-blocks', 'x')).toBeUndefined();
  });
});
