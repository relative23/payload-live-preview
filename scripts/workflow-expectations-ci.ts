/** The reviewed shape of the per-push CI workflows and the release-critical gates. */

import type { WorkflowSpec } from './workflow-contracts';
import {
  BROWSERS,
  BUILD_RUNTIME,
  CHECKOUT,
  CI_FIXTURES,
  DOWNLOAD_DIST,
  FIXTURE_SETUP,
  MAIN_PUSH,
  NPM_CI,
  NPM_VERSION,
  MATRIX_SETUP,
  PINNED_SETUP,
  SETUP_NODE,
  READ_ONLY,
  SETUP,
  callBuild,
  callCriticalGates,
  fixtureAudit,
  fixtureInstall,
  sourceDate,
} from './workflow-expectations-shared';

export const CI: WorkflowSpec = {
  name: 'CI',
  on: { push: { branches: ['main'] }, pull_request: { branches: ['main'] } },
  permissions: READ_ONLY,
  concurrency: {
    group: '${{ github.workflow }}-${{ github.ref }}',
    'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
  },
  jobs: {
    'dependency-review': {
      if: "github.event_name == 'pull_request'",
      permissions: READ_ONLY,
      steps: [
        CHECKOUT,
        { uses: 'actions/dependency-review-action', with: { 'fail-on-severity': 'high' } },
      ],
    },
    lint: {
      steps: [
        ...SETUP,
        BUILD_RUNTIME,
        { run: 'npm run audit:gate' },
        { run: 'npm run typecheck' },
        { run: 'npm run lint' },
        { run: 'npm run format:check' },
        { run: 'npm run test:policy' },
        { run: 'npm run test:architecture' },
        { run: 'npm run compat:check' },
      ],
    },
    unit: {
      matrix: { node: [20, 22, 24, 26] },
      steps: [
        ...MATRIX_SETUP,
        BUILD_RUNTIME,
        { run: 'npm run test:unit' },
        { run: 'npm run test:integration' },
      ],
    },
    coverage: {
      steps: [
        { uses: 'actions/checkout', with: { 'fetch-depth': '0' } },
        SETUP_NODE,
        NPM_VERSION,
        NPM_CI,
        BUILD_RUNTIME,
        { run: 'npm run test:coverage' },
        {
          run: 'npm run test:coverage:diff',
          env: {
            COVERAGE_BASE_REF: '${{ github.event.pull_request.base.sha || github.event.before }}',
          },
        },
      ],
    },
    mutation: {
      if: "github.event_name == 'pull_request'",
      timeoutMinutes: 30,
      steps: [
        ...PINNED_SETUP,
        BUILD_RUNTIME,
        { run: 'npm run test:mutation', env: { STRYKER_SCOPE: 'pr' } },
        { run: 'npm run test:mutation:policy:pr' },
      ],
    },
    'fixture-audit': {
      steps: [
        CHECKOUT,
        SETUP_NODE,
        NPM_VERSION,
        ...[...CI_FIXTURES, 'payload-backend'].map(fixtureAudit),
      ],
    },
    build: callBuild,
    e2e: {
      needs: ['build'],
      matrix: { browser: [...BROWSERS] },
      steps: [
        ...FIXTURE_SETUP,
        { run: 'npx playwright install --with-deps ${{ matrix.browser }}' },
        DOWNLOAD_DIST,
        ...CI_FIXTURES.map(fixtureInstall),
        { run: 'npx playwright test --project=${{ matrix.browser }}' },
      ],
    },
    'astro-matrix': {
      needs: ['build'],
      matrix: { astro: [6, 5, 4] },
      steps: [
        ...FIXTURE_SETUP,
        { run: 'npx playwright install --with-deps chromium' },
        DOWNLOAD_DIST,
        {
          run: 'npm --prefix examples/astro-payload install --no-audit --no-fund --dangerously-allow-all-scripts "astro@^${{ matrix.astro }}"',
        },
        {
          run: [
            'npx playwright test --project=chromium',
            'tests/e2e/specs/accessibility.spec.ts',
            'tests/e2e/specs/diagnostics.spec.ts',
            'tests/e2e/specs/island-bridge.spec.ts',
            'tests/e2e/specs/live-preview.spec.ts',
            'tests/e2e/specs/navigation-lifecycle.spec.ts',
            'tests/e2e/specs/root-replacement.spec.ts',
            'tests/e2e/specs/scenarios.spec.ts',
            'tests/e2e/specs/structural-morph.spec.ts',
          ].join(' '),
          env: { PLP_E2E_SERVERS: 'astro' },
        },
      ],
    },
    'real-payload-e2e': {
      needs: ['build'],
      steps: [
        ...FIXTURE_SETUP,
        { run: 'npx playwright install --with-deps chromium' },
        DOWNLOAD_DIST,
        fixtureInstall('astro-payload'),
        fixtureInstall('payload-backend'),
        { run: 'npm run test:e2e:real-payload' },
      ],
    },
    'real-payload-hybrid': {
      needs: ['build'],
      matrix: { browser: [...BROWSERS] },
      steps: [
        ...FIXTURE_SETUP,
        { run: 'npx playwright install --with-deps ${{ matrix.browser }}' },
        DOWNLOAD_DIST,
        fixtureInstall('astro-hybrid'),
        fixtureInstall('payload-backend'),
        {
          run: 'npm run test:e2e:real-payload',
          env: {
            PLP_REAL_PAYLOAD_TARGET: 'hybrid',
            PLP_REAL_PAYLOAD_BROWSERS: '${{ matrix.browser }}',
          },
        },
      ],
    },
    'release-gates': callCriticalGates('300000', MAIN_PUSH),
  },
};

