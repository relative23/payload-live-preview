/**
 * Only fields owned by the observed v2 schema can name collections to read.
 * Container, clearing and rich-text cases retain the complete editor document
 * while malformed schema/data combinations refuse the entire population plan.
 */
import { describe, expect, it } from 'vitest';
import { fillLegacyPopulation, planLegacyPopulation } from '@core/legacy-population';
import type { PayloadFieldSchema } from '@/types/payload-protocol';

const author: PayloadFieldSchema = { name: 'author', type: 'relationship', relationTo: 'authors' };
const plan = (data: Record<string, unknown>, schema: readonly PayloadFieldSchema[], depth = 1) =>
  planLegacyPopulation(data, schema, 'https://cms.example.com', '/api', depth);

function populated(
  data: Record<string, unknown>,
  schema: readonly PayloadFieldSchema[],
): Record<string, unknown> {
  const result = plan(data, schema);
  for (const request of result.requests) {
    const collection = new URL(request.url).pathname.split('/').at(-1);
    fillLegacyPopulation(request, {
      docs: [...request.ids].map((id) => ({ id, name: `${collection}:${id}` })),
    });
  }
  return result.doc;
}

function transparentDepth(depth: number): PayloadFieldSchema[] {
  let fields: PayloadFieldSchema[] = [author];
  for (let index = 0; index < depth; index += 1) {
    fields = [{ name: `layout${index}`, type: index % 2 === 0 ? 'row' : 'collapsible', fields }];
  }
  return fields;
}

