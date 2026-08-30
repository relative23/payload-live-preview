import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findForbiddenPackageLifecycleScripts,
  findExactPublisherManifestViolations,
  findMaintainerInstallPolicyViolations,
  findMutationPolicyManifestViolations,
  findPackageSmokeIsolationViolations,
  MAINTAINER_INSTALL_POLICIES,
  PACKAGE_SMOKE_INSTALL_ARGS,
  PACKAGE_SMOKE_NPMRC,
  PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS,
  sanitizeNpmScriptEnvironment,
} from '../../scripts/release-contracts';

const ROOT = resolve(import.meta.dirname, '../..');
const MAINTAINER_INSTALL_POLICY_INDEXES = [0, 1, 2, 3, 4, 5] as const;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readInstallPolicyInput(profile: (typeof MAINTAINER_INSTALL_POLICIES)[number]): {
  readonly label: string;
  readonly npmrc: string;
  readonly manifest: unknown;
  readonly lockfile: unknown;
} {
  const directory = resolve(ROOT, profile.directory);
  return {
    label: profile.label,
    npmrc: readFileSync(resolve(directory, '.npmrc'), 'utf8'),
    manifest: readJson(resolve(directory, 'package.json')),
    lockfile: readJson(resolve(directory, 'package-lock.json')),
  };
}

describe('published package lifecycle contract', () => {
  it.each(['preinstall', 'install', 'postinstall', 'prepack', 'prepare', 'postpack'])(
    'rejects a packed %s hook even when its command is empty',
    (name) => {
      expect(findForbiddenPackageLifecycleScripts({ scripts: { [name]: '' } })).toEqual([
        `scripts.${name}`,
      ]);
    },
  );

  it('fails closed for malformed package and scripts objects', () => {
    expect(findForbiddenPackageLifecycleScripts(null)).toEqual(['package.json']);
    expect(findForbiddenPackageLifecycleScripts({ scripts: [] })).toEqual(['scripts']);
    expect(findForbiddenPackageLifecycleScripts({ scripts: 'npm run build' })).toEqual(['scripts']);
  });

  it('allows maintainer-only lifecycle commands that npm does not run on consumer install', () => {
    expect(
      findForbiddenPackageLifecycleScripts({
        scripts: {
          build: 'npm run build:runtime',
          prepublishOnly: 'npm run check && npm run build && npm run test:package',
        },
      }),
    ).toEqual([]);
  });

  it('keeps the repository manifest safe to publish', () => {
    const manifest: unknown = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    expect(findForbiddenPackageLifecycleScripts(manifest)).toEqual([]);
  });

  it('builds the ignored runtime explicitly before all publish verification', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = manifest.scripts ?? {};

    expect(scripts['build']).toMatch(/^npm run build:runtime\b/);
    expect(scripts['prepublishOnly']).toBe(
      'npm run build && npm run check && npm run format:check && npm run test:package',
    );
  });

  it('pins release to the exact-artifact publisher instead of Changesets directory repacking', () => {
    expect(
      findExactPublisherManifestViolations({ scripts: { release: 'changeset publish' } }),
    ).toEqual(['package.json release script does not invoke the exact-artifact publisher']);
    expect(
      findExactPublisherManifestViolations({
        scripts: { release: 'tsx scripts/publish-artifact.ts' },
      }),
    ).toEqual([]);
  });

  it('pins PR and release mutation reports to their exact policy inputs', () => {
    const manifest = readJson(resolve(ROOT, 'package.json'));
    expect(findMutationPolicyManifestViolations(manifest)).toEqual([]);

    const weakened = structuredClone(manifest) as { scripts: Record<string, string> };
    weakened.scripts['test:mutation:policy:pr'] = 'true';
    weakened.scripts['test:mutation:policy'] =
      'tsx scripts/mutation-policy.ts --policy quality/mutation-policy-pr.json';
    expect(findMutationPolicyManifestViolations(weakened)).toEqual([
      'package.json test:mutation:policy:pr script does not enforce its exact report policy',
      'package.json test:mutation:policy script does not enforce its exact report policy',
    ]);
  });
});

