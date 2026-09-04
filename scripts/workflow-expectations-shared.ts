/** Step, job and matrix fragments shared by the reviewed workflow contracts. */

import type { JobSpec, StepSpec } from './workflow-contracts';

export const CHECKOUT: StepSpec = { uses: 'actions/checkout' };
export const SETUP_NODE: StepSpec = { uses: 'actions/setup-node' };
export const PINNED_NODE: StepSpec = {
  uses: 'actions/setup-node',
  with: { 'node-version': '22.23.2' },
};
export const NPM_VERSION: StepSpec = {
  run: 'npm install --global "$(node -p "require(\'./package.json\').packageManager")"',
};
/**
 * The Node matrix asks whether the package works on each Node it claims, so it
 * takes the pinned npm only where that npm runs. Reproducible packaging is
 * enforced on the pinned Node, not here.
 */
export const NPM_VERSION_WHERE_SUPPORTED: StepSpec = {
  name: 'Use the repository npm version where this Node supports it',
  run: 'node scripts/use-repository-npm.mjs',
};
export const NPM_CI: StepSpec = { run: 'npm ci' };
export const BUILD_RUNTIME: StepSpec = { run: 'npm run build:runtime' };
export const DOWNLOAD_DIST: StepSpec = {
  uses: 'actions/download-artifact',
  with: { name: 'dist-${{ github.sha }}', path: 'dist' },
};
export const FIXTURE_CACHE: StepSpec = {
  uses: 'actions/setup-node',
  with: { 'cache-dependency-path': 'package-lock.json\nexamples/*/package-lock.json' },
};
export const SETUP = [CHECKOUT, SETUP_NODE, NPM_VERSION, NPM_CI] as const;
export const MATRIX_SETUP = [CHECKOUT, SETUP_NODE, NPM_VERSION_WHERE_SUPPORTED, NPM_CI] as const;
export const PINNED_SETUP = [CHECKOUT, PINNED_NODE, NPM_VERSION, NPM_CI] as const;
export const FIXTURE_SETUP = [CHECKOUT, FIXTURE_CACHE, NPM_VERSION, NPM_CI] as const;
export const READ_ONLY = { contents: 'read' } as const;
export const MAIN_PUSH = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
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
  run: `npm ci --no-audit --no-fund --prefix examples/${fixture}`,
});
export const fixtureAudit = (fixture: string): StepSpec => ({
  run: `npm audit --audit-level=high --package-lock-only --prefix examples/${fixture}`,
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
export const callCriticalGates = (soakDuration: string, condition?: string): JobSpec => ({
  ...(condition === undefined ? {} : { if: condition }),
  needs: ['build'],
  uses: './.github/workflows/critical-gates.yml',
  permissions: READ_ONLY,
  with: { 'dist-artifact': 'dist-${{ github.sha }}', 'soak-duration-ms': soakDuration },
});
