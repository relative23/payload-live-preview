import { describe, expect, it } from 'vitest';
import { Project } from 'ts-morph';
import { emitTypes } from '@/codegen/emit/emit-types';
import { extractSchema } from '@/codegen/parser/extract-schema';

function generate(source: string): string {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  project.createSourceFile('/payload.config.ts', source, { overwrite: true });
  const schema = extractSchema({ configPath: '/payload.config.ts', project });
  return emitTypes(schema);
}

describe('emitTypes — scalar globals', () => {
  it('renders an interface with optional/required markers', () => {
    const code = generate(`
      export default {
        globals: [{
          slug: 'homepage',
          fields: [
            { name: 'heroTitle', type: 'text', required: true },
            { name: 'heroTagline', type: 'text' },
            { name: 'viewCount', type: 'number' },
            { name: 'isFeatured', type: 'checkbox' },
            { name: 'publishedAt', type: 'date' },
          ],
        }],
        collections: [],
      };
    `);
    expect(code).toContain('export interface Homepage {');
    expect(code).toContain('heroTitle: string;');
    expect(code).toContain('heroTagline?: string;');
    expect(code).toContain('viewCount?: number;');
    expect(code).toContain('isFeatured?: boolean;');
    expect(code).toContain('publishedAt?: string;');
  });

  it('emits a PayloadGlobals map', () => {
    const code = generate(`
      export default {
        globals: [
          { slug: 'homepage', fields: [] },
          { slug: 'footer', fields: [] },
        ],
        collections: [],
      };
    `);
    expect(code).toMatch(/export type PayloadGlobals = \{/);
    expect(code).toContain("'homepage': Homepage;");
    expect(code).toContain("'footer': Footer;");
    expect(code).toContain('export type PayloadSlug = keyof PayloadGlobals');
  });

  it('emits a PayloadCollections map alongside globals', () => {
    const code = generate(`
      export default {
        globals: [{ slug: 'site', fields: [] }],
        collections: [{ slug: 'posts', fields: [] }],
      };
    `);
    expect(code).toContain('export type PayloadGlobals');
    expect(code).toContain('export type PayloadCollections');
    expect(code).toContain('keyof PayloadGlobals | keyof PayloadCollections');
  });
});

describe('emitTypes — nested arrays and groups', () => {
  it('emits a sibling interface for each nested array field', () => {
    const code = generate(`
      export default {
        globals: [{
          slug: 'homepage',
          fields: [{
            name: 'slides',
            type: 'array',
            fields: [
              { name: 'title', type: 'text', required: true },
              { name: 'href', type: 'text' },
            ],
          }],
        }],
        collections: [],
      };
    `);
    expect(code).toContain('export interface HomepageSlides {');
    expect(code).toContain('title: string;');
    expect(code).toContain('href?: string;');
    expect(code).toContain('slides?: HomepageSlides[];');
  });

  it('emits a sibling interface for group fields', () => {
    const code = generate(`
      export default {
        globals: [{
          slug: 'homepage',
          fields: [{
            name: 'seo',
            type: 'group',
            fields: [
              { name: 'metaTitle', type: 'text' },
              { name: 'metaDescription', type: 'textarea' },
            ],
          }],
        }],
        collections: [],
      };
    `);
    expect(code).toContain('export interface HomepageSeo {');
    expect(code).toContain('seo?: HomepageSeo;');
  });
});

describe('emitTypes — blocks fields', () => {
  it('emits one interface per block variant + discriminated union', () => {
    const code = generate(`
      export default {
        globals: [{
          slug: 'homepage',
          fields: [{
            name: 'content',
            type: 'blocks',
            blocks: [
              { slug: 'callout', fields: [{ name: 'text', type: 'text' }] },
              { slug: 'image-block', fields: [{ name: 'src', type: 'text' }] },
            ],
          }],
        }],
        collections: [],
      };
    `);
    expect(code).toContain('export interface HomepageContentCallout');
    expect(code).toContain("blockType: 'callout';");
    expect(code).toContain('export interface HomepageContentImageBlock');
    expect(code).toContain("blockType: 'image-block';");
    expect(code).toContain('content?: (HomepageContentCallout | HomepageContentImageBlock)[];');
  });
});

describe('emitTypes — relationships & uploads & select', () => {
  it('renders relationship targets in the PayloadRelationship generic', () => {
    const code = generate(`
      export default {
        globals: [],
        collections: [{
          slug: 'posts',
          fields: [
            { name: 'author', type: 'relationship', relationTo: 'users', required: true },
            { name: 'tags', type: 'relationship', relationTo: ['cats', 'tags'], hasMany: true },
          ],
        }],
      };
    `);
    expect(code).toContain("author: PayloadRelationship<'users'>;");
    expect(code).toContain("tags?: PayloadRelationship<'cats' | 'tags'>[];");
  });

  it('renders upload fields as PayloadMedia', () => {
    const code = generate(`
      export default {
        globals: [],
        collections: [{
          slug: 'posts',
          fields: [{ name: 'cover', type: 'upload', relationTo: 'media' }],
        }],
      };
    `);
    expect(code).toContain('cover?: PayloadMedia;');
  });

  it('renders select fields as string-literal unions', () => {
    const code = generate(`
      export default {
        globals: [],
        collections: [{
          slug: 'posts',
          fields: [
            { name: 'status', type: 'select', options: ['draft', 'published'] },
            { name: 'tags', type: 'select', options: ['a', 'b'], hasMany: true },
          ],
        }],
      };
    `);
    expect(code).toContain("status?: 'draft' | 'published';");
    expect(code).toContain("tags?: ('a' | 'b')[];");
  });
});

describe('emitTypes — header & imports', () => {
  it('includes the auto-generated header by default', () => {
    const code = generate(`export default { globals: [], collections: [] };`);
    expect(code).toContain('Auto-generated');
  });

  it('imports PayloadMedia and PayloadRelationship', () => {
    const code = generate(`export default { globals: [], collections: [] };`);
    expect(code).toContain('import type { PayloadMedia, PayloadRelationship }');
  });
});
