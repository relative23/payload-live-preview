/** Step, job and matrix fragments shared by the reviewed workflow contracts. */

import type { JobSpec, StepSpec } from './workflow-contracts';

export const CHECKOUT: StepSpec = { uses: 'actions/checkout' };
export const SETUP_NODE: StepSpec = { uses: 'actions/setup-node' };
export const PINNED_NODE: StepSpec = {
  uses: 'actions/setup-node',
  with: { 'node-version': '24.22.3' },
};
export const NPM_VERSION: StepSpec = {
  run: 'npm install --global "$(node -p "require(\'./package.json\').packageManager")"',
};
export const NPM_CI: StepSpec = { run: 'npm ci' };
export const BUILD_RUNTIME: StepSpec = { run: 'npm run build:runtime' };
export const DOWNLOAD_DIST: StepSpec = {
  uses: 'actions/download-artifact',
  with: { name: 'dist-${{ github.sha }}', path: 'dist' },
};
/** Each real-admin job's list of the steps its tests started again, which `repeated-attempts` sums. */
export const attemptsUpload = (name: string): StepSpec => ({
  uses: 'actions/upload-artifact',
  condition: 'always()',
  with: { name: `repeated-attempts-${name}`, path: 'test-results/repeated-attempts.json' },
});
/** The exact archive the Build job stored, which the Release workflow later publishes. */
export const DOWNLOAD_ARCHIVE: StepSpec = {
  uses: 'actions/download-artifact',
  with: { name: 'release-candidate-${{ github.sha }}', path: 'release-artifact' },
};
export const FIXTURE_CACHE: StepSpec = {
  uses: 'actions/setup-node',
  with: { 'cache-dependency-path': 'package-lock.json\nexamples/*/package-lock.json' },
};
export const SETUP = [CHECKOUT, SETUP_NODE, NPM_VERSION, NPM_CI] as const;
export const MATRIX_SETUP = [CHECKOUT, SETUP_NODE, NPM_VERSION, NPM_CI] as const;
export const PINNED_SETUP = [CHECKOUT, PINNED_NODE, NPM_VERSION, NPM_CI] as const;
export const FIXTURE_SETUP = [CHECKOUT, FIXTURE_CACHE, NPM_VERSION, NPM_CI] as const;
export const READ_ONLY = { contents: 'read' } as const;
export const RELEASE_PUSH =
  "github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/release/2.x')";
export const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
export const CI_FIXTURES = [
  'astro-payload',
  'nextjs-payload',
  'sveltekit-payload',
  'nuxt-payload',
  'astro-hybrid',
  'pure-html',
  'vanilla-client',
  'astro-inline',
  'astro-middleware',
] as const;

export const fixtureInstall = (fixture: string): StepSpec => ({
  run: `bash scripts/ci-install-fixture.sh examples/${fixture}`,
});
/** A Chromium job that runs one Playwright config against the archive the Build job stored. */
export const archiveJob = (
  config: string,
  timeoutMinutes: number,
  matrix?: JobSpec['matrix'],
  env?: Readonly<Record<string, string>>,
): JobSpec => ({
  needs: ['build'],
  timeoutMinutes,
  ...(matrix === undefined ? {} : { matrix }),
  steps: [
    ...FIXTURE_SETUP,
    { run: 'bash scripts/ci-install-browser.sh chromium' },
    DOWNLOAD_ARCHIVE,
    {
      run: `PLP_CONTINUATION_TARBALL="$(ls "$PWD"/release-artifact/*.tgz)" npx playwright test --config ${config} --project=chromium`,
      ...(env === undefined ? {} : { env }),
    },
  ],
});
export const fixtureAudit = (fixture: string): StepSpec => ({
  run: `node scripts/audit-gate.ts --package-lock-only --prefix examples/${fixture}`,
});
export const testedCommit = (sha: string): StepSpec => ({
  run: 'test "$(git rev-parse HEAD)" = "$TESTED_SHA"',
  env: { TESTED_SHA: sha },
});
export const sourceDate = (sha: string, verifyHead: boolean): StepSpec => ({
  run: [
    ...(verifyHead ? ['test "$(git rev-parse HEAD)" = "$TESTED_SHA"'] : []),
    'epoch=$(git show -s --format=%ct "$TESTED_SHA")',
    'case "$epoch" in',
    '  \'\'|*[!0-9]*) echo "invalid commit timestamp"; exit 1 ;;',
    'esac',
    'echo "epoch=$epoch" >> "$GITHUB_OUTPUT"',
  ].join('\n'),
  env: { TESTED_SHA: sha },
  operators: true,
});
export const callBuild: JobSpec = { uses: './.github/workflows/build.yml', permissions: READ_ONLY };
/** `fullMutation` says when the six shards run: see `scripts/mutation-plan.ts`. */
export const callCriticalGates = (
  soakDuration: string,
  fullMutation: 'always' | 'unpublished-version',
  condition?: string,
): JobSpec => ({
  ...(condition === undefined ? {} : { if: condition }),
  needs: ['build'],
  uses: './.github/workflows/critical-gates.yml',
  permissions: READ_ONLY,
  with: {
    'dist-artifact': 'dist-${{ github.sha }}',
    'soak-duration-ms': soakDuration,
    'full-mutation': fullMutation,
  },
});
