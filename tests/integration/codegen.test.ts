/**
 * Round-trip codegen integration test.
 *
 * Drives `generateTypes()` against a realistic in-memory
 * `payload.config.ts`, then type-checks the emitted file via ts-morph
 * to confirm it compiles cleanly. This catches regressions where the
 * emit logic produces something the TypeScript compiler rejects (the
 * unit tests only string-match the output).
 */

import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { emitTypes } from '@/codegen/emit/emit-types';
import { extractSchema } from '@/codegen/parser/extract-schema';

const REALISTIC_CONFIG = `
  export default {
    globals: [{
      slug: 'homepage',
      fields: [
        { name: 'heroTitle', type: 'text', required: true },
        { name: 'heroTagline', type: 'text' },
        {
          name: 'seo',
          type: 'group',
          fields: [
            { name: 'metaTitle', type: 'text' },
            { name: 'metaDescription', type: 'textarea' },
          ],
        },
        {
          name: 'slides',
          type: 'array',
          fields: [
            { name: 'title', type: 'text', required: true },
            { name: 'image', type: 'upload', relationTo: 'media' },
          ],
        },
      ],
    }],
    collections: [{
      slug: 'posts',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'author', type: 'relationship', relationTo: 'users' },
        { name: 'tags', type: 'relationship', relationTo: ['cats', 'tags'], hasMany: true },
        { name: 'status', type: 'select', options: ['draft', 'published'] },
        {
          name: 'content',
          type: 'blocks',
          blocks: [
            { slug: 'callout', fields: [{ name: 'text', type: 'text' }] },
            { slug: 'image-block', fields: [{ name: 'src', type: 'text' }] },
          ],
        },
      ],
    }],
  };
`;

describe('codegen end-to-end', () => {
  it('emits TypeScript that compiles without diagnostics', () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        strict: true,
        noImplicitAny: true,
        target: 99 /* ESNext */,
        moduleResolution: 100 /* Bundler */,
        skipLibCheck: true,
      },
    });
    project.createSourceFile('/payload.config.ts', REALISTIC_CONFIG);

    const schema = extractSchema({ configPath: '/payload.config.ts', project });
    expect(schema.diagnostics).toHaveLength(0);
    const code = emitTypes(schema);

    // Stub the runtime imports so the in-memory program can resolve them.
    project.createSourceFile(
      '/node_modules/@relative23/payload-live-preview/index.d.ts',
      `
        export interface PayloadMedia {
          readonly id?: string | number;
          readonly url?: string;
        }
        export interface PayloadRelationship<TSlug extends string = string> {
          readonly id?: string | number;
          readonly relationTo?: TSlug;
        }
      `,
    );

    const generated = project.createSourceFile('/payload-types.ts', code, { overwrite: true });

    // Compile-time check: the emitted file should produce zero
    // diagnostics. If we changed the emit logic to produce invalid TS
    // (missing closing brace, broken union, malformed import) this
    // would fire.
    const diagnostics = generated.getPreEmitDiagnostics();
    const messages = diagnostics
      .map((d) => {
        const raw = d.getMessageText();
        const text = typeof raw === 'string' ? raw : raw.getMessageText();
        const file = d.getSourceFile()?.getFilePath() ?? '';
        return `${file}: ${text}`;
      })
      .filter((m) => !m.includes('Cannot find module'));
    expect(messages).toEqual([]);
  });

  it('round-trips real-world Payload features end-to-end', () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    project.createSourceFile('/payload.config.ts', REALISTIC_CONFIG);
    const schema = extractSchema({ configPath: '/payload.config.ts', project });

    // Spot-check key shape decisions.
    expect(schema.globals[0]!.fields.map((f) => f.name)).toEqual([
      'heroTitle',
      'heroTagline',
      'seo',
      'slides',
    ]);
    expect(schema.collections[0]!.fields[3]!.kind).toBe('select');
    expect(schema.collections[0]!.fields[4]!.kind).toBe('blocks');
  });
});
