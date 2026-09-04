import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Project, ts } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { emitTypes } from '@/codegen/emit/emit-types';
import { extractSchema } from '@/codegen/parser/extract-schema';
import type { ExtractedSchema } from '@/codegen/parser/types';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/**
 * A Payload config the way consumers really write one: collections in their own
 * files, a shared field array spread into several parents, and a default export
 * that only names its parts.
 */
const FIXTURE: Readonly<Record<string, string>> = {
  'payload.config.ts': `
    import { collections } from './collections';
    import { globals } from './globals';

    export default { collections, globals };
  `,
  'fields/seo.ts': `
    export const seoFields = [
      { name: 'metaTitle', type: 'text' },
      { name: 'metaDescription', type: 'textarea' },
    ];
  `,
  'globals/index.ts': `
    import { seoFields } from '../fields/seo';

    export const globals = [
      {
        slug: 'site-settings',
        fields: [
          { name: 'siteTitle', type: 'text', required: true },
          { name: 'hero-image', type: 'upload', relationTo: 'media' },
          { name: 'gallery', type: 'upload', relationTo: 'media', hasMany: true },
          { name: 'coordinates', type: 'point' },
          { name: 'theme', type: 'radio', options: ['light', 'dark'] },
          { name: 'tags', type: 'text', hasMany: true },
          { name: 'weights', type: 'number', hasMany: true },
          { name: 'openDrawer', type: 'ui' },
          { name: 'seo', type: 'group', fields: [...seoFields, { name: 'canonical', type: 'text' }] },
        ],
      },
    ];
  `,
  'collections/index.ts': `
    import { Media } from './media';
    import { Posts } from './posts';

    const extraCollections = [Media];

    export const collections = [Posts, ...extraCollections];
  `,
  'collections/media.ts': `
    export const Media = { slug: 'media', fields: [{ name: 'alt', type: 'text' }] };
  `,
  'collections/posts.ts': `
    import { seoFields } from '../fields/seo';

    const postFields = [
      { name: 'title', type: 'text', required: true },
      { name: 'author', type: 'relationship', relationTo: 'users' },
      {
        name: 'status',
        type: 'radio',
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Live', value: 'live' },
        ],
      },
      { name: 'slides', type: 'array', fields: [...seoFields, { name: 'caption', type: 'text' }] },
      {
        name: 'layout',
        type: 'blocks',
        blocks: [
          { slug: 'hero', fields: [...seoFields, { name: 'headline', type: 'text' }] },
          { slug: 'call-to-action', fields: [{ name: 'label', type: 'text' }] },
        ],
      },
      {
        type: 'tabs',
        tabs: [
          { name: 'meta', fields: [{ name: 'publishedAt', type: 'date' }] },
          { label: 'Content', fields: [{ name: 'body', type: 'richText' }] },
        ],
      },
    ];

    export const Posts = { slug: 'posts', fields: postFields };
  `,
  'tsconfig.json': `{ "compilerOptions": { "strict": true, "module": "esnext", "target": "es2022" } }`,
};

async function writeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pll-codegen-fixture-'));
  for (const [name, content] of Object.entries(FIXTURE)) {
    const path = join(root, name);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
  return root;
}

/** Type-check the emitted file against the package's real `PayloadMedia`/`PayloadRelationship`. */
function typeCheck(root: string): readonly string[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: { 'payload-live-preview': [join(REPO_ROOT, 'src/field-types/types.ts')] },
    },
  });
  project.addSourceFileAtPath(join(root, 'payload-types.ts'));
  project.resolveSourceFileDependencies();
  return project
    .getPreEmitDiagnostics()
    .map((diagnostic) => project.formatDiagnosticsWithColorAndContext([diagnostic]));
}

let schema: ExtractedSchema;
let code: string;
let compileErrors: readonly string[];

beforeAll(async () => {
  const root = await writeFixture();
  schema = extractSchema({
    configPath: join(root, 'payload.config.ts'),
    tsConfigFilePath: join(root, 'tsconfig.json'),
  });
  code = emitTypes(schema);
  await writeFile(join(root, 'payload-types.ts'), code, 'utf8');
  compileErrors = typeCheck(root);
}, 60_000);

describe('a multi-file Payload config on disk', () => {
  it('resolves every slug across the files, with nothing skipped', () => {
    expect(schema.diagnostics).toEqual([]);
    expect(schema.globals.map((global) => global.slug)).toEqual(['site-settings']);
    expect(schema.collections.map((collection) => collection.slug)).toEqual(['posts', 'media']);
  });

  it('pulls the shared field array into every parent that spreads it', () => {
    const seo = schema.globals[0]?.fields.find((field) => field.name === 'seo');
    expect(seo?.kind === 'group' ? seo.fields.map((field) => field.name) : []).toEqual([
      'metaTitle',
      'metaDescription',
      'canonical',
    ]);
    const slides = schema.collections[0]?.fields.find((field) => field.name === 'slides');
    expect(slides?.kind === 'array' ? slides.fields.map((field) => field.name) : []).toEqual([
      'metaTitle',
      'metaDescription',
      'caption',
    ]);
  });

  it('flattens tabs, naming the ones that carry a name', () => {
    const names = schema.collections[0]?.fields.map((field) => field.name);
    expect(names).toContain('meta');
    expect(names).toContain('body');
    expect(names).not.toContain('__structural');
  });
});

describe('the emitted types', () => {
  it('compiles under strict TypeScript', () => {
    expect(compileErrors).toEqual([]);
  });

  it('quotes a member name that is not an identifier', () => {
    expect(code).toContain("'hero-image'?: PayloadMedia;");
  });

  it('makes hasMany scalars and uploads arrays', () => {
    expect(code).toContain('gallery?: PayloadMedia[];');
    expect(code).toContain('tags?: string[];');
    expect(code).toContain('weights?: number[];');
  });

  it('keeps radio options as literals and points as a tuple', () => {
    expect(code).toContain("theme?: 'light' | 'dark';");
    expect(code).toContain("status?: 'draft' | 'live';");
    expect(code).toContain('coordinates?: [number, number];');
  });

  it('leaves ui fields out, since they hold no data', () => {
    expect(code).not.toContain('openDrawer');
  });

  it('names a block interface per variant, hyphenated slugs included', () => {
    expect(code).toContain('export interface PostsLayoutHero {');
    expect(code).toContain('export interface PostsLayoutCallToAction {');
    expect(code).toContain("blockType: 'call-to-action';");
    expect(code).toContain('layout?: (PostsLayoutHero | PostsLayoutCallToAction)[];');
  });

  it('maps every slug, using the quoted slug as the key', () => {
    expect(code).toContain("'site-settings': SiteSettings;");
    expect(code).toContain("'posts': Posts;");
    expect(code).toContain(
      'export type PayloadSlug = keyof PayloadGlobals | keyof PayloadCollections;',
    );
  });
});
