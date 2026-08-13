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
  findReleaseWorkflowViolations,
  MAINTAINER_INSTALL_POLICIES,
  PACKAGE_SMOKE_INSTALL_ARGS,
  PACKAGE_SMOKE_NPMRC,
  sanitizeNpmScriptEnvironment,
} from '../../scripts/release-contracts';

const ROOT = resolve(import.meta.dirname, '../..');
const CI_WORKFLOW = resolve(ROOT, '.github/workflows/ci.yml');
const RELEASE_WORKFLOW = resolve(ROOT, '.github/workflows/release.yml');
const MAINTAINER_INSTALL_POLICY_INDEXES = [0, 1, 2, 3, 4] as const;

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

function replaceInWorkflowJob(
  workflow: string,
  job: string,
  original: string,
  replacement: string,
): string {
  const start = workflow.indexOf(`  ${job}:\n`);
  if (start < 0) throw new Error(`missing ${job} job in test fixture`);
  const followingJob = workflow.slice(start + 1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  const end = followingJob < 0 ? workflow.length : start + 1 + followingJob;
  const block = workflow.slice(start, end);
  const mutated = block.replace(original, replacement);
  if (mutated === block) throw new Error(`missing mutation target in ${job} job`);
  return `${workflow.slice(0, start)}${mutated}${workflow.slice(end)}`;
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
      `${profile.label}: packageManager must be npm@11.16.0`,
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

describe('release workflow exact-commit contract', () => {
  const ciWorkflow = readFileSync(CI_WORKFLOW, 'utf8');

  it('rejects a gate that omits the workflow_run head/default-SHA equality', () => {
    const workflow = `jobs:
  gate:
    if: github.event.workflow_run.conclusion == 'success'
  version:
    needs: gate
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.workflow_run.head_sha }}
      - env:
          TESTED_SHA: \${{ github.event.workflow_run.head_sha }}
  publish:
    needs: gate
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.workflow_run.head_sha }}
      - env:
          TESTED_SHA: \${{ github.event.workflow_run.head_sha }}
`;

    expect(findReleaseWorkflowViolations(workflow, ciWorkflow)).toContain(
      'gate does not require exact tested commit',
    );
  });

  it('does not accept an exact-commit expression that exists only in a YAML comment', () => {
    const workflow = readFileSync(RELEASE_WORKFLOW, 'utf8').replace(
      '      github.event.workflow_run.head_sha == github.sha',
      '      true # github.event.workflow_run.head_sha == github.sha',
    );

    expect(findReleaseWorkflowViolations(workflow, ciWorkflow)).toContain(
      'gate does not require exact tested commit',
    );
  });

  it('rejects fuzzy README matching that can hide a legitimate changeset', () => {
    const workflow = readFileSync(RELEASE_WORKFLOW, 'utf8').replace(
      'if [ -f "$changeset" ] && [ "$changeset" != ".changeset/README.md" ]; then',
      "if ls .changeset/*.md 2>/dev/null | grep -qvi 'readme'; then",
    );

    expect(findReleaseWorkflowViolations(workflow, ciWorkflow)).toContain(
      'gate does not exclude only the Changesets README',
    );
  });

  it.each([
    {
      label: 'version job gate dependency',
      job: 'version',
      original: '    needs: gate',
      replacement: '    needs: build',
      violation: 'version job does not depend on gate',
    },
    {
      label: 'publish job exact-SHA condition',
      job: 'publish',
      original: '      github.event.workflow_run.head_sha == github.sha',
      replacement: '      true',
      violation: 'publish job does not require the exact tested commit',
    },
    {
      label: 'gate job tested checkout ref',
      job: 'gate',
      original: '          ref: ${{ github.event.workflow_run.head_sha }}',
      replacement: '          ref: main',
      violation: 'gate job does not check out the tested commit',
    },
    {
      label: 'version job checkout comparison',
      job: 'version',
      original: '        run: test "$(git rev-parse HEAD)" = "$TESTED_SHA"',
      replacement: "        run: 'true'",
      violation: 'version job does not compare its checkout with the tested commit',
    },
  ])('rejects a missing $label', ({ job, original, replacement, violation }) => {
    const workflow = replaceInWorkflowJob(
      readFileSync(RELEASE_WORKFLOW, 'utf8'),
      job,
      original,
      replacement,
    );

    expect(findReleaseWorkflowViolations(workflow, ciWorkflow)).toContain(violation);
  });

  it('rejects a release trigger bound to a workflow other than CI', () => {
    const workflow = readFileSync(RELEASE_WORKFLOW, 'utf8').replace(
      '    workflows: [CI]',
      '    workflows: [Docs]',
    );

    expect(findReleaseWorkflowViolations(workflow, ciWorkflow)).toContain(
      'release is not triggered by completed CI workflows',
    );
  });

  it('rejects cancellable release and main-branch CI verdicts', () => {
    const release = readFileSync(RELEASE_WORKFLOW, 'utf8').replace(
      '  cancel-in-progress: false',
      '  cancel-in-progress: true',
    );
    const cancellableCi = ciWorkflow.replace(
      "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
      '  cancel-in-progress: true',
    );

    expect(findReleaseWorkflowViolations(release, ciWorkflow)).toContain(
      'release workflow can cancel an in-flight publish',
    );
    expect(
      findReleaseWorkflowViolations(readFileSync(RELEASE_WORKFLOW, 'utf8'), cancellableCi),
    ).toContain('CI main-branch verdict can be cancelled');
  });

  it('pins every required CI job, Node/browser matrix, and release command', () => {
    const release = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const withoutPackageGate = replaceInWorkflowJob(
      ciWorkflow,
      'build',
      '        run: npm run test:package -- --artifact-dir release-artifact --source-commit "$TESTED_SHA"',
      '      - run: npm run build',
    );
    const withoutRealPayload = ciWorkflow.replace('  real-payload-e2e:\n', '  fixture-e2e:\n');
    const reducedNodeMatrix = ciWorkflow.replace(
      '        node: [20, 22, 24, 26]',
      '        node: [22]',
    );
    const reducedBrowserMatrix = ciWorkflow.replace(
      '        browser: [chromium, firefox, webkit]',
      '        browser: [chromium]',
    );

    expect(findReleaseWorkflowViolations(release, withoutPackageGate)).toContain(
      'CI build job does not run npm run test:package',
    );
    expect(findReleaseWorkflowViolations(release, withoutRealPayload)).toContain(
      'CI is missing required job real-payload-e2e',
    );
    expect(findReleaseWorkflowViolations(release, reducedNodeMatrix)).toContain(
      'CI unit job does not cover Node 20, 22, 24, and 26',
    );
    expect(findReleaseWorkflowViolations(release, reducedBrowserMatrix)).toContain(
      'CI e2e job does not cover chromium, firefox, and webkit',
    );
  });

  it('requires CI to persist and upload the exact checked package archive and manifest', () => {
    const release = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const withoutPersistentArtifact = replaceInWorkflowJob(
      ciWorkflow,
      'build',
      'npm run test:package -- --artifact-dir release-artifact',
      'npm run test:package',
    );
    const withoutArtifactUpload = replaceInWorkflowJob(
      ciWorkflow,
      'build',
      '          name: release-candidate-${{ github.sha }}',
      '          name: dist',
    );
    const withFloatingArtifactNode = replaceInWorkflowJob(
      ciWorkflow,
      'build',
      '          node-version: 22.23.2',
      '          node-version: 22',
    );

    expect(findReleaseWorkflowViolations(release, withoutPersistentArtifact)).toContain(
      'CI build job does not persist the exact package artifact',
    );
    expect(findReleaseWorkflowViolations(release, withoutArtifactUpload)).toContain(
      'CI build job does not upload the exact package artifact',
    );
    expect(findReleaseWorkflowViolations(release, withFloatingArtifactNode)).toContain(
      'CI build job does not pin the release artifact Node version',
    );
  });

  it('requires release to download only the triggering CI run artifact and recheck it', () => {
    const release = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const withoutRunBinding = replaceInWorkflowJob(
      release,
      'publish',
      '          run-id: ${{ github.event.workflow_run.id }}',
      '          run-id: latest',
    );
    const withoutRecheck = replaceInWorkflowJob(
      release,
      'publish',
      'npm run test:package -- --tarball',
      'npm run test:package -- --artifact-dir',
    );
    const withFloatingVerifierNode = replaceInWorkflowJob(
      release,
      'publish',
      '          node-version: 22.23.2',
      '          node-version: 22',
    );

    expect(findReleaseWorkflowViolations(withoutRunBinding, ciWorkflow)).toContain(
      'publish job does not download the triggering CI run artifact',
    );
    expect(findReleaseWorkflowViolations(withoutRecheck, ciWorkflow)).toContain(
      'publish job does not recheck the downloaded tarball',
    );
    expect(findReleaseWorkflowViolations(withFloatingVerifierNode, ciWorkflow)).toContain(
      'publish job does not pin the release verifier Node version',
    );
  });

  it('rejects directory republishing in place of the exact verified tarball', () => {
    const release = replaceInWorkflowJob(
      readFileSync(RELEASE_WORKFLOW, 'utf8'),
      'publish',
      '          publish: npm run release',
      '          publish: changeset publish',
    );

    expect(findReleaseWorkflowViolations(release, ciWorkflow)).toContain(
      'publish job does not publish the exact verified tarball',
    );
  });

  it('pins Changesets tag push and GitHub Release reconciliation after registry proof', () => {
    const release = replaceInWorkflowJob(
      readFileSync(RELEASE_WORKFLOW, 'utf8'),
      'publish',
      '          createGithubReleases: true',
      '          createGithubReleases: false',
    );

    expect(findReleaseWorkflowViolations(release, ciWorkflow)).toContain(
      'publish job does not enable Changesets tag/GitHub Release reconciliation',
    );
  });

  it('keeps an already complete historical version a no-op on later main commits', () => {
    const release = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const withoutCompletedReleaseNoop = replaceInWorkflowJob(
      release,
      'gate',
      '            if [ "$released" = "true" ]; then',
      '            if [ "$tagged_sha" = "$TESTED_SHA" ]; then',
    );

    expect(findReleaseWorkflowViolations(withoutCompletedReleaseNoop, ciWorkflow)).toContain(
      'release reconciliation does not preserve completed historical releases as a no-op',
    );
  });

  it('makes every new deterministic quality gate part of the release verdict', () => {
    const release = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const withoutTestPolicy = replaceInWorkflowJob(
      ciWorkflow,
      'lint',
      '      - run: npm run test:policy',
      '      - run: npm run typecheck',
    );
    const withoutArchitecture = replaceInWorkflowJob(
      ciWorkflow,
      'lint',
      '      - run: npm run test:architecture',
      '      - run: npm run typecheck',
    );
    const withoutDiffCoverage = replaceInWorkflowJob(
      ciWorkflow,
      'coverage',
      '        run: npm run test:coverage:diff',
      '        run: npm run test:coverage',
    );
    const withoutMutation = ciWorkflow.replace('  mutation:\n', '  mutation-advisory:\n');

    expect(findReleaseWorkflowViolations(release, withoutTestPolicy)).toContain(
      'CI lint job does not run npm run test:policy',
    );
    expect(findReleaseWorkflowViolations(release, withoutArchitecture)).toContain(
      'CI lint job does not run npm run test:architecture',
    );
    expect(findReleaseWorkflowViolations(release, withoutDiffCoverage)).toContain(
      'CI coverage job does not run npm run test:coverage:diff',
    );
    expect(findReleaseWorkflowViolations(release, withoutMutation)).toContain(
      'CI is missing required job mutation',
    );
  });

  it('requires PR mutation results to pass the exact zero-error report policy', () => {
    const release = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const withoutPrPolicy = replaceInWorkflowJob(
      ciWorkflow,
      'mutation',
      '        run: npm run test:mutation:policy:pr',
      '        run: npm run test:mutation',
    );
    const onPush = replaceInWorkflowJob(
      ciWorkflow,
      'mutation',
      "    if: github.event_name == 'pull_request'",
      "    if: github.event_name == 'push'",
    );
    const permissivePrCondition = replaceInWorkflowJob(
      ciWorkflow,
      'mutation',
      "    if: github.event_name == 'pull_request'",
      "    if: github.event_name == 'pull_request' || always()",
    );

    expect(findReleaseWorkflowViolations(release, withoutPrPolicy)).toContain(
      'CI mutation job does not enforce the exact PR mutation policy',
    );
    expect(findReleaseWorkflowViolations(release, onPush)).toContain(
      'CI PR mutation job is not restricted to pull requests',
    );
    expect(findReleaseWorkflowViolations(release, permissivePrCondition)).toContain(
      'CI PR mutation job is not restricted to pull requests',
    );
  });

  it('binds complete mutation, leak and five-minute browser soaks to the release SHA', () => {
    const release = readFileSync(RELEASE_WORKFLOW, 'utf8');
    for (const job of ['critical-mutation', 'node-leak-soak', 'browser-soak'] as const) {
      const renamed = ciWorkflow.replace(`  ${job}:\n`, `  ${job}-advisory:\n`);
      expect(findReleaseWorkflowViolations(release, renamed)).toContain(
        `CI is missing required job ${job}`,
      );
    }

    const criticalOnPr = replaceInWorkflowJob(
      ciWorkflow,
      'critical-mutation',
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
      "    if: github.event_name == 'pull_request'",
    );
    const criticalOnAnyPush = replaceInWorkflowJob(
      ciWorkflow,
      'critical-mutation',
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
      "    if: github.event_name == 'push'",
    );
    const criticalWithOr = replaceInWorkflowJob(
      ciWorkflow,
      'critical-mutation',
      "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
      "    if: github.event_name == 'push' || github.ref == 'refs/heads/main'",
    );
    const withoutCriticalPolicy = replaceInWorkflowJob(
      ciWorkflow,
      'critical-mutation',
      '        run: npm run test:mutation:policy',
      '        run: npm run test:mutation',
    );
    const quickLeak = replaceInWorkflowJob(
      ciWorkflow,
      'node-leak-soak',
      '        run: npm run test:leak',
      '        run: npm run test:leak:quick',
    );
    const shortBrowserSoak = replaceInWorkflowJob(
      ciWorkflow,
      'browser-soak',
      '          PLP_SOAK_DURATION_MS: 300000',
      '          PLP_SOAK_DURATION_MS: 60000',
    );

    expect(findReleaseWorkflowViolations(release, criticalOnPr)).toContain(
      'CI critical-mutation job is not restricted to main-branch pushes',
    );
    expect(findReleaseWorkflowViolations(release, criticalOnAnyPush)).toContain(
      'CI critical-mutation job is not restricted to main-branch pushes',
    );
    expect(findReleaseWorkflowViolations(release, criticalWithOr)).toContain(
      'CI critical-mutation job is not restricted to main-branch pushes',
    );
    expect(findReleaseWorkflowViolations(release, withoutCriticalPolicy)).toContain(
      'CI critical-mutation job does not enforce the reviewed critical mutation policy',
    );
    expect(findReleaseWorkflowViolations(release, quickLeak)).toContain(
      'CI node-leak-soak job does not run the full 10,000-cycle leak gate',
    );
    expect(findReleaseWorkflowViolations(release, shortBrowserSoak)).toContain(
      'CI browser-soak job does not pin the five-minute duration',
    );
  });

  it('rejects floating action tags in the tested and release workflows', () => {
    const release = readFileSync(RELEASE_WORKFLOW, 'utf8');
    const floatingCi = ciWorkflow.replace(/actions\/checkout@[a-f0-9]{40}/u, 'actions/checkout@v4');
    const floatingRelease = release.replace(
      /changesets\/action@[a-f0-9]{40}/u,
      'changesets/action@v1',
    );

    expect(findReleaseWorkflowViolations(release, floatingCi)).toContain(
      'CI workflow uses a non-immutable action reference: actions/checkout@v4',
    );
    expect(findReleaseWorkflowViolations(floatingRelease, ciWorkflow)).toContain(
      'release workflow uses a non-immutable action reference: changesets/action@v1',
    );
  });

  it('rejects a registry lookup that does not fail closed', () => {
    const workflow = readFileSync(RELEASE_WORKFLOW, 'utf8').replace(
      '            exit "$registry_status"',
      '            published=',
    );

    expect(findReleaseWorkflowViolations(workflow, ciWorkflow)).toContain(
      'release registry lookup does not fail closed',
    );
  });

  it('keeps versioning and publishing bound to the exact CI-tested commit', () => {
    const workflow = readFileSync(RELEASE_WORKFLOW, 'utf8');
    expect(findReleaseWorkflowViolations(workflow, ciWorkflow)).toEqual([]);
  });
});
