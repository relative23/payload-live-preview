import { describe, expect, it } from 'vitest';
import { migrateSource } from '@migrate/index';

const ONLY = { only: ['rename-is-preview-request'] };

describe('rename-is-preview-request: what it renames', () => {
  it('renames the import and every call bound to it', () => {
    const src = [
      "import { isPreviewRequest } from 'payload-live-preview';",
      'export const onRequest = (context, next) => {',
      '  if (isPreviewRequest(context.request)) context.locals.preview = true;',
      '  return next();',
      '};',
      '',
    ].join('\n');
    const { output, edits, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(src.replaceAll('isPreviewRequest', 'hasPreviewIntent'));
    expect(conflicts).toEqual([]);
    expect(edits).toEqual([
      {
        codemod: 'rename-is-preview-request',
        count: 2,
        lines: [
          { line: 1, before: src.split('\n')[0], after: output.split('\n')[0] },
          { line: 3, before: src.split('\n')[2], after: output.split('\n')[2] },
        ],
      },
    ]);
  });

  it('renames a binding from a subpath and one destructured from require()', () => {
    const esm =
      "import { isPreviewRequest } from 'payload-live-preview/server';\nisPreviewRequest(r);\n";
    expect(migrateSource(esm, ONLY).output).toBe(
      "import { hasPreviewIntent } from 'payload-live-preview/server';\nhasPreviewIntent(r);\n",
    );
    const cjs =
      "const { isPreviewRequest } = require('payload-live-preview');\nmodule.exports = (r) => isPreviewRequest(r);\n";
    expect(migrateSource(cjs, { ...ONLY, fileName: 'guard.cjs' }).output).toBe(
      "const { hasPreviewIntent } = require('payload-live-preview');\nmodule.exports = (r) => hasPreviewIntent(r);\n",
    );
  });

  it('keeps a local alias and only renames the imported name', () => {
    const src = "import { isPreviewRequest as ipr } from 'payload-live-preview';\nipr(req);\n";
    expect(migrateSource(src, ONLY).output).toBe(
      "import { hasPreviewIntent as ipr } from 'payload-live-preview';\nipr(req);\n",
    );
  });

  it('collapses `isPreviewRequest as hasPreviewIntent` to the bare name', () => {
    const src =
      "import { isPreviewRequest as hasPreviewIntent } from 'payload-live-preview';\nhasPreviewIntent(req);\n";
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(conflicts).toEqual([]);
    expect(output).toBe(
      "import { hasPreviewIntent } from 'payload-live-preview';\nhasPreviewIntent(req);\n",
    );
  });

  it('renames a typeof reference and a plain identifier argument', () => {
    const src =
      "import { isPreviewRequest } from 'payload-live-preview';\ntype Check = typeof isPreviewRequest;\nregister(isPreviewRequest);\n";
    expect(migrateSource(src, ONLY).output).toBe(
      "import { hasPreviewIntent } from 'payload-live-preview';\ntype Check = typeof hasPreviewIntent;\nregister(hasPreviewIntent);\n",
    );
  });
});

describe('rename-is-preview-request: what it leaves alone', () => {
  it("leaves a consumer's own isPreviewRequest imported from a local module, even beside a package import", () => {
    const src = [
      "import { createPreviewBindings } from 'payload-live-preview';",
      "import { isPreviewRequest } from './my-utils';",
      'export const bindings = createPreviewBindings({ authorization: null });',
      'export const preview = (r) => isPreviewRequest(r);',
      '',
    ].join('\n');
    const { output, edits, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(src);
    expect(edits).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it('does not rename a class method of the same name or its this.isPreviewRequest() call site, and says so', () => {
    const src = [
      "import { isPreviewRequest } from 'payload-live-preview';",
      'export class Guard {',
      '  isPreviewRequest(req) { return isPreviewRequest(req) && this.enabled; }',
      '  check(req) { return this.isPreviewRequest(req); }',
      '}',
      '',
    ].join('\n');
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(
      [
        "import { hasPreviewIntent } from 'payload-live-preview';",
        'export class Guard {',
        '  isPreviewRequest(req) { return hasPreviewIntent(req) && this.enabled; }',
        '  check(req) { return this.isPreviewRequest(req); }',
        '}',
        '',
      ].join('\n'),
    );
    expect(conflicts).toEqual([
      expect.objectContaining({ codemod: 'rename-is-preview-request', line: 4 }),
    ]);
    expect(conflicts[0]?.reason).toContain('.isPreviewRequest is a member');
  });

  it('respects shadowing: an inner const of the same name is a different binding', () => {
    const src = [
      "import { isPreviewRequest } from 'payload-live-preview';",
      'export function outer(r) {',
      '  const isPreviewRequest = () => false;',
      '  return isPreviewRequest();',
      '}',
      'export const direct = (r) => isPreviewRequest(r);',
      '',
    ].join('\n');
    const { output } = migrateSource(src, ONLY);
    expect(output.split('\n')[2]).toBe('  const isPreviewRequest = () => false;');
    expect(output.split('\n')[3]).toBe('  return isPreviewRequest();');
    expect(output.split('\n')[5]).toBe('export const direct = (r) => hasPreviewIntent(r);');
  });

  it('leaves comments and strings untouched', () => {
    const src =
      "import { isPreviewRequest } from 'payload-live-preview';\n// isPreviewRequest is the old name\nconst label = 'isPreviewRequest';\nisPreviewRequest(r);\n";
    const { output } = migrateSource(src, ONLY);
    expect(output).toContain('// isPreviewRequest is the old name');
    expect(output).toContain("const label = 'isPreviewRequest';");
    expect(output).toContain('hasPreviewIntent(r);');
  });

  it('does nothing in a file that imports something else from the package', () => {
    const src = "import { hasPreviewIntent } from 'payload-live-preview';\nx.isPreviewRequest();\n";
    expect(migrateSource(src, ONLY)).toEqual({ output: src, edits: [], conflicts: [] });
  });
});

describe('rename-is-preview-request: conflicts leave the file untouched', () => {
  it('reports an object shorthand, whose key other code reads through api.isPreviewRequest()', () => {
    const src = [
      "import { isPreviewRequest } from 'payload-live-preview';",
      'export const api = { isPreviewRequest };',
      'export const check = (r) => api.isPreviewRequest(r);',
      '',
    ].join('\n');
    const { output, edits, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(src);
    expect(edits).toEqual([]);
    expect(conflicts.map((c) => c.line)).toEqual([2, 3]);
    expect(conflicts[0]?.reason).toContain('{ isPreviewRequest }');
  });

  it('reports a re-export under the old name', () => {
    const src =
      "import { isPreviewRequest } from 'payload-live-preview';\nexport { isPreviewRequest };\n";
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(output).toBe(src);
    expect(conflicts).toEqual([
      expect.objectContaining({
        line: 2,
        reason: expect.stringContaining('re-exported') as string,
      }),
    ]);
  });

  it.each([
    [
      'a local wrapper function',
      'export function hasPreviewIntent(r) { return isPreviewRequest(r, { signals: ["query"] }); }',
    ],
    ['a default import', "import hasPreviewIntent from './guard';"],
    ['a require() destructuring', "const { hasPreviewIntent } = require('./guard');"],
    ['a renamed import', "import { guard as hasPreviewIntent } from './guard';"],
    ['a namespace import', "import * as hasPreviewIntent from './guard';"],
    [
      'a parameter',
      'export const handle = (hasPreviewIntent) => isPreviewRequest(hasPreviewIntent);',
    ],
  ])(
    'reports %s that already binds hasPreviewIntent, on the input, without rewriting',
    (_label, binding) => {
      const src = `import { isPreviewRequest } from 'payload-live-preview';\n${binding}\nisPreviewRequest(r);\n`;
      const { output, edits, conflicts } = migrateSource(src, ONLY);
      expect(output).toBe(src);
      expect(edits).toEqual([]);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]?.reason).toContain('already binds hasPreviewIntent');
    },
  );

  it('is not fooled by a comment or string that mentions `hasPreviewIntent as`', () => {
    const src =
      "import { isPreviewRequest } from 'payload-live-preview';\n// exported upstream as hasPreviewIntent as of 1.1\nconst note = 'hasPreviewIntent as alias';\nisPreviewRequest(r);\n";
    const { output, conflicts } = migrateSource(src, ONLY);
    expect(conflicts).toEqual([]);
    expect(output).toContain("import { hasPreviewIntent } from 'payload-live-preview';");
    expect(output).toContain('hasPreviewIntent(r);');
  });
});
