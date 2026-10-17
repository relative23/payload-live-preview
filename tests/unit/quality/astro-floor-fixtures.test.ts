/**
 * The two Astro floor consumers are reviewed locks, not resolutions made at run time.
 * These checks keep each manifest, lock and install policy exact, tie the base floor to
 * the peer range it claims to cover, and keep a control build from becoming the default.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { peerFloor } from '../../../scripts/compat-evidence';
import { findMaintainerInstallPolicyViolations } from '../../../scripts/release-contracts';
import { ASTRO_FLOOR_PORT, ASTRO_FLOOR_VERSION } from '../../e2e/helpers/astro-floor-base';

const read = (path: string): string => readFileSync(path, 'utf8');
const template = (path: string): string => read(`tests/fixtures/astro-floor-base/${path}.fixture`);

interface Manifest {
  name: string;
  private: boolean;
  packageManager: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  allowScripts: Record<string, boolean>;
  overrides?: unknown;
}
interface Lock {
  name: string;
  lockfileVersion: number;
  packages: Record<string, { version?: string; resolved?: string; integrity?: string }>;
}

const NPMRC =
  'strict-allow-scripts=true\nignore-scripts=false\ndangerously-allow-all-scripts=false\nlegacy-peer-deps=false\ninstall-links=true\n';

const consumers = [
  {
    label: 'Astro 4.0.0 base floor',
    directory: 'tests/fixtures/astro-floor-base-deps',
    direct: {
      astro: '4.0.0',
      vite: '5.4.21',
      '@astrojs/check': '0.9.10',
      typescript: '5.9.3',
      '@types/node': '22.20.1',
    },
    // sharp 0.32.6 would download libvips; the static page renders no image, so its hook stays off.
    allowScripts: {
      'esbuild@0.19.12': true,
      'esbuild@0.21.5': true,
      'sharp@0.32.6': false,
      'fsevents@2.3.3': false,
    },
  },
  {
    label: 'Astro 4.16.19 React islands',
    directory: 'tests/fixtures/astro-react-versions/4.16.19',
    direct: {
      astro: '4.16.19',
      '@astrojs/node': '8.3.4',
      '@astrojs/react': '3.6.3',
      vite: '5.4.21',
      react: '18.3.1',
      'react-dom': '18.3.1',
      '@astrojs/check': '0.9.10',
      typescript: '5.9.3',
      '@types/node': '22.20.1',
      '@types/react': '18.3.12',
      '@types/react-dom': '18.3.1',
    },
    allowScripts: { 'esbuild@0.21.5': true, 'sharp@0.33.5': true, 'fsevents@2.3.3': false },
  },
] as const;

describe.each(consumers)('$label consumer', ({ label, directory, direct, allowScripts }) => {
  const manifest = JSON.parse(read(`${directory}/package.json`)) as Manifest;
  const lock = JSON.parse(read(`${directory}/package-lock.json`)) as Lock;

  it('pins every direct dependency exactly, in the manifest and in the lock', () => {
    expect({ ...manifest.dependencies, ...manifest.devDependencies }).toEqual(direct);
    for (const [name, version] of Object.entries(direct)) {
      expect(lock.packages[`node_modules/${name}`]?.version).toBe(version);
    }
    expect(manifest.private).toBe(true);
    expect(manifest.overrides).toBeUndefined();
    expect(manifest.scripts['build']).toBe('npm run typecheck && astro build');
    expect(manifest.scripts['typecheck']).toBe(
      'astro sync && astro-check --minimumFailingSeverity warning',
    );
  });

  it('is a v3 lock of the same package whose records all come from the registry', () => {
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.name).toBe(manifest.name);
    expect(lock.packages['']).toMatchObject({ name: manifest.name });
    for (const [path, record] of Object.entries(lock.packages)) {
      if (path === '') continue;
      expect(record.resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//u);
      expect(record.integrity, path).toMatch(/^sha512-/u);
    }
  });

  it('gives every install script a reviewed verdict and keeps the strict npm policy', () => {
    const profile = {
      label,
      directory,
      npmrc: NPMRC,
      packageManager: 'npm@12.0.2',
      allowScripts,
    };
    expect(
      findMaintainerInstallPolicyViolations(
        { label, npmrc: read(`${directory}/.npmrc`), manifest, lockfile: lock },
        profile,
      ),
    ).toEqual([]);
  });

  it('leaves the workspace package out: the archive under test is added at run time', () => {
    expect(manifest.dependencies).not.toHaveProperty('payload-live-preview');
    expect(lock.packages).not.toHaveProperty('node_modules/payload-live-preview');
  });
});

describe('Astro 4.0.0 base floor fixture', () => {
  it('sits on the lower bound of the peer range the package declares', () => {
    const peers = (JSON.parse(read('package.json')) as { peerDependencies: Record<string, string> })
      .peerDependencies;
    expect(peerFloor(peers['astro']!)).toBe(ASTRO_FLOOR_VERSION);
    const manifest = JSON.parse(
      read('tests/fixtures/astro-floor-base-deps/package.json'),
    ) as Manifest;
    expect(manifest.dependencies['astro']).toBe(ASTRO_FLOOR_VERSION);
  });

  it('builds the shipped components through the public export and refuses unreviewed switches', () => {
    const config = template('astro.config.mjs');
    expect(config).toContain("from 'payload-live-preview/astro'");
    expect(config).toContain("process.env.PLP_ASTRO_FLOOR_CONTROL ?? 'none'");
    expect(config).toContain("process.env.PLP_ASTRO_FLOOR_DELIVERY ?? 'loader'");
    expect(config).toContain("['inline', 'loader'].includes(mode)");
    expect(config).toContain("['none', 'no-integration', 'wrong-origin'].includes(control)");
    expect(config).toContain("output: 'static'");
    // Only the allow-list may admit the mock parent, or the wrong-origin control proves nothing.
    expect(config).toContain('disableLocalhostMatching: true');
    expect(config).toContain("['https://refused.example.invalid']");
    const page = template('src/pages/index.astro');
    expect(page).toContain("from 'payload-live-preview/astro/RichText.astro'");
    expect(page).toContain("from 'payload-live-preview/astro/PreviewBoundary.astro'");
    expect(template('public/admin.html')).toContain('src="/?preview=true"');
  });

  it('keeps the counterexample out of the type-checked project', () => {
    expect(template('type-contracts/Negative.astro')).toContain('title.toFixed(2)');
    const tsconfig = JSON.parse(template('tsconfig.json')) as { exclude: string[] };
    expect(tsconfig.exclude).toContain('type-contracts');
  });

  it('serves one loopback port that the Playwright scope also names', () => {
    expect(read('playwright.astro-floor-base.config.ts')).toContain(
      `baseURL: 'http://localhost:${String(ASTRO_FLOOR_PORT)}'`,
    );
    expect(read('playwright.astro-floor-base.config.ts')).toContain(
      "from './playwright.next-continuation.config'",
    );
  });
});

describe('Astro 4.16.19 island lane', () => {
  it('names the React renderer and the build-hash CSP as part of the scope', () => {
    const config = read('playwright.astro-islands.config.ts');
    expect(config).toContain("process.env['PLP_ASTRO_RESOURCE_RENDERER'] ??= 'react-islands'");
    expect(config).toContain("process.env['PLP_ASTRO_ISLAND_CSP'] ??= 'build-hashes'");
    expect(config).toContain("testMatch: 'astro-islands.spec.ts'");
  });
});
