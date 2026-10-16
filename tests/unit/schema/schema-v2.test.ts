/**
 * Proposed regular-suite regressions copied from the published Payload 2.32.3
 * fieldSchemaToJSON output (source SHA256 7845a59822f99984bdc062c46f0dc62c4754d49b04ce3a124f0296f3a0e38b18).
 * These isolate schema shape; they are not synthetic browser/message proofs.
 */
import { describe, expect, it } from 'vitest';
import { parseFieldSchema } from '@schema/parser';
import { buildSchemaIndex, lookupSchema } from '@schema/walker';

describe('Payload 2 — published schema shapes', () => {
  it('retains record-shaped block definitions and their relation metadata', () => {
    const schema = parseFieldSchema([
      {
        name: 'layout',
        type: 'blocks',
        blocks: {
          byline: {
            fields: [
              {
                name: 'author',
                type: 'relationship',
                relationTo: 'authors',
                hasMany: false,
              },
              { name: 'id', type: 'text' },
            ],
          },
        },
      },
    ]);
    expect(schema[0]?.blocks?.[0]?.slug).toBe('byline');
    expect(schema[0]?.blocks?.[0]?.fields[0]?.relationTo).toBe('authors');
    expect(lookupSchema(buildSchemaIndex(schema), 'layout.0.byline.author')?.type).toBe(
      'relationship',
    );
  });

  it('keeps the name of a tab which owns a nested value object', () => {
    const schema = parseFieldSchema([
      {
        name: 'hero',
        type: 'tabs',
        fields: [
          {
            name: 'author',
            type: 'relationship',
            relationTo: 'authors',
            hasMany: false,
          },
        ],
      },
    ]);
    expect(lookupSchema(buildSchemaIndex(schema), 'hero.author')?.relationTo).toBe('authors');
  });
});
