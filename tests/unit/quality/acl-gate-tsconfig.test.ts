/**
 * The ACL gate asks an isolated consumer where `payload-live-preview/server` lives and refuses an answer
 * outside it. tsx maps the repository tsconfig's `paths` onto every resolution in its process, so the two
 * entries that name the package (the type-check's, 682a9c1) turned the gate red in all three modes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveGateTsconfig } from '../../../scripts/acl-gate-tsconfig';

const ROOT = resolve(import.meta.dirname, '../../..');
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

const rootConfig = `{
  // comments and trailing commas are part of the repository's file
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@core/*": ["src/core/*"],
      "payload-live-preview/nextjs": ["src/adapters/nextjs/index.ts"],
      "payload-live-preview/server": ["src/server/index.ts"],
    },
  },
}`;

describe('ACL gate tsx configuration', () => {
  it('keeps the repository aliases and drops every entry that names the package', () => {
    const derived = deriveGateTsconfig(rootConfig, '/work/repository');
    expect(derived.compilerOptions.paths).toEqual({ '@core/*': ['src/core/*'] });
  });

  it('extends the repository configuration and anchors its aliases at the repository', () => {
    const derived = deriveGateTsconfig(rootConfig, '/work/repository');
    expect(derived.extends).toBe('/work/repository/tsconfig.json');
    expect(derived.compilerOptions.baseUrl).toBe('/work/repository');
  });

  it('refuses a configuration it cannot read instead of running the gate without aliases', () => {
    expect(() => deriveGateTsconfig('{ "compilerOptions": ', '/work/repository')).toThrow(
      'tsconfig.json',
    );
    expect(() => deriveGateTsconfig('{ "compilerOptions": {} }', '/work/repository')).toThrow(
      'compilerOptions.paths',
    );
  });

  it('removes today the entries the type-check maps, and the gate hands the result to tsx', () => {
    const derived = deriveGateTsconfig(read('tsconfig.json'), ROOT);
    expect(
      Object.keys(derived.compilerOptions.paths).filter((k) => k.startsWith('payload-live')),
    ).toEqual([]);
    expect(Object.keys(derived.compilerOptions.paths)).toContain('@security/*');
    const gate = read('scripts/check-payload-acl.ts');
    expect(gate).toContain('deriveGateTsconfig(');
    expect(gate).toContain('TSX_TSCONFIG_PATH');
  });
});

describe('Astro page-owned scope', () => {
  it('names the build-hash island policy itself, as the islands scope does', () => {
    const owner = read('playwright.astro-owner.config.ts');
    const islands = read('playwright.astro-islands.config.ts');
    expect(islands).toContain("process.env['PLP_ASTRO_ISLAND_CSP'] ??= 'build-hashes';");
    expect(owner).toContain("process.env['PLP_ASTRO_ISLAND_CSP'] ??= 'build-hashes';");
  });
});
