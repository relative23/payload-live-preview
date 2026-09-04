import { describe, expect, it } from 'vitest';
import { migrateSource } from '@migrate/index';

const ONLY = { only: ['rename-bindings-authorized-option'] };
const IMPORT = "import { createPreviewBindings } from 'payload-live-preview';\n";

describe('rename-bindings-authorized-option', () => {
  it('renames the option key and keeps the value', () => {
    const src = `${IMPORT}const b = createPreviewBindings({ authorized: true });\n`;
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(`${IMPORT}const b = createPreviewBindings({ authorization: true });\n`);
    expect(conflicts).toEqual([]);
  });

  it('expands the shorthand form', () => {
    const src = `${IMPORT}const authorized = ctx !== null;\nconst b = createPreviewBindings({ authorized });\n`;
    expect(migrateSource(src, ONLY).output).toBe(
      `${IMPORT}const authorized = ctx !== null;\nconst b = createPreviewBindings({ authorization: authorized });\n`,
    );
  });

  it('finds the key after a nested object and in a multi-line literal', () => {
    const src = [
      IMPORT.trimEnd(),
      'export const bindings = createPreviewBindings({',
      "  context: { locale: 'de', fallback: {} },",
      '  authorized: Boolean(verdict),',
      '});',
      '',
    ].join('\n');
    const { output } = migrateSource(src, ONLY);
    expect(output.split('\n')[3]).toBe('  authorization: Boolean(verdict),');
    expect(output.split('\n')[2]).toBe("  context: { locale: 'de', fallback: {} },");
  });

  it('follows an alias and a string-literal key', () => {
    const src =
      "import { createPreviewBindings as bind } from 'payload-live-preview';\nbind({ 'authorized': ok });\n";
    expect(migrateSource(src, ONLY).output).toBe(
      "import { createPreviewBindings as bind } from 'payload-live-preview';\nbind({ authorization: ok });\n",
    );
  });

  it('touches only the top-level key of createPreviewBindings() options', () => {
    const src = [
      IMPORT.trimEnd(),
      'const opts = { authorized: true };',
      'const nested = createPreviewBindings({ meta: { authorized: true }, authorized: false });',
      'other({ authorized: true });',
      '',
    ].join('\n');
    const { output } = migrateSource(src, ONLY);
    expect(output.split('\n')[1]).toBe('const opts = { authorized: true };');
    expect(output.split('\n')[2]).toBe(
      'const nested = createPreviewBindings({ meta: { authorized: true }, authorization: false });',
    );
    expect(output.split('\n')[3]).toBe('other({ authorized: true });');
  });

  it('reports options it cannot see into instead of guessing', () => {
    const src = `${IMPORT}const a = createPreviewBindings(opts);\nconst b = createPreviewBindings({ ...base, authorized: true });\n`;
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toContain('createPreviewBindings(opts)');
    expect(output).toContain('{ ...base, authorization: true }');
    expect(conflicts.map((c) => c.line)).toEqual([2, 3]);
    expect(conflicts[0]?.reason).toContain('not a literal');
    expect(conflicts[1]?.reason).toContain('spreads its options');
  });

  it('ignores a same-named function that is not the package import', () => {
    const src =
      "import { initLivePreview } from 'payload-live-preview';\nimport { createPreviewBindings } from './mine';\ncreatePreviewBindings({ authorized: true });\n";
    expect(migrateSource(src, ONLY)).toEqual({ output: src, edits: [], conflicts: [] });
  });
});
