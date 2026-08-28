/** The reviewed shape of the release, benchmark and protocol-watch workflows. */

import type { WorkflowSpec } from './workflow-contracts';
import { BUILD, CI, CRITICAL_GATES, DEEP_QUALITY } from './workflow-expectations-ci';
import {
  BUILD_RUNTIME,
  NPM_CI,
  NPM_VERSION,
  SETUP,
  SETUP_NODE,
  sourceDate,
  testedCommit,
} from './workflow-expectations-shared';

const TESTED_SHA = '${{ needs.gate.outputs.tested_sha }}';
const RELEASE: WorkflowSpec = {
  name: 'Release',
  on: {
    workflow_run: { workflows: ['CI'], types: ['completed'] },
    workflow_dispatch: {
      inputs: {
        run_id: {
          description: 'Id of a successful CI push run on main to release.',
          required: true,
          type: 'string',
        },
      },
    },
  },
  permissions: {},
  concurrency: {
    group: 'release-${{ github.event.workflow_run.head_branch || github.ref_name }}',
    'cancel-in-progress': false,
  },
  jobs: {
    gate: {
      if:
        "github.event_name == 'workflow_dispatch' || " +
        "(github.event.workflow_run.conclusion == 'success' && " +
        "github.event.workflow_run.event == 'push' && " +
        "github.event.workflow_run.head_branch == 'main' && " +
        'github.event.workflow_run.head_repository.full_name == github.repository)',
      permissions: { actions: 'read', contents: 'read' },
      steps: [
        { uses: 'actions/checkout', with: { 'fetch-depth': '0' } },
        SETUP_NODE,
        NPM_VERSION,
        NPM_CI,
        {
          run: 'npx tsx scripts/release-gate.ts',
          env: {
            GH_TOKEN: '${{ github.token }}',
            RELEASE_RUN_ID: '${{ inputs.run_id || github.event.workflow_run.id }}',
          },
        },
      ],
    },
    version: {
      if: "needs.gate.outputs.version_pr == 'true' && needs.gate.outputs.tested_sha == github.sha",
      needs: ['gate'],
      permissions: { contents: 'write', 'pull-requests': 'write' },
      steps: [
        { uses: 'actions/checkout', with: { ref: TESTED_SHA, 'fetch-depth': '0' } },
        testedCommit(TESTED_SHA),
        SETUP_NODE,
        NPM_VERSION,
        NPM_CI,
        { uses: 'changesets/action', with: { version: 'npm run version' } },
      ],
    },
    publish: {
      if: "needs.gate.outputs.publish == 'true'",
      needs: ['gate'],
      permissions: { actions: 'read', contents: 'write', 'id-token': 'write' },
      steps: [
        { uses: 'actions/checkout', with: { ref: TESTED_SHA, 'fetch-depth': '0' } },
        testedCommit(TESTED_SHA),
        {
          uses: 'actions/setup-node',
          with: { 'node-version': '22.23.2', 'registry-url': 'https://registry.npmjs.org' },
        },
        NPM_VERSION,
        NPM_CI,
        sourceDate(TESTED_SHA, false),
        {
          uses: 'actions/download-artifact',
          with: {
            name: `release-candidate-${TESTED_SHA}`,
            path: 'release-artifact',
            'github-token': '${{ secrets.GITHUB_TOKEN }}',
            'run-id': '${{ needs.gate.outputs.run_id }}',
          },
        },
        {
          run: [
            'shopt -s nullglob',
            'tarballs=(release-artifact/*.tgz)',
            'if [ "${#tarballs[@]}" -ne 1 ]; then',
            '  echo "expected exactly one CI package archive"',
            '  exit 1',
            'fi',
            'npm run test:package -- --tarball "${tarballs[0]}" --source-commit "$TESTED_SHA"',
          ].join('\n'),
          env: { SOURCE_DATE_EPOCH: '${{ steps.source_date.outputs.epoch }}', TESTED_SHA },
          shell: 'bash',
          operators: true,
        },
        {
          run: 'npm run release',
          env: {
            NPM_CONFIG_PROVENANCE: 'true',
            PACKAGE_ARTIFACT_DIR: 'release-artifact',
            PACKAGE_SOURCE_COMMIT: TESTED_SHA,
            SOURCE_DATE_EPOCH: '${{ steps.source_date.outputs.epoch }}',
          },
        },
        {
          run: 'npx tsx scripts/github-release.ts',
          env: { GH_TOKEN: '${{ github.token }}', PACKAGE_SOURCE_COMMIT: TESTED_SHA },
        },
        { run: 'npm run test:smoke' },
      ],
    },
  },
};

const CODSPEED_UPLOAD_POLICY = "${{ vars.CODSPEED_REQUIRED != 'true' }}";
const CODSPEED: WorkflowSpec = {
  name: 'Performance Trends',
  jobs: {
    cpu: {
      steps: [
        ...SETUP,
        BUILD_RUNTIME,
        {
          run: 'npm run test:bench:codspeed',
          name: 'Validate deterministic CPU benchmark harness',
          shell: 'bash',
        },
        {
          uses: 'CodSpeedHQ/action',
          name: 'Record deterministic CPU trends',
          with: { mode: 'simulation', run: 'npm run test:bench:codspeed' },
          continueOnError: CODSPEED_UPLOAD_POLICY,
        },
      ],
    },
    memory: {
      if: "github.event_name != 'pull_request'",
      steps: [
        ...SETUP,
        BUILD_RUNTIME,
        {
          uses: 'CodSpeedHQ/action',
          name: 'Record allocation trends',
          with: { mode: 'memory', run: 'npm run test:bench:codspeed' },
          continueOnError: CODSPEED_UPLOAD_POLICY,
        },
      ],
    },
  },
};

const PROTOCOL_WATCH: WorkflowSpec = {
  name: 'Protocol Watch',
  jobs: {
    'protocol-watch': {
      continueOnError: '${{ matrix.soft-fail }}',
      steps: [
        ...SETUP,
        {
          run: 'npx tsx scripts/check-protocol-drift.ts',
          env: { PROTOCOL_WATCH_PACKAGE: '@payloadcms/live-preview@${{ matrix.dist-tag }}' },
        },
      ],
    },
  },
};

export const WORKFLOW_EXPECTATIONS: Readonly<Record<string, WorkflowSpec>> = {
  'build.yml': BUILD,
  'ci.yml': CI,
  'codspeed.yml': CODSPEED,
  'critical-gates.yml': CRITICAL_GATES,
  'deep-quality.yml': DEEP_QUALITY,
  'protocol-watch.yml': PROTOCOL_WATCH,
  'release.yml': RELEASE,
};
