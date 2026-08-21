import { describe, expect, it } from 'vitest';
import {
  buildPreviewInventory,
  checkPreviewBindings,
  type PreviewInventory,
} from '@/codegen/inventory';
import type { ExtractedSchema } from '@/codegen/parser/types';

const schema: ExtractedSchema = {
  diagnostics: [],
  globals: [
    {
      slug: 'homepage',
      typeName: 'Homepage',
      fields: [
        { kind: 'scalar', name: 'title', typeRef: 'string', localized: true, required: true },
        {
          kind: 'group',
          name: 'hero',
          localized: false,
          required: false,
          fields: [
            {
              kind: 'scalar',
              name: 'headline',
              typeRef: 'string',
              localized: false,
              required: false,
            },
          ],
        },
        {
          // What the parser produces for an unnamed `row`/`collapsible`.
          kind: 'group',
          name: '__structural',
          localized: false,
          required: false,
          fields: [
            {
              kind: 'scalar',
              name: 'tagline',
              typeRef: 'string',
              localized: false,
              required: false,
            },
            {
              kind: 'group',
              name: 'branding',
              localized: false,
              required: false,
              fields: [
                {
                  kind: 'scalar',
                  name: 'shortName',
                  typeRef: 'string',
                  localized: false,
                  required: false,
                },
              ],
            },
          ],
        },
        {
          kind: 'array',
          name: 'slides',
          localized: false,
          required: false,
          fields: [
            {
              kind: 'scalar',
              name: 'caption',
              typeRef: 'string',
              localized: false,
              required: false,
            },
          ],
        },
        {
          kind: 'blocks',
          name: 'sections',
          localized: false,
          required: false,
          blocks: [
            {
              slug: 'quote',
              typeName: 'QuoteBlock',
              fields: [
                {
                  kind: 'scalar',
                  name: 'body',
                  typeRef: 'string',
                  localized: false,
                  required: false,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  collections: [
    {
      slug: 'posts',
      typeName: 'Post',
      fields: [
        { kind: 'scalar', name: 'slug', typeRef: 'string', localized: false, required: true },
      ],
    },
  ],
};

const inventory: PreviewInventory = buildPreviewInventory(schema);
const homepage = inventory.globals[0]?.fields.map((field) => field.path) ?? [];

describe('buildPreviewInventory', () => {
  it('spells paths the way the runtime resolves them', () => {
    expect(homepage).toEqual([
      'title',
      'hero',
      'hero.headline',
      // No `__structural` segment: an unnamed row or collapsible contributes
      // nothing to the path, and emitting the sentinel would describe a field
      // the runtime resolves as `tagline`.
      'tagline',
      'branding',
      'branding.shortName',
      'slides',
      'slides.*.caption',
      'sections',
      'sections.*.quote.body',
    ]);
  });

  it('carries localization and requiredness, which decide how a field is bound', () => {
    expect(inventory.globals[0]?.fields[0]).toEqual({
      path: 'title',
      kind: 'scalar',
      localized: true,
      required: true,
    });
  });

  it('keeps globals and collections apart, because a slug can be both', () => {
    expect(inventory.collections.map((entry) => entry.slug)).toEqual(['posts']);
    expect(inventory.globals.map((entry) => entry.slug)).toEqual(['homepage']);
  });
});

describe('checkPreviewBindings', () => {
  it('accepts every path the inventory knows', () => {
    expect(
      checkPreviewBindings(inventory, [
        { kind: 'global', slug: 'homepage', path: 'hero.headline' },
        { kind: 'global', slug: 'homepage', path: 'slides.*.caption' },
        { kind: 'collection', slug: 'posts', path: 'slug' },
      ]),
    ).toEqual([]);
  });

  it('names the file for a renamed or misspelled field', () => {
    expect(
      checkPreviewBindings(inventory, [
        { kind: 'global', slug: 'homepage', path: 'hero.heading', source: 'Hero.astro:42' },
        { kind: 'global', slug: 'nav', path: 'items' },
      ]),
    ).toEqual([
      'global:homepage has no field "hero.heading" (Hero.astro:42)',
      'unknown global "nav"',
    ]);
  });

  it('does not confuse a global and a collection sharing a slug', () => {
    expect(
      checkPreviewBindings(inventory, [{ kind: 'collection', slug: 'homepage', path: 'title' }]),
    ).toEqual(['unknown collection "homepage"']);
  });

  it('reports unbound fields only when asked', () => {
    const bindings = [{ kind: 'collection', slug: 'posts', path: 'slug' } as const];
    expect(checkPreviewBindings(inventory, bindings)).toEqual([]);
    expect(
      checkPreviewBindings(inventory, bindings, { reportUnbound: true }).filter((line) =>
        line.startsWith('collection:posts'),
      ),
    ).toEqual([]);
    expect(checkPreviewBindings(inventory, bindings, { reportUnbound: true })).toContain(
      'global:homepage field "title" is never bound',
    );
  });
});