describe('legacy population — field ownership and value shapes', () => {
  it.each(['row', 'collapsible'] as const)('populates fields owned by a transparent %s', (type) => {
    const raw = { title: 'Typed', author: 'A' };
    expect(populated(raw, [{ name: 'layout', type, fields: [author] }])).toEqual({
      title: 'Typed',
      author: { id: 'A', name: 'authors:A' },
    });
    expect(raw).toEqual({ title: 'Typed', author: 'A' });
    expect(plan(raw, [{ name: 'layout', type }])).toEqual({ doc: raw, requests: [] });
  });

  it('keeps transparent schema traversal bounded independently of shallow editor data', () => {
    const accepted = plan({ author: 'A' }, transparentDepth(64));
    expect(accepted.requests).toHaveLength(1);
    expect(accepted.requests[0]?.ids).toEqual(new Set(['A']));
    expect(() => plan({ author: 'A' }, transparentDepth(65))).toThrow();
    const fields: PayloadFieldSchema[] = [];
    fields.push({ name: 'layout', type: 'row', fields });
    expect(() => plan({ author: 'A' }, fields)).toThrow();
  });

  it.each(['group', 'tabs'] as const)('populates only a valid named %s record', (type) => {
    const schema: PayloadFieldSchema[] = [{ name: 'content', type, fields: [author] }];
    expect(populated({ content: { author: 'A', title: 'Typed' } }, schema)).toEqual({
      content: { author: { id: 'A', name: 'authors:A' }, title: 'Typed' },
    });
    for (const value of [null, undefined]) {
      const raw = { content: value };
      expect(plan(raw, schema)).toEqual({ doc: raw, requests: [] });
    }
    for (const value of ['A', 0, false, []]) {
      expect(() => plan({ content: value }, schema)).toThrow();
    }
    expect(plan({ content: {} }, [{ name: 'content', type }])).toEqual({
      doc: { content: {} },
      requests: [],
    });
  });

  it('keeps array rows and block definitions separate when populating nested references', () => {
    const schema: PayloadFieldSchema[] = [
      { name: 'rows', type: 'array', fields: [author] },
      { name: 'layout', type: 'blocks', blocks: [{ slug: 'quote', fields: [author] }] },
    ];
    const raw = {
      rows: [{ author: 'A' }, { author: 'B' }],
      layout: [{ blockType: 'quote', author: 'A' }],
    };
    expect(populated(raw, schema)).toEqual({
      rows: [
        { author: { id: 'A', name: 'authors:A' } },
        { author: { id: 'B', name: 'authors:B' } },
      ],
      layout: [{ blockType: 'quote', author: { id: 'A', name: 'authors:A' } }],
    });
    expect(plan(raw, schema).requests).toHaveLength(1);
    // Payload 2 sends the row count for an empty array or blocks form field.
    for (const field of schema) {
      const empty = { [field.name]: 0 };
      expect(plan(empty, [field])).toEqual({ doc: { [field.name]: [] }, requests: [] });
      expect(empty[field.name]).toBe(0);
    }
    for (const value of ['A', {}, 1]) {
      expect(() => plan({ rows: value }, [schema[0]!])).toThrow();
    }
    for (const value of [[0], [null], ['A']]) {
      expect(() => plan({ rows: value }, [schema[0]!])).toThrow();
    }
    expect(() => plan({ layout: [{ blockType: 'unknown' }] }, [schema[1]!])).toThrow();
    expect(() => plan({ layout: [{}] }, [{ name: 'layout', type: 'blocks' }])).toThrow();
    expect(plan({ rows: [{}] }, [{ name: 'rows', type: 'array' }])).toEqual({
      doc: { rows: [{}] },
      requests: [],
    });
  });

  it.each([null, undefined, ''])(
    'preserves a cleared scalar relationship %j without a read',
    (value) => {
      const raw = { author: value };
      expect(plan(raw, [author])).toEqual({ doc: raw, requests: [] });
      const polymorphic: PayloadFieldSchema = { ...author, relationTo: ['authors', 'media'] };
      expect(plan(raw, [polymorphic])).toEqual({ doc: raw, requests: [] });
      const wrapped = { author: { relationTo: 'authors', value } };
      expect(plan(wrapped, [polymorphic])).toEqual({ doc: wrapped, requests: [] });
    },
  );

  it('clears hasMany references while rejecting values that are not arrays', () => {
    const field = { ...author, hasMany: true };
    for (const value of [null, undefined, []]) {
      const raw = { author: value };
      expect(plan(raw, [field])).toEqual({ doc: raw, requests: [] });
    }
    for (const value of ['A', 0, false, {}]) {
      expect(() => plan({ author: value }, [field])).toThrow();
    }
    expect(populated({ author: ['A', 'B'] }, [field])).toEqual({
      author: [
        { id: 'A', name: 'authors:A' },
        { id: 'B', name: 'authors:B' },
      ],
    });
  });

  it('reads the id of already populated values and keeps numeric 0 at depth 0', () => {
    expect(populated({ author: { id: 'A', name: 'Earlier', extra: true } }, [author])).toEqual({
      author: { id: 'A', name: 'authors:A' },
    });
    expect(plan({ author: { id: 0, name: 'Earlier' } }, [author], 0)).toEqual({
      doc: { author: 0 },
      requests: [],
    });
    expect(() => plan({ author: { id: null } }, [author], 0)).toThrow();
  });

  it('refuses malformed relationship schemas and unselected unsafe polymorphic targets', () => {
    expect(() =>
      plan({ author: ['A'] }, [{ ...author, hasMany: 'yes' }] as unknown as PayloadFieldSchema[]),
    ).toThrow();
    const invalid = [
      { ...author, relationTo: [] },
      { ...author, relationTo: ['authors', '../private'] },
      { ...author, relationTo: ['authors', 0] },
    ] as unknown as PayloadFieldSchema[];
    for (const field of invalid) {
      expect(() => plan({ author: { relationTo: 'authors', value: 'A' } }, [field])).toThrow();
    }
    const field = { ...author, relationTo: ['authors', 'media'] };
    for (const value of [
      'A',
      { relationTo: 0, value: 'A' },
      { relationTo: 'private', value: 'A' },
    ]) {
      expect(() => plan({ author: value }, [field])).toThrow();
    }
  });

  it('distinguishes complete rich-text references from partial nodes and opaque JSON fields', () => {
    const nodes = [
      { relationTo: 'authors', children: [{ relationTo: 'authors', value: 'A' }] },
      { value: 'Opaque value', children: [{ relationTo: 'media', value: 'M' }] },
      'text',
      null,
    ];
    const raw = { rich: nodes, metadata: { relationTo: 'private', value: 'P' } };
    expect(
      populated(raw, [
        { name: 'rich', type: 'richText' },
        { name: 'metadata', type: 'json' },
      ]),
    ).toEqual({
      rich: [
        {
          relationTo: 'authors',
          children: [{ relationTo: 'authors', value: { id: 'A', name: 'authors:A' } }],
        },
        {
          value: 'Opaque value',
          children: [{ relationTo: 'media', value: { id: 'M', name: 'media:M' } }],
        },
        'text',
        null,
      ],
      metadata: { relationTo: 'private', value: 'P' },
    });
    expect(raw.rich).toBe(nodes);
    expect(raw.rich[0]).toEqual({
      relationTo: 'authors',
      children: [{ relationTo: 'authors', value: 'A' }],
    });
  });

  it.each([
    '__proto__',
    'constructor',
    'prototype',
    '.',
    '..',
    '',
    'bad/name',
    'bad\\name',
    'bad\u001fname',
    '\uD800',
  ])('refuses unsafe schema field name %j', (name) => {
    expect(() => plan({ author: 'A' }, [{ ...author, name }])).toThrow();
  });

  it('refuses malformed field entries instead of following arbitrary properties', () => {
    for (const field of [null, 'author', [], 0]) {
      expect(() => plan({ author: 'A' }, [field] as unknown as PayloadFieldSchema[])).toThrow();
    }
  });
});
