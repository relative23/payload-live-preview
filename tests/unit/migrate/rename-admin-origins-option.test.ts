import { describe, expect, it } from 'vitest';
import { migrateSource } from '@migrate/index';

const ONLY = { only: ['rename-admin-origins-option'] };
const IMPORT = "import { hasPreviewIntent } from 'payload-live-preview';\n";

describe('rename-admin-origins-option: what it renames', () => {
  it.each([
    [
      'a property with a value',
      `${IMPORT}const p = hasPreviewIntent(request, { adminOrigins: [env.ADMIN] });\n`,
      `${IMPORT}const p = hasPreviewIntent(request, { allowedOrigins: [env.ADMIN] });\n`,
    ],
    [
      'the shorthand form',
      `${IMPORT}const adminOrigins = [env.ADMIN];\nconst p = hasPreviewIntent(request, { adminOrigins });\n`,
      `${IMPORT}const adminOrigins = [env.ADMIN];\nconst p = hasPreviewIntent(request, { allowedOrigins: adminOrigins });\n`,
    ],
    [
      'a string-literal key beside other options, through an alias from a subpath',
      "import { hasPreviewIntent as intent } from 'payload-live-preview/astro';\nintent(r, { signals: ['referer'], 'adminOrigins': [a] });\n",
      "import { hasPreviewIntent as intent } from 'payload-live-preview/astro';\nintent(r, { signals: ['referer'], allowedOrigins: [a] });\n",
    ],
  ])('renames %s', (_label, src, expected) => {
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(expected);
    expect(conflicts).toEqual([]);
  });

  it('runs after the function rename, so a 1.x call is migrated in one pass', () => {
    const src =
      "import { isPreviewRequest } from 'payload-live-preview';\nconst p = isPreviewRequest(request, { adminOrigins: [a] });\n";
    expect(migrateSource(src).output).toBe(
      `${IMPORT}const p = hasPreviewIntent(request, { allowedOrigins: [a] });\n`,
    );
  });
});

describe('rename-admin-origins-option: what it leaves alone', () => {
  it.each([
    ['a call without options', `${IMPORT}hasPreviewIntent(request);\n`],
    ['the key in the first argument', `${IMPORT}hasPreviewIntent({ adminOrigins: [a] });\n`],
    [
      'the key in a nested object or another call',
      `${IMPORT}hasPreviewIntent(r, { meta: { adminOrigins: [a] } });\nother(r, { adminOrigins: [a] });\n`,
    ],
    [
      "a consumer's own hasPreviewIntent",
      "import { createPreviewBindings } from 'payload-live-preview';\nimport { hasPreviewIntent } from './mine';\nhasPreviewIntent(r, { adminOrigins: [a] });\n",
    ],
  ])('%s', (_label, src) => {
    expect(migrateSource(src, ONLY)).toEqual({ output: src, edits: [], conflicts: [] });
  });

  it('reports options it cannot see into, and a spread beside the key it renames', () => {
    const src = `${IMPORT}const a = hasPreviewIntent(r, opts);\nconst b = hasPreviewIntent(r, { ...base, adminOrigins: [x] });\n`;
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toContain('hasPreviewIntent(r, opts)');
    expect(output).toContain('{ ...base, allowedOrigins: [x] }');
    expect(conflicts.map((c) => c.line)).toEqual([2, 3]);
    expect(conflicts[0]?.reason).toContain('not a literal');
    expect(conflicts[1]?.reason).toContain('spreads its options');
  });

  it('reports a call that gives both names, since the package ignores the alias there', () => {
    const src = `${IMPORT}hasPreviewIntent(r, { allowedOrigins: [a], adminOrigins: [b] });\n`;
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(src);
    expect(conflicts).toEqual([
      expect.objectContaining({
        codemod: 'rename-admin-origins-option',
        line: 2,
        reason: expect.stringContaining('both adminOrigins and allowedOrigins') as string,
      }),
    ]);
  });
});
