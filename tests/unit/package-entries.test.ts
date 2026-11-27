import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI_ENTRIES, DIRECTIVE_ENTRIES, LIBRARY_ENTRIES } from '../../scripts/package-entries';

/**
 * Package topology: the `exports` map and the build entries agree with each
 * other. A subpath in the manifest without a build entry ships a dangling
 * path; a build entry without a subpath ships an unreachable file. Since 3.0
 * the package is one ESM graph (ADR 0007, row 43): no entry has a CommonJS
 * build, and the ones that had one stay loadable through `require()`.
 */

interface Conditions {
  readonly import?: { readonly types: string; readonly default: string };
  readonly require?: { readonly types: string; readonly default: string };
  readonly default?: { readonly types: string; readonly default: string };
}
const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  main: string;
  exports: Record<string, Conditions | string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { readonly optional?: boolean }>;
};
const DIRECTIVE: Record<string, string> = Object.fromEntries(
  Object.entries(DIRECTIVE_ENTRIES).map(([name, entry]) => [name, entry.source]),
);
const IMPORTABLE: Record<string, string> = { ...LIBRARY_ENTRIES, ...DIRECTIVE };

function entryName(distPath: string): string {
  return distPath.replace(/^\.\/dist\//u, '').replace(/\.(?:js|d\.ts)$/u, '');
}

describe('package entries', () => {
  const scriptExports = Object.entries(manifest.exports).filter(
    (pair): pair is [string, Conditions] => typeof pair[1] !== 'string',
  );

  it('every subpath with a script build resolves to a build entry, as ESM alone', () => {
    for (const [subpath, conditions] of scriptExports) {
      const esm = conditions.import;
      expect(esm, `${subpath} has no import condition`).toBeDefined();
      if (esm === undefined) continue;
      const name = entryName(esm.default);
      expect(IMPORTABLE[name], `${subpath} → ${esm.default}`).toBeDefined();
      expect(entryName(esm.types)).toBe(name);
      expect(conditions.require, `${subpath} names a CommonJS build`).toBeUndefined();
    }
    expect(manifest.main).toBe('./dist/index.js');
  });

  it('keeps the entries that had a CommonJS build until 3.0 loadable through require(esm)', () => {
    // `require()` matches `default`, not `import`. Without it, a CommonJS file that required
    // one of these in 2.x finds no export in 3.0; with it, every supported Node loads the ES
    // module. `./nextjs` has had it since a CommonJS-loaded next.config.ts needed it (H12).
    // The others need a bundler, a framework or a peer that a CommonJS file does not bring.
    const requirable = scriptExports
      .filter(([, conditions]) => conditions.default !== undefined)
      .map(([subpath]) => subpath)
      .sort();
    expect(requirable).toEqual([
      '.',
      './client',
      './codegen',
      './core',
      './fragment',
      './lexical',
      './nextjs',
      './plugin',
      './plugins',
      './server',
      './structural',
    ]);
    for (const [subpath, conditions] of scriptExports) {
      if (conditions.default === undefined) continue;
      expect(conditions.default, subpath).toEqual(conditions.import);
    }
  });

  it('every build entry that is not a binary is reachable through the manifest', () => {
    const reachable = new Set(
      scriptExports.flatMap(([, conditions]) =>
        conditions.import === undefined ? [] : [entryName(conditions.import.default)],
      ),
    );
    for (const name of Object.keys(IMPORTABLE)) {
      expect(reachable.has(name), `dist/${name} has no exports subpath`).toBe(true);
    }
    for (const name of Object.keys(CLI_ENTRIES)) {
      expect(reachable.has(name), `dist/${name} is a binary and has a subpath`).toBe(false);
    }
  });

  it('an entry with a module directive is listed apart, so the build writes the directive into that file alone', () => {
    for (const [name, entry] of Object.entries(DIRECTIVE_ENTRIES)) {
      expect(entry.directive, name).toMatch(/^'use [a-z]+';$/u);
      expect(LIBRARY_ENTRIES).not.toHaveProperty(name);
    }
  });

  it('declares no `next` peer, although `./nextjs/client` imports `next/navigation`', () => {
    // pnpm links an optional peer into every project of a workspace once one project
    // installs it: with 2.4.0's `next: '*'`, `pnpm deploy --prod` of a project with React
    // and this package but no Next.js came to 339 MB instead of 23 MB (pnpm 12.15.0,
    // 2026-11-04). Next.js resolves `next` for every module it bundles to the app's own
    // installation, so the import needs no peer; tests/e2e/continuation/next-pnpm-workspace.spec.ts
    // builds it where Node finds another copy of `next` from this package.
    expect(manifest.peerDependencies).not.toHaveProperty('next');
    expect(manifest.peerDependenciesMeta).not.toHaveProperty('next');
  });
});