describe('packed-package consumer isolation contract', () => {
  it('pins strict script execution instead of masking lifecycle hooks', () => {
    expect(PACKAGE_SMOKE_NPMRC).toBe(
      'strict-allow-scripts=true\nignore-scripts=false\ndangerously-allow-all-scripts=false\n',
    );
  });

  it('keeps exact-tarball installs offline and peer-aware without script bypasses', () => {
    expect(PACKAGE_SMOKE_INSTALL_ARGS).toContain('--strict-allow-scripts=true');
    expect(PACKAGE_SMOKE_INSTALL_ARGS).toContain('--ignore-scripts=false');
    expect(PACKAGE_SMOKE_INSTALL_ARGS).toContain('--dangerously-allow-all-scripts=false');
    expect(PACKAGE_SMOKE_INSTALL_ARGS).toContain('--legacy-peer-deps=false');
    expect(PACKAGE_SMOKE_INSTALL_ARGS).toContain('--offline');
    expect(PACKAGE_SMOKE_INSTALL_ARGS).toContain('--omit=optional');
    expect(PACKAGE_SMOKE_INSTALL_ARGS).not.toContain('--ignore-scripts');
    expect(PACKAGE_SMOKE_INSTALL_ARGS).not.toContain('--legacy-peer-deps');
  });

  it('provisions the exact reviewed codegen peer before the archive is installed offline', () => {
    expect(PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS).toContain('--strict-allow-scripts=true');
    expect(PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS).toContain('--ignore-scripts=false');
    expect(PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS).toContain('--dangerously-allow-all-scripts=false');
    expect(PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS).toContain('--legacy-peer-deps=false');
    expect(PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS).toContain('--package-lock=true');
    expect(PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS).not.toContain('--offline');
    expect(PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS).not.toContain('--ignore-scripts');
    expect(PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS).not.toContain('--legacy-peer-deps');
  });

  it('removes inherited npm script-policy overrides case-insensitively', () => {
    expect(
      sanitizeNpmScriptEnvironment({
        PATH: '/bin',
        npm_config_ignore_scripts: 'true',
        NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_SCRIPTS: 'true',
        NpM_CoNfIg_AlLoW_ScRiPtS: '*',
      }),
    ).toEqual({ PATH: '/bin' });
  });

  it('rejects consumers nested below the maintainer repository', () => {
    expect(
      findPackageSmokeIsolationViolations(ROOT, resolve(ROOT, '.package-smoke-current')),
    ).toEqual(['package smoke root is nested inside the maintainer repository']);
  });

  it('accepts an OS-temporary consumer outside the maintainer repository', () => {
    expect(
      findPackageSmokeIsolationViolations(
        ROOT,
        resolve(tmpdir(), 'payload-live-preview-package-smoke-contract'),
      ),
    ).toEqual([]);
  });

  it('does not confuse a sibling with a common path prefix for a nested consumer', () => {
    expect(findPackageSmokeIsolationViolations(ROOT, `${ROOT}-isolated-consumer`)).toEqual([]);
  });
});

describe('maintainer install-script policy contract', () => {
  it('keeps the statically inventoried policy cases exhaustive', () => {
    expect(MAINTAINER_INSTALL_POLICY_INDEXES).toEqual(
      MAINTAINER_INSTALL_POLICIES.map((_, index) => index),
    );
  });

  it.each(MAINTAINER_INSTALL_POLICY_INDEXES)(
    'keeps maintainer policy case %i pinned to the reviewed npm and lockfile policy',
    (index) => {
      const profile = MAINTAINER_INSTALL_POLICIES[index];
      expect(
        findMaintainerInstallPolicyViolations(readInstallPolicyInput(profile), profile),
      ).toEqual([]);
    },
  );

  it('rejects removal of strict-allow-scripts from a fixture npmrc', () => {
    const profile = MAINTAINER_INSTALL_POLICIES[1];
    const input = readInstallPolicyInput(profile);
    const npmrc = input.npmrc.replace('strict-allow-scripts=true\n', '');

    expect(findMaintainerInstallPolicyViolations({ ...input, npmrc }, profile)).toContain(
      `${profile.label}: .npmrc does not match the reviewed policy`,
    );
  });

  it('rejects package-manager drift', () => {
    const profile = MAINTAINER_INSTALL_POLICIES[0];
    const input = readInstallPolicyInput(profile);
    const manifest = {
      ...(input.manifest as Record<string, unknown>),
      packageManager: 'npm@latest',
    };

    expect(findMaintainerInstallPolicyViolations({ ...input, manifest }, profile)).toContain(
      `${profile.label}: packageManager must be npm@12.0.2`,
    );
  });

  it('rejects an install-script package without an explicit verdict', () => {
    const profile = MAINTAINER_INSTALL_POLICIES[0];
    const input = readInstallPolicyInput(profile);
    const lockfile = structuredClone(input.lockfile) as {
      packages: Record<string, Record<string, unknown>>;
    };
    lockfile.packages['node_modules/unreviewed-installer'] = {
      name: 'unreviewed-installer',
      version: '1.2.3',
      hasInstallScript: true,
    };

    expect(findMaintainerInstallPolicyViolations({ ...input, lockfile }, profile)).toContain(
      `${profile.label}: lockfile install script has no reviewed verdict: unreviewed-installer@1.2.3`,
    );
  });

  it('rejects stale and incorrectly-valued allowScripts verdicts', () => {
    const profile = MAINTAINER_INSTALL_POLICIES[0];
    const input = readInstallPolicyInput(profile);
    const sourceManifest = input.manifest as Record<string, unknown>;
    const sourceAllowScripts = sourceManifest['allowScripts'] as Record<string, boolean>;
    const manifest = {
      ...sourceManifest,
      allowScripts: {
        ...sourceAllowScripts,
        'esbuild@0.28.2': false,
        'stale-installer@9.9.9': true,
      },
    };
    const violations = findMaintainerInstallPolicyViolations({ ...input, manifest }, profile);

    expect(violations).toContain(
      `${profile.label}: allowScripts verdict for esbuild@0.28.2 must be true`,
    );
    expect(violations).toContain(
      `${profile.label}: unreviewed allowScripts verdict: stale-installer@9.9.9`,
    );
  });
});
