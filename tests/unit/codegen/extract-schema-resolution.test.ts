import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractSchema } from '@/codegen/parser/extract-schema';
import type { ExtractedSchema } from '@/codegen/parser/types';

function extract(files: Record<string, string>): ExtractedSchema {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  for (const [path, content] of Object.entries(files)) {
    project.createSourceFile(path, content, { overwrite: true });
  }
  return extractSchema({ project, configPath: '/payload.config.ts' });
}

function fieldNames(schema: ExtractedSchema): string[] {
  return schema.collections[0]?.fields.map((field) => field.name) ?? [];
}

describe('shapes the config is really written in', () => {
  it('resolves a default export that only names its parts', () => {
    const schema = extract({
      '/payload.config.ts': `
        const collections = [{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }];
        const globals = [{ slug: 'home', fields: [{ name: 'hero', type: 'text' }] }];
        export default { collections, globals };
      `,
    });
    expect(schema.diagnostics).toEqual([]);
    expect(schema.collections.map((collection) => collection.slug)).toEqual(['posts']);
    expect(schema.globals.map((global) => global.slug)).toEqual(['home']);
  });

  it('resolves `fields` given as an identifier, like the top-level lists already did', () => {
    const schema = extract({
      '/payload.config.ts': `
        const postFields = [{ name: 'title', type: 'text' }, { name: 'body', type: 'richText' }];
        export default { collections: [{ slug: 'posts', fields: postFields }] };
      `,
    });
    expect(schema.diagnostics).toEqual([]);
    expect(fieldNames(schema)).toEqual(['title', 'body']);
  });

  it('follows an imported binding to the module that declares it', () => {
    const schema = extract({
      '/fields.ts': `export const shared = [{ name: 'metaTitle', type: 'text' }];`,
      '/payload.config.ts': `
        import { shared } from './fields';
        export default { collections: [{ slug: 'posts', fields: shared }] };
      `,
    });
    expect(schema.diagnostics).toEqual([]);
    expect(fieldNames(schema)).toEqual(['metaTitle']);
  });

  it('expands a spread inside a group, an array, a tab and a block', () => {
    const schema = extract({
      '/payload.config.ts': `
        const shared = [{ name: 'metaTitle', type: 'text' }];
        export default {
          collections: [
            {
              slug: 'posts',
              fields: [
                { name: 'seo', type: 'group', fields: [...shared, { name: 'canonical', type: 'text' }] },
                { name: 'slides', type: 'array', fields: [...shared] },
                { type: 'tabs', tabs: [{ name: 'meta', fields: [...shared] }] },
                { name: 'layout', type: 'blocks', blocks: [{ slug: 'hero', fields: [...shared] }] },
              ],
            },
          ],
        };
      `,
    });
    expect(schema.diagnostics).toEqual([]);
    const fields = schema.collections[0]?.fields ?? [];
    const seo = fields.find((field) => field.name === 'seo');
    const slides = fields.find((field) => field.name === 'slides');
    const meta = fields.find((field) => field.name === 'meta');
    const layout = fields.find((field) => field.name === 'layout');
    expect(seo?.kind === 'group' ? seo.fields.map((field) => field.name) : []).toEqual([
      'metaTitle',
      'canonical',
    ]);
    expect(slides?.kind === 'array' ? slides.fields.map((field) => field.name) : []).toEqual([
      'metaTitle',
    ]);
    expect(meta?.kind === 'group' ? meta.fields.map((field) => field.name) : []).toEqual([
      'metaTitle',
    ]);
    expect(
      layout?.kind === 'blocks' ? (layout.blocks[0]?.fields.map((field) => field.name) ?? []) : [],
    ).toEqual(['metaTitle']);
  });
});

describe('what it cannot resolve, it says out loud', () => {
  it('reports a conditional spread at the top level instead of dropping it in silence', () => {
    const schema = extract({
      '/payload.config.ts': `
        declare const flag: boolean;
        const base = [{ slug: 'posts', fields: [{ name: 'title', type: 'text' }] }];
        const extra = [{ slug: 'drafts', fields: [] }];
        export default { collections: [...base, ...(flag ? extra : [])] };
      `,
    });
    expect(schema.collections.map((collection) => collection.slug)).toEqual(['posts']);
    expect(schema.diagnostics.join('\n')).toContain('could not resolve the spread to an array');
  });

  it('reports an entry that is not an object literal', () => {
    const schema = extract({
      '/payload.config.ts': `
        declare function makeCollection(): { slug: string; fields: [] };
        export default { collections: [makeCollection()] };
      `,
    });
    expect(schema.collections).toEqual([]);
    expect(schema.diagnostics.join('\n')).toContain('could not resolve the config entry');
  });

  it('reports `fields` it cannot see into rather than emitting an empty interface', () => {
    const schema = extract({
      '/payload.config.ts': `
        declare function buildFields(): [];
        export default { collections: [{ slug: 'posts', fields: buildFields() }] };
      `,
    });
    expect(fieldNames(schema)).toEqual([]);
    expect(schema.diagnostics.join('\n')).toContain('`fields` of "posts" could not be resolved');
  });

  it('reports a collection with no `fields` at all', () => {
    const schema = extract({
      '/payload.config.ts': `export default { collections: [{ slug: 'posts' }] };`,
    });
    expect(schema.diagnostics.join('\n')).toContain('"posts" has no `fields`');
  });

  it('reports a nested spread it cannot expand, naming where it happened', () => {
    const schema = extract({
      '/payload.config.ts': `
        declare const more: unknown[];
        export default {
          collections: [
            { slug: 'posts', fields: [{ name: 'seo', type: 'group', fields: [...more] }] },
          ],
        };
      `,
    });
    expect(schema.diagnostics.join('\n')).toContain('could not resolve the spread to an array');
    expect(schema.diagnostics.join('\n')).toContain('payload.config.ts:');
  });

  it('reports a field that has no string `type`', () => {
    const schema = extract({
      '/payload.config.ts': `
        declare const kind: string;
        export default { collections: [{ slug: 'posts', fields: [{ name: 'title', type: kind }] }] };
      `,
    });
    expect(fieldNames(schema)).toEqual([]);
    expect(schema.diagnostics.join('\n')).toContain('it has no string `type`');
  });
});
