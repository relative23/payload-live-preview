/** The reviewed shape of the release, benchmark and protocol-watch workflows. */

import type { StepSpec, WorkflowSpec } from './workflow-contracts';
import { RELEASE_BRANCHES } from './release-gate';
import { BUILD, CI, CRITICAL_GATES, DEEP_QUALITY } from './workflow-expectations-ci';
import {
  BUILD_RUNTIME,
  FIXTURE_CACHE,
  FIXTURE_SETUP,
  fixtureInstall,
  NPM_CI,
  NPM_VERSION,
  SETUP,
  SETUP_NODE,
  sourceDate,
  testedCommit,
} from './workflow-expectations-shared';

const TESTED_SHA = '${{ needs.gate.outputs.tested_sha }}';
// The gate condition repeats RELEASE_BRANCHES. Deriving it here means a branch
// added to the list fails this contract until release.yml accepts it as well.
const RELEASE_BRANCH_CONDITION = RELEASE_BRANCHES.map(
  (branch) => `github.event.workflow_run.head_branch == '${branch}'`,
).join(' || ');
const RELEASE: WorkflowSpec = {
  name: 'Release',
  on: {
    workflow_run: { workflows: ['CI'], types: ['completed'] },
    workflow_dispatch: {
      inputs: {
        run_id: {
          description: `Id of a successful CI push run on ${RELEASE_BRANCHES.join(' or ')} to release.`,
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
        `(${RELEASE_BRANCH_CONDITION}) && ` +
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
        {
          run: [
            'if [ "$GITHUB_SHA" != "$TESTED_SHA" ] ||',
            '   [ "$GITHUB_REF" != "refs/heads/$TESTED_BRANCH" ] ||',
            '   [ "$GITHUB_WORKFLOW_SHA" != "$TESTED_SHA" ] ||',
            '   [ "$GITHUB_WORKFLOW_REF" != "$GITHUB_REPOSITORY/.github/workflows/release.yml@refs/heads/$TESTED_BRANCH" ]; then',
            '  echo "dispatched workflow source differs from certified CI"',
            '  exit 1',
            'fi',
          ].join('\n'),
          condition: "github.event_name == 'workflow_dispatch'",
          shell: 'bash',
          env: {
            TESTED_SHA: '${{ steps.release_gate.outputs.tested_sha }}',
            TESTED_BRANCH: '${{ steps.release_gate.outputs.tested_branch }}',
          },
          operators: true,
        },
      ],
    },
    version: {
      if: "needs.gate.outputs.version_pr == 'true' && needs.gate.outputs.tested_sha == github.sha",
      needs: ['gate'],
      permissions: { actions: 'read', contents: 'write', 'pull-requests': 'write' },
      steps: [
        { uses: 'actions/checkout', with: { ref: TESTED_SHA, 'fetch-depth': '0' } },
        testedCommit(TESTED_SHA),
        SETUP_NODE,
        NPM_VERSION,
        NPM_CI,
        // Before the action commits: the record of the released run goes into the Version PR.
        {
          name: 'Record the released CI run as the compatibility result',
          run: 'npm run compat:record',
          env: {
            GH_TOKEN: '${{ github.token }}',
            PLP_CI_RUN_ID: '${{ needs.gate.outputs.run_id }}',
          },
        },
        { uses: 'changesets/action', with: { version: 'npm run version' } },
      ],
    },
    'source-dispatch': {
      if:
        "github.event_name == 'workflow_run' && needs.gate.outputs.publish == 'true' && " +
        '(github.sha != needs.gate.outputs.tested_sha || ' +
        "github.ref != format('refs/heads/{0}', needs.gate.outputs.tested_branch) || " +
        'github.workflow_sha != needs.gate.outputs.tested_sha || ' +
        "github.workflow_ref != format('{0}/.github/workflows/release.yml@refs/heads/{1}', github.repository, needs.gate.outputs.tested_branch))",
      needs: ['gate'],
      permissions: { actions: 'write', contents: 'read' },
      steps: [
        {
          run: [
            'case "$TESTED_BRANCH" in',
            `  ${RELEASE_BRANCHES.join('|')}) ;;`,
            '  *) echo "invalid certified release branch"; exit 1 ;;',
            'esac',
            'if ! [[ "$TESTED_SHA" =~ ^[0-9a-f]{40}$ ]] ||',
            '   ! [[ "$TESTED_RUN_ID" =~ ^[1-9][0-9]*$ ]]; then',
            '  echo "invalid certified commit or CI run id"',
            '  exit 1',
            'fi',
            'if ! [[ "$GITHUB_WORKFLOW_SHA" =~ ^[0-9a-f]{40}$ ]] ||',
            '   [ "$GITHUB_WORKFLOW_REF" != "$GITHUB_REPOSITORY/.github/workflows/release.yml@$GITHUB_REF" ]; then',
            '  echo "invalid actual release workflow identity"',
            '  exit 1',
            'fi',
            'actual_head="$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/$TESTED_BRANCH" --jq \'.object.sha\')"',
            'if [ "$actual_head" != "$TESTED_SHA" ]; then',
            '  echo "certified branch moved; refusing source dispatch"',
            '  exit 1',
            'fi',
            'router_workflow="$(gh api "repos/$GITHUB_REPOSITORY/contents/.github/workflows/release.yml?ref=$GITHUB_WORKFLOW_SHA" --jq \'.sha\')"',
            'source_workflow="$(gh api "repos/$GITHUB_REPOSITORY/contents/.github/workflows/release.yml?ref=$TESTED_SHA" --jq \'.sha\')"',
            'if ! [[ "$router_workflow" =~ ^[0-9a-f]{40}$ ]] ||',
            '   [ "$source_workflow" != "$router_workflow" ]; then',
            '  echo "source receiver workflow differs; backport the guarded workflow and certify CI again"',
            '  exit 1',
            'fi',
            'jq -n --arg ref "$TESTED_BRANCH" --arg run_id "$TESTED_RUN_ID" \\',
            '  \'{ref:$ref, inputs:{run_id:$run_id}}\' > "$RUNNER_TEMP/source-dispatch.json"',
            'gh api --method POST "repos/$GITHUB_REPOSITORY/actions/workflows/release.yml/dispatches" \\',
            '  --input "$RUNNER_TEMP/source-dispatch.json"',
            "# The receiver shares this branch's concurrency key and starts after",
            '# this router exits. Waiting here would prevent the receiver starting.',
          ].join('\n'),
          shell: 'bash',
          env: {
            GH_TOKEN: '${{ github.token }}',
            TESTED_SHA,
            TESTED_BRANCH: '${{ needs.gate.outputs.tested_branch }}',
            TESTED_RUN_ID: '${{ needs.gate.outputs.run_id }}',
          },
          operators: true,
        },
      ],
    },
    publish: {
      if:
        "needs.gate.outputs.publish == 'true' && github.sha == needs.gate.outputs.tested_sha && " +
        "github.ref == format('refs/heads/{0}', needs.gate.outputs.tested_branch) && " +
        'github.workflow_sha == needs.gate.outputs.tested_sha && ' +
        "github.workflow_ref == format('{0}/.github/workflows/release.yml@refs/heads/{1}', github.repository, needs.gate.outputs.tested_branch)",
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
          run: [
            'if [ "$GITHUB_SHA" != "$PACKAGE_SOURCE_COMMIT" ] ||',
            '   [ "$GITHUB_REF" != "refs/heads/$PACKAGE_SOURCE_BRANCH" ] ||',
            '   [ "$GITHUB_WORKFLOW_SHA" != "$PACKAGE_SOURCE_COMMIT" ] ||',
            '   [ "$GITHUB_WORKFLOW_REF" != "$GITHUB_REPOSITORY/.github/workflows/release.yml@refs/heads/$PACKAGE_SOURCE_BRANCH" ]; then',
            '  echo "publisher workflow source differs from certified CI"',
            '  exit 1',
            'fi',
            'npm run release',
          ].join('\n'),
          shell: 'bash',
          operators: true,
          env: {
            NPM_CONFIG_PROVENANCE: 'true',
            PACKAGE_ARTIFACT_DIR: 'release-artifact',
            PACKAGE_SOURCE_COMMIT: TESTED_SHA,
            PACKAGE_SOURCE_BRANCH: '${{ needs.gate.outputs.tested_branch }}',
            SOURCE_DATE_EPOCH: '${{ steps.source_date.outputs.epoch }}',
          },
        },
        {
          run: 'npx tsx scripts/github-release.ts',
          env: {
            DIST_TAG: '${{ steps.publish.outputs.dist_tag }}',
            GH_TOKEN: '${{ github.token }}',
            PACKAGE_SOURCE_COMMIT: TESTED_SHA,
          },
        },
        { run: 'npm run test:smoke' },
      ],
    },
  },
};

