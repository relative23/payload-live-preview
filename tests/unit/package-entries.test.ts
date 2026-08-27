import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CORE_ENTRY,
  DUAL_FORMAT_ENTRIES,
  ESM_ONLY_ENTRIES,
  STANDALONE_ENTRIES,
} from '../../scripts/package-entries';

/**
 * Package topology (roadmap 1.4.0): the `exports` map, the build entries and
 * the focused entry modules agree with each other. A subpath in the manifest
 * without a build entry ships a dangling path; a build entry without a
 * subpath ships an unreachable file.
 */

interface Conditions {
  readonly import?: { readonly types: string; readonly default: string };
  readonly require?: { readonly types: string; readonly default: string };
}
const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
  exports: Record<string, Conditions | string>;
};
const DUAL: Record<string, string> = {
  ...DUAL_FORMAT_ENTRIES,
  ...STANDALONE_ENTRIES,
  ...CORE_ENTRY,
};
const ALL: Record<string, string> = { ...DUAL, ...ESM_ONLY_ENTRIES };

function entryName(distPath: string): string {
  return distPath.replace(/^\.\/dist\//u, '').replace(/\.(?:js|cjs|d\.ts|d\.cts)$/u, '');
}

describe('package entries', () => {
  const scriptExports = Object.entries(manifest.exports).filter(
    (pair): pair is [string, Conditions] => typeof pair[1] !== 'string',
  );

  it('every subpath with a script build resolves to a tsup entry, and dual formats only where the entry is dual', () => {
    for (const [subpath, conditions] of scriptExports) {
      const esm = conditions.import;
      if (esm === undefined) continue;
      const name = entryName(esm.default);
      expect(ALL[name], `${subpath} → ${esm.default}`).toBeDefined();
      expect(entryName(esm.types)).toBe(name);
      if (conditions.require !== undefined) {
        expect(
          DUAL[name],
          `${subpath} has a require condition; its entry must be dual-format`,
        ).toBeDefined();
        expect(entryName(conditions.require.default)).toBe(name);
        expect(entryName(conditions.require.types)).toBe(name);
      } else {
        expect(DUAL[name], `${subpath} is ESM-only in the manifest but built dual`).toBeUndefined();
      }
    }
  });

  it('every tsup entry that is not a CLI is reachable through the manifest', () => {
    const reachable = new Set(
      scriptExports.flatMap(([, conditions]) =>
        conditions.import === undefined ? [] : [entryName(conditions.import.default)],
      ),
    );
    for (const name of Object.keys(ALL)) {
      if (name.endsWith('-cli')) continue;
      expect(reachable.has(name), `dist/${name} has no exports subpath`).toBe(true);
    }
  });

  it('the focused entries are exactly the five documented ones', () => {
    expect(Object.keys(STANDALONE_ENTRIES).sort()).toEqual([
      'client',
      'fragment',
      'lexical',
      'plugins',
      'server',
      'structural',
    ]);
  });
});
