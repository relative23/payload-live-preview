/**
 * Nested named tabs need their complete data path and the published flat alias.
 * Expanding every mixture of those names multiplies a small accepted schema;
 * these cases bound both the returned paths and the work spent visiting fields.
 */
import { describe, expect, it } from 'vitest';
import { parseFieldSchema } from '@schema/parser';
import { buildSchemaIndex, lookupBlockSchema, lookupSchema } from '@schema/walker';
import type { PayloadFieldSchema } from '@/types/payload-protocol';

function nestedTabs(depth: number): PayloadFieldSchema[] {
  let fields: PayloadFieldSchema[] = [
    { name: 'author', type: 'relationship', relationTo: 'authors' },
  ];
  for (let index = depth - 1; index >= 0; index--) {
    fields = [{ name: `tab${index}`, type: 'tabs', fields }];
  }
  return fields;
}

describe('Payload 2 named tabs — bounded index aliases', () => {
  it.each([4, 8, 12])('keeps only the complete flat and named paths at depth %i', (depth) => {
    const schema = parseFieldSchema(nestedTabs(depth));
    expect(schema).toHaveLength(1);
    const named = [...Array.from({ length: depth }, (_, index) => `tab${index}`), 'author'].join(
      '.',
    );
    const index = buildSchemaIndex(schema);
    expect([...index.keys()].sort()).toEqual(['author', named].sort());
    expect(lookupSchema(index, 'author')?.relationTo).toBe('authors');
    expect(lookupSchema(index, named)).toBe(lookupSchema(index, 'author'));
    expect(lookupSchema(index, 'tab0.author')).toBeUndefined();
    expect(lookupSchema(index, 'tab1.author')).toBeUndefined();
  });

  it('visits a nested field a bounded number of times independent of tab depth', () => {
    const schema = parseFieldSchema(nestedTabs(12));
    const reads: { count: number }[] = [];
    function instrument(fields: readonly PayloadFieldSchema[]): void {
      for (const field of fields) {
        const children = field.fields;
        if (!children) continue;
        const record = { count: 0 };
        reads.push(record);
        Object.defineProperty(field, 'fields', {
          configurable: true,
          get() {
            record.count++;
            return children;
          },
        });
        instrument(children);
      }
    }
    instrument(schema);
    expect(reads).toHaveLength(12);
    buildSchemaIndex(schema);
    expect(Math.max(...reads.map((record) => record.count))).toBeLessThanOrEqual(4);
  });

  it('preserves flat aliases and complete named paths through structural rows, arrays and blocks', () => {
    const schema = parseFieldSchema([
      {
        name: 'hero',
        type: 'tabs',
        fields: [
          {
            name: 'content',
            type: 'group',
            fields: [
              { name: 'title', type: 'text' },
              {
                name: '_row',
                type: 'row',
                fields: [
                  {
                    name: '_collapse',
                    type: 'collapsible',
                    fields: [
                      {
                        name: 'byline',
                        type: 'tabs',
                        fields: [{ name: 'author', type: 'relationship', relationTo: 'authors' }],
                      },
                    ],
                  },
                ],
              },
              {
                name: 'links',
                type: 'array',
                fields: [
                  { name: 'labels', type: 'tabs', fields: [{ name: 'title', type: 'text' }] },
                ],
              },
              {
                name: 'layout',
                type: 'blocks',
                blocks: {
                  callout: {
                    fields: [
                      { name: 'head', type: 'tabs', fields: [{ name: 'caption', type: 'text' }] },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
    ]);
    const index = buildSchemaIndex(schema);
    const flat = [
      'content',
      'content.title',
      'content.author',
      'content.links',
      'content.links.*.title',
      'content.layout',
      'content.layout.*.callout.caption',
    ];
    const named = [
      'hero.content',
      'hero.content.title',
      'hero.content.byline.author',
      'hero.content.links',
      'hero.content.links.*.labels.title',
      'hero.content.layout',
      'hero.content.layout.*.callout.head.caption',
    ];
    expect([...index.keys()].sort()).toEqual([...flat, ...named].sort());
    expect(lookupSchema(index, 'content.author')?.relationTo).toBe('authors');
    expect(lookupSchema(index, 'hero.content.byline.author')?.relationTo).toBe('authors');
    expect(lookupSchema(index, 'content.links.3.title')?.type).toBe('text');
    expect(lookupSchema(index, 'hero.content.links.3.labels.title')?.type).toBe('text');
    expect(lookupSchema(index, 'content.layout.2.callout.caption')?.type).toBe('text');
    expect(lookupSchema(index, 'hero.content.layout.2.callout.head.caption')?.type).toBe('text');
    expect(lookupBlockSchema(index, 'content.layout', 'callout')?.slug).toBe('callout');
    expect(lookupBlockSchema(index, 'hero.content.layout', 'callout')?.slug).toBe('callout');
    expect(lookupSchema(index, 'hero.content.author')).toBeUndefined();
    expect(lookupSchema(index, 'content.byline.author')).toBeUndefined();
    expect(lookupSchema(index, 'hero.content.links.3.title')).toBeUndefined();
  });
});