const CODSPEED_UPLOAD_POLICY = "${{ vars.CODSPEED_REQUIRED != 'true' }}";
const CODSPEED: WorkflowSpec = {
  name: 'Performance Trends',
  concurrency: {
    group: "codspeed-${{ github.event_name == 'pull_request' && github.ref || github.sha }}",
    'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
  },
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

const PAYLOAD_CHANNEL = '${{ matrix.dist-tag }}';
const PROTOCOL_WATCH: WorkflowSpec = {
  name: 'Protocol Watch',
  // Read-only for the jobs that run published code; the report job alone writes the issue.
  permissions: { contents: 'read' },
  jobs: {
    'protocol-watch': {
      continueOnError: '${{ matrix.soft-fail }}',
      steps: [
        ...SETUP,
        {
          run: 'npx tsx scripts/check-protocol-drift.ts',
          env: { PROTOCOL_WATCH_PACKAGE: `@payloadcms/live-preview@${PAYLOAD_CHANNEL}` },
        },
        // After the drift check on purpose: a finding that stops reproducing is
        // upstream fixing something, which the docs answer, not an issue.
        {
          run: 'npm run test:upstream-findings',
          env: { UPSTREAM_FINDINGS_PACKAGE: `@payloadcms/live-preview@${PAYLOAD_CHANNEL}` },
        },
        {
          name: 'Record how the job ended',
          run: [
            'mkdir -p protocol-watch',
            'if [ -f protocol-drift.json ]; then cp protocol-drift.json protocol-watch/; fi',
            `echo '{"job":"protocol-watch","distTag":"${PAYLOAD_CHANNEL}","outcome":"\${{ job.status }}"}' > protocol-watch/result.json`,
          ].join('\n'),
          condition: 'always()',
          operators: true,
        },
        {
          uses: 'actions/upload-artifact',
          condition: 'always()',
          with: { name: `protocol-watch-wire-${PAYLOAD_CHANNEL}`, path: 'protocol-watch/' },
        },
      ],
    },
    // The nightly half that needs a running admin: the same E2E CI runs against
    // the pinned fixture, here against whatever `latest` and `beta` are now.
    'admin-e2e': {
      timeoutMinutes: 30,
      continueOnError: '${{ matrix.soft-fail }}',
      steps: [
        ...FIXTURE_SETUP,
        { run: 'bash scripts/ci-install-browser.sh chromium' },
        { run: 'npm run build' },
        fixtureInstall('astro-payload'),
        {
          run:
            'npm --prefix examples/payload-backend install --no-audit --no-fund --no-package-lock ' +
            `--ignore-scripts "payload@${PAYLOAD_CHANNEL}" ` +
            `"@payloadcms/next@${PAYLOAD_CHANNEL}" "@payloadcms/db-sqlite@${PAYLOAD_CHANNEL}" ` +
            `"@payloadcms/richtext-lexical@${PAYLOAD_CHANNEL}"`,
        },
        {
          run: "node -p \"'payload ' + require('./examples/payload-backend/node_modules/payload/package.json').version\"",
        },
        { run: 'npm run test:e2e:real-payload' },
        {
          name: 'Record how the job ended',
          run: [
            'mkdir -p protocol-watch',
            `echo '{"job":"admin-e2e","distTag":"${PAYLOAD_CHANNEL}","outcome":"\${{ job.status }}"}' > protocol-watch/result.json`,
          ].join('\n'),
          condition: 'always()',
          operators: true,
        },
        {
          uses: 'actions/upload-artifact',
          condition: 'always()',
          with: { name: `protocol-watch-admin-${PAYLOAD_CHANNEL}`, path: 'protocol-watch/' },
        },
        {
          uses: 'actions/upload-artifact',
          condition: 'failure()',
          with: {
            name: 'playwright-report-admin-${{ matrix.dist-tag }}',
            path: 'playwright-report/',
            'retention-days': '7',
          },
        },
      ],
    },
    report: {
      needs: ['protocol-watch', 'admin-e2e'],
      if: 'always()',
      timeoutMinutes: 10,
      permissions: { contents: 'read', issues: 'write' },
      steps: [
        { uses: 'actions/checkout', with: { 'persist-credentials': 'false' } },
        SETUP_NODE,
        {
          uses: 'actions/download-artifact',
          with: { pattern: 'protocol-watch-*', path: 'protocol-watch' },
        },
        {
          run: 'node scripts/report-protocol-drift.ts protocol-watch',
          env: { GH_TOKEN: '${{ github.token }}' },
        },
      ],
    },
  },
};

const LATEST_STATUS = 'Record what was installed and how the job ended';
const LANES = { lane: ['latest', 'prerelease'] };
/** Every step after the channel step: an entry with no channel above `latest` stops there. */
const HAS_CHANNEL = "steps.channel.outputs.tag != ''";
const HAS_HOOK_CHANNEL =
  "steps.react.outputs.tag != '' || steps.vue.outputs.tag != '' || steps.svelte.outputs.tag != ''";
const channelStep = (name: string): StepSpec => ({
  run: `node scripts/prerelease-channel.ts ${name} \${{ matrix.lane }}`,
});
const PRERELEASE_SOFT = "${{ matrix.lane == 'prerelease' }}";
const LATEST_WATCH: WorkflowSpec = {
  name: 'Latest Watch',
  // Read-only for the jobs that install published code; the report job alone writes issues.
  permissions: { contents: 'read' },
  jobs: {
    hooks: {
      timeoutMinutes: 20,
      continueOnError: PRERELEASE_SOFT,
      matrix: LANES,
      steps: [
        { uses: 'actions/checkout', with: { 'persist-credentials': 'false' } },
        SETUP_NODE,
        channelStep('react'),
        channelStep('vue'),
        channelStep('svelte'),
        { ...NPM_VERSION, condition: HAS_HOOK_CHANNEL },
        { ...NPM_CI, condition: HAS_HOOK_CHANNEL },
        { ...BUILD_RUNTIME, condition: HAS_HOOK_CHANNEL },
        {
          name: "Install the hooks' peers over the lockfile, without saving them",
          run:
            'npm install --no-save --no-audit --no-fund --ignore-scripts ' +
            '"react@${{ steps.react.outputs.install }}" ' +
            '"react-dom@${{ steps.react.outputs.install }}" @types/react@latest ' +
            '@types/react-dom@latest "vue@${{ steps.vue.outputs.install }}" ' +
            '"svelte@${{ steps.svelte.outputs.install }}"',
          condition: HAS_HOOK_CHANNEL,
        },
        {
          name: LATEST_STATUS,
          run: [
            'mkdir -p latest-watch',
            'npm ls --json --depth=0 react react-dom vue svelte > latest-watch/npm-ls.json || true',
            `echo '{"integration":"hooks","lane":"\${{ matrix.lane }}","channel":"\${{ steps.react.outputs.tag }} \${{ steps.vue.outputs.tag }} \${{ steps.svelte.outputs.tag }}","outcome":"\${{ (steps.react.outputs.tag == '' && steps.vue.outputs.tag == '' && steps.svelte.outputs.tag == '') && 'none' || job.status }}"}' > latest-watch/result.json`,
          ].join('\n'),
          condition: 'always()',
          operators: true,
        },
        {
          uses: 'actions/upload-artifact',
          condition: 'always()',
          with: { name: 'latest-watch-hooks-${{ matrix.lane }}', path: 'latest-watch/' },
        },
      ],
    },
    frameworks: {
      timeoutMinutes: 30,
      continueOnError: PRERELEASE_SOFT,
      steps: [
        { uses: 'actions/checkout', with: { 'persist-credentials': 'false' } },
        FIXTURE_CACHE,
        { run: 'node scripts/prerelease-channel.ts "${{ matrix.main }}" ${{ matrix.lane }}' },
        { ...NPM_VERSION, condition: HAS_CHANNEL },
        { ...NPM_CI, condition: HAS_CHANNEL },
        { run: 'bash scripts/ci-install-browser.sh chromium', condition: HAS_CHANNEL },
        { run: 'npm run build', condition: HAS_CHANNEL },
        {
          run: 'bash scripts/ci-install-fixture.sh "examples/${{ matrix.fixture }}"',
          condition: HAS_CHANNEL,
        },
        {
          name: "Install the integration's channel over the fixture",
          run:
            'npm --prefix "examples/${{ matrix.fixture }}" install --no-audit --no-fund ' +
            '--no-package-lock --ignore-scripts ' +
            '"${{ matrix.main }}@${{ steps.channel.outputs.tag }}" ${{ matrix.peers }}',
          condition: HAS_CHANNEL,
        },
        {
          run: 'npx playwright test --project=chromium ${{ matrix.specs }}',
          env: {
            PLP_E2E_SERVERS: '${{ matrix.servers }}',
            PLP_SVELTEKIT_FIXTURE: '${{ matrix.sveltekit-fixture }}',
            PLP_NUXT_FIXTURE: '${{ matrix.nuxt-fixture }}',
          },
          condition: HAS_CHANNEL,
        },
        { ...fixtureInstall('payload-backend'), condition: HAS_CHANNEL },
        {
          run: 'npm run test:e2e:real-payload',
          env: {
            PLP_REAL_PAYLOAD_TARGET: '${{ matrix.real-admin }}',
            PLP_REAL_PAYLOAD_BROWSERS: 'chromium',
          },
          condition: HAS_CHANNEL,
        },
        {
          name: LATEST_STATUS,
          run: [
            'mkdir -p latest-watch',
            'npm --prefix "examples/${{ matrix.fixture }}" ls --json --depth=0 > latest-watch/npm-ls.json || true',
            `echo '{"integration":"\${{ matrix.integration }}","lane":"\${{ matrix.lane }}","channel":"\${{ steps.channel.outputs.tag }}","outcome":"\${{ steps.channel.outputs.tag == '' && 'none' || job.status }}"}' > latest-watch/result.json`,
          ].join('\n'),
          condition: 'always()',
          operators: true,
        },
        {
          uses: 'actions/upload-artifact',
          condition: 'always()',
          with: {
            name: 'latest-watch-${{ matrix.integration }}-${{ matrix.lane }}',
            path: 'latest-watch/',
          },
        },
      ],
    },
    report: {
      needs: ['hooks', 'frameworks'],
      if: 'always()',
      timeoutMinutes: 10,
      permissions: { contents: 'read', issues: 'write' },
      steps: [
        { uses: 'actions/checkout', with: { 'persist-credentials': 'false' } },
        SETUP_NODE,
        {
          uses: 'actions/download-artifact',
          with: { pattern: 'latest-watch-*', path: 'latest-watch' },
        },
        {
          run: 'node scripts/report-latest-watch.ts latest-watch',
          env: {
            GH_TOKEN: '${{ github.token }}',
            PLP_LATEST_WATCH_RUN:
              '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
          },
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
  'latest-watch.yml': LATEST_WATCH,
  'protocol-watch.yml': PROTOCOL_WATCH,
  'release.yml': RELEASE,
};