export const BUILD: WorkflowSpec = {
  name: 'Build',
  on: { workflow_call: {} },
  permissions: READ_ONLY,
  jobs: {
    build: {
      timeoutMinutes: 20,
      permissions: READ_ONLY,
      steps: [
        ...PINNED_SETUP,
        sourceDate('${{ github.sha }}', true),
        {
          run: 'npm run build',
          env: { SOURCE_DATE_EPOCH: '${{ steps.source_date.outputs.epoch }}' },
        },
        {
          run: 'npm run test:package -- --artifact-dir release-artifact --source-commit "$TESTED_SHA"',
          env: {
            SOURCE_DATE_EPOCH: '${{ steps.source_date.outputs.epoch }}',
            TESTED_SHA: '${{ github.sha }}',
          },
        },
        {
          uses: 'actions/upload-artifact',
          with: {
            name: 'release-candidate-${{ github.sha }}',
            path: 'release-artifact/*.tgz\nrelease-artifact/package-artifact.json',
            'if-no-files-found': 'error',
          },
        },
        {
          uses: 'actions/upload-artifact',
          with: { name: 'dist-${{ github.sha }}', path: 'dist/', 'if-no-files-found': 'error' },
        },
      ],
    },
  },
};

export const CRITICAL_GATES: WorkflowSpec = {
  name: 'Critical Gates',
  on: {
    workflow_call: {
      inputs: {
        'dist-artifact': {
          description: 'Name of the `dist/` artifact produced by build.yml.',
          required: true,
          type: 'string',
        },
        'soak-duration-ms': {
          description: 'Browser soak duration in milliseconds.',
          required: false,
          type: 'string',
          default: '300000',
        },
      },
    },
  },
  permissions: READ_ONLY,
  jobs: {
    // The scope outgrew a single job. Each shard mutates a disjoint part and
    // the baseline job grades the six reports joined back into one, so the
    // verdict stays a property of the scope rather than of the split.
    'critical-mutation': {
      timeoutMinutes: 150,
      permissions: READ_ONLY,
      matrix: { shard: [1, 2, 3, 4, 5, 6] },
      steps: [
        ...PINNED_SETUP,
        BUILD_RUNTIME,
        {
          run: 'npm run test:mutation',
          env: { STRYKER_SCOPE: 'nightly', STRYKER_SHARD: '${{ matrix.shard }}/6' },
        },
      ],
    },
    'critical-mutation-baseline': {
      needs: ['critical-mutation'],
      timeoutMinutes: 15,
      permissions: READ_ONLY,
      steps: [
        ...PINNED_SETUP,
        {
          uses: 'actions/download-artifact',
          with: {
            pattern: 'critical-mutation-shard-*-${{ github.sha }}',
            path: 'test-results',
            'merge-multiple': 'true',
          },
        },
        {
          run:
            'npx tsx scripts/merge-mutation-reports.ts --out test-results/stryker-nightly.json ' +
            'test-results/stryker-nightly-shard1.json test-results/stryker-nightly-shard2.json ' +
            'test-results/stryker-nightly-shard3.json test-results/stryker-nightly-shard4.json ' +
            'test-results/stryker-nightly-shard5.json test-results/stryker-nightly-shard6.json',
        },
        { run: 'npm run test:mutation:policy' },
      ],
    },
    'node-leak-soak': {
      timeoutMinutes: 30,
      permissions: READ_ONLY,
      steps: [...PINNED_SETUP, BUILD_RUNTIME, { run: 'npm run test:leak' }],
    },
    'browser-soak': {
      timeoutMinutes: 60,
      permissions: READ_ONLY,
      steps: [
        CHECKOUT,
        {
          uses: 'actions/setup-node',
          with: {
            'node-version': '22.23.2',
            'cache-dependency-path': 'package-lock.json\nexamples/*/package-lock.json',
          },
        },
        NPM_VERSION,
        NPM_CI,
        { run: 'npx playwright install --with-deps chromium' },
        {
          uses: 'actions/download-artifact',
          with: { name: '${{ inputs.dist-artifact }}', path: 'dist' },
        },
        fixtureInstall('astro-payload'),
        {
          run: 'npm run test:soak',
          env: { PLP_SOAK_DURATION_MS: '${{ inputs.soak-duration-ms }}' },
        },
      ],
    },
  },
};

export const DEEP_QUALITY: WorkflowSpec = {
  name: 'Deep Quality',
  on: { schedule: [{ cron: '17 2 * * 1-6' }, { cron: '17 2 * * 0' }], workflow_dispatch: null },
  permissions: READ_ONLY,
  concurrency: { group: 'deep-quality-${{ github.ref }}', 'cancel-in-progress': false },
  jobs: {
    'property-exploration': {
      steps: [
        ...SETUP,
        BUILD_RUNTIME,
        {
          run: [
            'echo "PLP_PROPERTY_SEED=$PLP_PROPERTY_SEED"',
            'mkdir -p test-results',
            'status=0',
            '{',
            '  npm run test:property',
            '} >test-results/property-exploration.log 2>&1 || status=$?',
            'cat test-results/property-exploration.log',
            'exit "$status"',
          ].join('\n'),
          env: { PLP_PROPERTY_SEED: '${{ github.run_id }}', PLP_PROPERTY_RUNS: '10000' },
          operators: true,
        },
      ],
    },
    build: callBuild,
    'critical-gates': callCriticalGates(
      "${{ github.event.schedule == '17 2 * * 0' && '1800000' || '300000' }}",
    ),
    'browser-bench': {
      needs: ['build'],
      steps: [
        ...FIXTURE_SETUP,
        { run: 'npx playwright install --with-deps chromium' },
        DOWNLOAD_DIST,
        fixtureInstall('astro-payload'),
        { run: 'npm run test:browser-bench' },
      ],
    },
  },
};
