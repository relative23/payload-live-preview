import { describe, expect, it } from 'vitest';
import { Project } from 'ts-morph';
import { extractSchema } from '@/codegen/parser/extract-schema';

function makeProject(files: Record<string, string>): {
  project: Project;
  configPath: string;
} {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });
  for (const [path, content] of Object.entries(files)) {
    project.createSourceFile(path, content, { overwrite: true });
  }
  return { project, configPath: '/payload.config.ts' };
}

describe('extractSchema — inline literal config', () => {
  it('extracts globals and collections from a single-file config', () => {
    const { project, configPath } = makeProject({
      '/payload.config.ts': `
        export default {
          globals: [
            {
              slug: 'homepage',
              fields: [
                { name: 'heroTitle', type: 'text', required: true },
                { name: 'heroTagline', type: 'text' },
                { name: 'metaDescription', type: 'textarea' },
              ],
            },
          ],
          collections: [
            {
              slug: 'posts',
              fields: [
                { name: 'title', type: 'text', required: true },
                { name: 'body', type: 'richText' },
                { name: 'publishedAt', type: 'date' },
              ],
            },
          ],
        };
      `,
    });
    const schema = extractSchema({ configPath, project });
    expect(schema.globals).toHaveLength(1);
    expect(schema.globals[0]!.slug).toBe('homepage');
    expect(schema.globals[0]!.typeName).toBe('Homepage');
    expect(schema.globals[0]!.fields).toHaveLength(3);
    expect(schema.collections).toHaveLength(1);
    expect(schema.collections[0]!.slug).toBe('posts');
  });

  it('unwraps buildConfig({...}) wrappers', () => {
    const { project, configPath } = makeProject({
      '/payload.config.ts': `
        import { buildConfig } from 'payload';
        export default buildConfig({
          globals: [{ slug: 'footer', fields: [{ name: 'copyright', type: 'text' }] }],
          collections: [],
        });
      `,
    });
    const schema = extractSchema({ configPath, project });
    expect(schema.globals).toHaveLength(1);
    expect(schema.globals[0]!.slug).toBe('footer');
    expect(schema.collections).toHaveLength(0);
  });

  it('follows identifiers to literals in the same file', () => {
    const { project, configPath } = makeProject({
      '/payload.config.ts': `
        const Homepage = {
          slug: 'homepage',
          fields: [{ name: 'heroTitle', type: 'text' }],
        };
        export default {
          globals: [Homepage],
          collections: [],
        };
      `,
    });
    const schema = extractSchema({ configPath, project });
    expect(schema.globals).toHaveLength(1);
    expect(schema.globals[0]!.slug).toBe('homepage');
  });

  it('extracts nested array fields', () => {
    const { project, configPath } = makeProject({
      '/payload.config.ts': `
        export default {
          globals: [{
            slug: 'homepage',
            fields: [{
              name: 'slides',
              type: 'array',
              fields: [
                { name: 'title', type: 'text' },
                { name: 'image', type: 'upload', relationTo: 'media' },
              ],
            }],
          }],
          collections: [],
        };
      `,
    });
    const schema = extractSchema({ configPath, project });
    const slides = schema.globals[0]!.fields[0]!;
    expect(slides.kind).toBe('array');
    if (slides.kind === 'array') {
      expect(slides.fields).toHaveLength(2);
      expect(slides.fields[0]!.name).toBe('title');
      expect(slides.fields[1]!.kind).toBe('upload');
    }
  });

  it('extracts blocks with their slug-keyed variants', () => {
    const { project, configPath } = makeProject({
      '/payload.config.ts': `
        export default {
          globals: [{
            slug: 'homepage',
            fields: [{
              name: 'content',
              type: 'blocks',
              blocks: [
                { slug: 'callout', fields: [{ name: 'text', type: 'text' }] },
                { slug: 'cta-button', fields: [
                  { name: 'label', type: 'text' },
                  { name: 'href', type: 'text' },
                ] },
              ],
            }],
          }],
          collections: [],
        };
      `,
    });
    const schema = extractSchema({ configPath, project });
    const content = schema.globals[0]!.fields[0]!;
    expect(content.kind).toBe('blocks');
    if (content.kind === 'blocks') {
      expect(content.blocks).toHaveLength(2);
      expect(content.blocks[0]!.slug).toBe('callout');
      expect(content.blocks[1]!.slug).toBe('cta-button');
      expect(content.blocks[1]!.typeName).toBe('CtaButton');
    }
  });

  it('flattens tabs into group fields', () => {
    const { project, configPath } = makeProject({
      '/payload.config.ts': `
        export default {
          globals: [{
            slug: 'homepage',
            fields: [{
              type: 'tabs',
              name: '_tabs',
              tabs: [
                {
                  name: 'seo',
                  fields: [{ name: 'metaTitle', type: 'text' }],
                },
                {
                  fields: [{ name: 'flatField', type: 'text' }],
                },
              ],
            }],
          }],
          collections: [],
        };
      `,
    });
    const schema = extractSchema({ configPath, project });
    const tabs = schema.globals[0]!.fields[0]!;
    expect(tabs.kind).toBe('group');
    if (tabs.kind === 'group') {
      // Two flattened entries: the named tab + the flat field
      expect(tabs.fields.map((f) => f.name)).toEqual(['seo', 'flatField']);
    }
  });

  it('handles relationships and uploads', () => {
    const { project, configPath } = makeProject({
      '/payload.config.ts': `
        export default {
          globals: [],
          collections: [{
            slug: 'posts',
            fields: [
              { name: 'author', type: 'relationship', relationTo: 'users' },
              { name: 'cover', type: 'upload', relationTo: 'media' },
              { name: 'categories', type: 'relationship', relationTo: ['cats', 'tags'], hasMany: true },
            ],
          }],
        };
      `,
    });
    const schema = extractSchema({ configPath, project });
    const fields = schema.collections[0]!.fields;
    const author = fields[0]!;
    if (author.kind === 'relationship') {
      expect(author.target).toBe('users');
      expect(author.hasMany).toBe(false);
    } else {
      throw new Error('expected relationship');
    }
    const categories = fields[2]!;
    if (categories.kind === 'relationship') {
      expect(categories.target).toEqual(['cats', 'tags']);
      expect(categories.hasMany).toBe(true);
    } else {
      throw new Error('expected relationship');
    }
  });

  it('emits select option literals', () => {
    const { project, configPath } = makeProject({
      '/payload.config.ts': `
        export default {
          globals: [],
          collections: [{
            slug: 'posts',
            fields: [
              { name: 'status', type: 'select', options: ['draft', 'published'] },
              { name: 'tags', type: 'select', options: [{ value: 'a' }, { value: 'b' }], hasMany: true },
            ],
          }],
        };
      `,
    });
    const schema = extractSchema({ configPath, project });
    const [status, tags] = schema.collections[0]!.fields;
    if (status?.kind !== 'select') throw new Error('expected select');
    expect(status.options).toEqual(['draft', 'published']);
    expect(status.hasMany).toBe(false);
    if (tags?.kind !== 'select') throw new Error('expected select');
    expect(tags.options).toEqual(['a', 'b']);
    expect(tags.hasMany).toBe(true);
  });

  it('emits a diagnostic when the file is missing', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const schema = extractSchema({ configPath: '/missing.ts', project });
    expect(schema.globals).toHaveLength(0);
    expect(schema.collections).toHaveLength(0);
    expect(schema.diagnostics.join(' ')).toMatch(/Could not open/);
  });
});
