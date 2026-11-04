/**
 * The pnpm workspace behind the `next-pnpm-workspace` job is a reviewed lock, not a resolution made
 * at run time. These checks keep its premise without running pnpm: nothing is hoisted, the root's
 * `next` is a copy no site uses, the lock pins exactly what the manifests name, and pnpm itself
 * comes with its Linux binary from a lock of its own.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';
import config from '../../../playwright.next-pnpm-workspace.config';
import { NEXT_PNPM_WORKSPACE_PORT } from '../../e2e/helpers/next-pnpm-workspace';

const ROOT = 'tests/fixtures/next-pnpm-workspace';
const read = (path: string): string => readFileSync(path, 'utf8');
const manifest = (path: string): { dependencies: Record<string, string> } =>
  JSON.parse(read(path)) as { dependencies: Record<string, string> };

interface Lock {
  importers: Record<
    string,
    { dependencies: Record<string, { specifier: string; version: string }> }
  >;
}
const lock = (parseAllDocuments(read(`${ROOT}/pnpm-lock.yaml`)) as { toJS(): unknown }[])
  .at(-1)!
  .toJS() as Lock;
const SITES = ['next-15', 'next-16'] as const;

describe('the next-pnpm-workspace fixture', () => {
  it('hoists nothing, so Node finds only the root project from the package', () => {
    expect(parse(read(`${ROOT}/pnpm-workspace.yaml`))).toEqual({
      packages: [...SITES],
      hoistPattern: [],
    });
  });

  it('locks exactly what each manifest names', () => {
    const importers = {
      '.': `${ROOT}/package.json`,
      ...Object.fromEntries(SITES.map((site) => [site, `${ROOT}/${site}/package.json`])),
    };
    expect(Object.keys(lock.importers).sort()).toEqual(Object.keys(importers).sort());
    for (const [importer, path] of Object.entries(importers)) {
      const specifiers = Object.fromEntries(
        Object.entries(lock.importers[importer]!.dependencies).map(([name, entry]) => [
          name,
          entry.specifier,
        ]),
      );
      expect(specifiers, importer).toEqual(manifest(path).dependencies);
    }
  });

  it('gives the root a copy of next that no site installs', () => {
    const root = lock.importers['.']!.dependencies;
    for (const site of SITES) {
      const own = lock.importers[site]!.dependencies;
      expect(own['payload-live-preview']?.specifier, site).toBe('file:../payload-live-preview.tgz');
      expect(own['next']?.version, site).not.toBe(root['next']?.version);
      expect(own['react']?.version, site).not.toBe(root['react']?.version);
    }
    expect(root).not.toHaveProperty('payload-live-preview');
  });

  it('installs pnpm with its Linux binary from a lock of its own', () => {
    const tool = JSON.parse(read('tests/fixtures/next-pnpm-workspace-tool/package-lock.json')) as {
      packages: Record<
        string,
        { version?: string; integrity?: string; os?: string[]; cpu?: string[]; libc?: string[] }
      >;
    };
    const pnpm = tool.packages['node_modules/pnpm'];
    expect(pnpm?.version).toBe('12.15.0');
    expect(pnpm?.integrity).toMatch(/^sha512-/u);
    expect(tool.packages['node_modules/@pnpm/exe.linux-x64']).toMatchObject({
      version: '12.15.0',
      os: ['linux'],
      cpu: ['x64'],
      libc: ['glibc'],
    });
  });

  it('serves on the port the config names', () => {
    expect(config.use?.baseURL).toBe(`http://localhost:${String(NEXT_PNPM_WORKSPACE_PORT)}`);
  });
});
