/** The reviewed shape of the per-push CI workflows and the release-critical gates. */

import type { WorkflowSpec } from './workflow-contracts';
import {
  BROWSERS,
  BUILD_RUNTIME,
  CHECKOUT,
  CI_FIXTURES,
  DOWNLOAD_DIST,
  FIXTURE_SETUP,
  RELEASE_PUSH,
  NPM_CI,
  NPM_VERSION,
  MATRIX_SETUP,
  PINNED_SETUP,
  SETUP_NODE,
  READ_ONLY,
  SETUP,
  archiveJob,
  callBuild,
  callCriticalGates,
  fixtureAudit,
  fixtureInstall,
  sourceDate,
  twinFixtureJob,
} from './workflow-expectations-shared';

/**
 * Advisories of the Payload 2 lane (examples/payload-version-lanes/v2 pins payload 2.32.3 and
 * @payloadcms/db-mongodb 1.7.5, the last Payload 2 releases). Their fixes exist only in Payload 3
 * and 4, so Dependency Review may not fail the pull request on them; any other advisory still does.
 */
const PAYLOAD_2_ADVISORIES = [
  'GHSA-hp5w-3hxx-vmwf',
  'GHSA-f7hx-52q9-hcrf',
  'GHSA-97rh-rhh2-7vjv',
  'GHSA-2pwp-2369-8fg3',
  'GHSA-p223-2wr2-j562',
  'GHSA-7xxh-373w-35vg',
  'GHSA-6r7f-q7f5-wpx8',
  'GHSA-9qpg-3cf8-w33x',
  'GHSA-fx49-4h83-wjv9',
  'GHSA-4ww4-68q3-h7g5',
];

export const CI: WorkflowSpec = {
  name: 'CI',
  on: {
    push: { branches: ['main', 'release/2.0'] },
    pull_request: { branches: ['main', 'release/2.0'] },
  },
  permissions: READ_ONLY,
  concurrency: {
    group:
      "${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.sha }}",
    'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
  },
  jobs: {
    'dependency-review': {
      if: "github.event_name == 'pull_request'",
      permissions: READ_ONLY,
      steps: [
        CHECKOUT,
        {
          uses: 'actions/dependency-review-action',
          with: { 'fail-on-severity': 'high', 'allow-ghsas': PAYLOAD_2_ADVISORIES.join(', ') },
        },
      ],
    },
    lint: {
      steps: [
        ...SETUP,
        BUILD_RUNTIME,
        { run: 'npm run check:generated' },
        { run: 'npm run audit:gate' },
        { run: 'npm run typecheck' },
        { run: 'npm run lint' },
        { run: 'npm run format:check' },
        { run: 'npm run test:policy' },
        { run: 'npm run test:architecture' },
        { run: 'npm run compat:check' },
        { run: 'npm run diagnostics:check' },
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
    // The peer floors, installed over the lockfile: the unit job runs what the
    // lockfile installs, which is the top of each range and not its promise.
    'hook-matrix': {
      timeoutMinutes: 15,
      matrix: { react: ['18.0.0'], vue: ['3.3.0'], svelte: ['5.0.0'] },
      steps: [
        ...PINNED_SETUP,
        BUILD_RUNTIME,
        {
          run: 'npm install --no-save --no-audit --no-fund "react@${{ matrix.react }}" "react-dom@${{ matrix.react }}" "@types/react@${{ matrix.react }}" "@types/react-dom@${{ matrix.react }}" "vue@${{ matrix.vue }}" "svelte@${{ matrix.svelte }}"',
        },
        {
          run: "node -p \"'react ' + require('react/package.json').version + ', react-dom ' + require('react-dom/package.json').version + ', vue ' + require('vue/package.json').version + ', svelte ' + require('svelte/package.json').version\"",
        },
        {
          run: 'npx vitest run tests/unit/adapters/react-hook.test.tsx tests/unit/adapters/react-route-refresh.test.tsx tests/unit/adapters/nextjs-fragments.test.ts tests/unit/adapters/vue-composable.test.ts tests/unit/core/hydration-vue.test.ts tests/unit/adapters/nuxt-fragments.test.ts tests/unit/adapters/sveltekit-fragments-real.test.ts tests/unit/adapters/sveltekit-fragments.test.ts',
        },
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
        ...[...CI_FIXTURES, 'sveltekit3-payload', 'nuxt4-payload', 'payload-backend'].map(
          fixtureAudit,
        ),
      ],
    },
    build: callBuild,
    e2e: {
      needs: ['build'],
      matrix: { browser: [...BROWSERS] },
      steps: [
        ...FIXTURE_SETUP,
        { run: 'bash scripts/ci-install-browser.sh ${{ matrix.browser }}' },
        DOWNLOAD_DIST,
        ...CI_FIXTURES.map(fixtureInstall),
        { run: 'npx playwright test --project=${{ matrix.browser }}' },
      ],
    },
    // The SvelteKit 3 twin of the SvelteKit example: the SvelteKit-only files whole, the shared
    // files' SvelteKit cases and the byte-for-byte public response, which is the SvelteKit fixture's.
    // The public-response rows need the runtime the Astro fixture serves, which the job does not start.
    sveltekit3: twinFixtureJob(
      'sveltekit3-payload',
      { PLP_E2E_SERVERS: 'sveltekit', PLP_SVELTEKIT_FIXTURE: 'sveltekit3-payload' },
      [
        'owner-scoping',
        'sveltekit-asset-delivery',
        'sveltekit-fragment',
        'sveltekit-live-preview',
        'sveltekit-owner-fragments',
      ],
      {
        grep: '-g "[Ss]velte[Kk]it|byte for byte" --grep-invert "public response carries"',
        files: [
          'auto-bind-hit-rate',
          'fragment-request-bounds',
          'navigation-lifecycle-per-framework',
          'public-response',
          'reveal',
        ],
      },
    ),
    // The Nuxt 4 twin of the Nuxt example: the Nuxt-only files whole, the shared files' Nuxt cases.
    // The Nuxt public-response row needs the runtime the Astro fixture serves, like SvelteKit 3's.
    nuxt4: twinFixtureJob(
      'nuxt4-payload',
      { PLP_E2E_SERVERS: 'nuxt', PLP_NUXT_FIXTURE: 'nuxt4-payload' },
      ['nuxt-asset-delivery', 'nuxt-fragment', 'nuxt-live-preview'],
      {
        grep: '-g "[Nn]uxt"',
        files: [
          'auto-bind-hit-rate',
          'fragment-request-bounds',
          'navigation-lifecycle-per-framework',
          'reveal',
        ],
      },
    ),
    'astro-matrix': {
      needs: ['build'],
      matrix: { astro: [6, 5, 4] },
      steps: [
        ...FIXTURE_SETUP,
        { run: 'bash scripts/ci-install-browser.sh chromium' },
        DOWNLOAD_DIST,
        {
          run: 'npm --prefix examples/astro-payload install --no-audit --no-fund --ignore-scripts "astro@^${{ matrix.astro }}"',
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
    // Next.js 15 over the Next.js fixture, whose lockfile pins 16. The production build is webpack
    // there and the base path is where an older Next differs from the newest, so both run beside the
    // development suite.
    'next-matrix': {
      needs: ['build'],
      matrix: { next: [15] },
      steps: [
        ...FIXTURE_SETUP,
        { run: 'bash scripts/ci-install-browser.sh chromium' },
        DOWNLOAD_DIST,
        {
          run: 'npm --prefix examples/nextjs-payload install --no-audit --no-fund "next@^${{ matrix.next }}"',
        },
        {
          run: [
            'npx playwright test --project=chromium -g "[Nn]ext"',
            'tests/e2e/specs/auto-bind-hit-rate.spec.ts',
            'tests/e2e/specs/fragment-request-bounds.spec.ts',
            'tests/e2e/specs/navigation-lifecycle-per-framework.spec.ts',
            'tests/e2e/specs/nextjs-asset-delivery.spec.ts',
            'tests/e2e/specs/nextjs-fragment.spec.ts',
            'tests/e2e/specs/nextjs-live-preview.spec.ts',
            'tests/e2e/specs/reveal.spec.ts',
          ].join(' '),
          env: { PLP_E2E_SERVERS: 'nextjs' },
        },
        { run: 'npm run test:e2e:next-webpack-production -- --project=chromium' },
        { run: 'npm run test:e2e:next-base-path -- --project=chromium' },
      ],
    },
    // The Astro floors the matrix above cannot reach. Each consumes the archive the Build job stored,
    // in a consumer of its own with a reviewed lock; the run line names the archive and the Playwright
    // scope, so a job that quietly tests the checkout instead stops matching.
    'astro-floor-base': archiveJob('playwright.astro-floor-base.config.ts', 25),
    'astro-floor-islands': archiveJob(
      'playwright.astro-islands.config.ts',
      25,
      { astro: ['4.16.19'] },
      { PLP_ASTRO_RESOURCE_VERSION: '${{ matrix.astro }}' },
    ),
    // Native fragment rendering and page-owned resources on the exact Astro versions the record names.
    'astro-fragment-versions': archiveJob(
      'playwright.astro-resources.config.ts',
      25,
      { astro: ['4.9.0', '4.16.19', '5.18.2', '6.4.8', '7.3.2', '7.4.4'] },
      { PLP_ASTRO_RESOURCE_VERSION: '${{ matrix.astro }}' },
    ),
    // Next.js, SvelteKit, Nuxt, plain HTML, Vue and React production hosts on the stored archive,
    // against a real Payload 3 login and access control (tests/e2e/continuation/next-host.spec.ts).
    'production-lifecycle': archiveJob(
      'playwright.${{ matrix.framework }}-continuation.config.ts',
      30,
      { framework: ['next', 'sveltekit', 'nuxt', 'html', 'vue', 'react'] },
    ),
    'real-payload-e2e': {
      needs: ['build'],
      steps: [
        ...FIXTURE_SETUP,
        { run: 'bash scripts/ci-install-browser.sh chromium' },
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
        { run: 'bash scripts/ci-install-browser.sh ${{ matrix.browser }}' },
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
    // The other targets of playwright.real-payload.config.ts: the frameworks whose preview verifies
    // the editor's real session (Astro's built Node server among them), the hook and composable
    // pages, the plain HTML page, the Next.js example framed from an admin that keeps its
    // autoLogin, and the SvelteKit example's collection pages framed from an admin that has two
    // collections for the create screen. The example a target frames is looked up by name; a
    // target the config knows and this matrix lacks is a test that never runs on a push.
    'real-payload-surfaces': {
      needs: ['build'],
      matrix: {
        target: [
          'nextjs',
          'sveltekit',
          'nuxt',
          'nextjs-hook',
          'nuxt-composable',
          'html',
          'astro-session',
          'nextjs-autologin',
          'create',
          'sveltekit3',
          'sveltekit3-create',
          'nuxt4',
          'nuxt4-composable',
          'nextjs-production',
          'sveltekit-production',
          'nuxt-production',
          'sveltekit3-production',
          'nuxt4-production',
          'findings',
        ],
        browser: [...BROWSERS],
      },
      steps: [
        ...FIXTURE_SETUP,
        { run: 'bash scripts/ci-install-browser.sh ${{ matrix.browser }}' },
        DOWNLOAD_DIST,
        {
          run: 'bash scripts/ci-install-fixture.sh "examples/$EXAMPLE"',
          env: {
            EXAMPLE:
              '${{ fromJSON(\'{"nextjs":"nextjs-payload","nextjs-hook":"nextjs-payload","sveltekit":"sveltekit-payload","nuxt":"nuxt-payload","nuxt-composable":"nuxt-payload","html":"pure-html","astro-session":"astro-middleware","nextjs-autologin":"nextjs-payload","create":"sveltekit-payload","sveltekit3":"sveltekit3-payload","sveltekit3-create":"sveltekit3-payload","nuxt4":"nuxt4-payload","nuxt4-composable":"nuxt4-payload","nextjs-production":"nextjs-payload","sveltekit-production":"sveltekit-payload","nuxt-production":"nuxt-payload","sveltekit3-production":"sveltekit3-payload","nuxt4-production":"nuxt4-payload","findings":"pure-html"}\')[matrix.target] }}',
          },
        },
        fixtureInstall('payload-backend'),
        {
          run: 'npm run test:e2e:real-payload',
          env: {
            PLP_REAL_PAYLOAD_TARGET: '${{ matrix.target }}',
            PLP_REAL_PAYLOAD_BROWSERS: '${{ matrix.browser }}',
          },
        },
      ],
    },
    // Payload's CSRF list on, for the target that verifies the editor's session and the one that
    // merges as the editor: the package repeats the admin's origin on the forwarded cookie.
    'real-payload-csrf': {
      needs: ['build'],
      matrix: { target: ['nextjs', 'nextjs-hook'] },
      steps: [
        ...FIXTURE_SETUP,
        { run: 'bash scripts/ci-install-browser.sh chromium' },
        DOWNLOAD_DIST,
        fixtureInstall('nextjs-payload'),
        fixtureInstall('payload-backend'),
        {
          run: 'npm run test:e2e:real-payload',
          env: { PLP_REAL_PAYLOAD_TARGET: '${{ matrix.target }}', PLP_REAL_PAYLOAD_CSRF: '1' },
        },
      ],
    },
    'release-gates': callCriticalGates('300000', RELEASE_PUSH),
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
      timeoutMinutes: 180,
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
    // The trusted core on its own, beside the shards: same runtime, stricter
    // policy. The nightly report cannot stand in for it — one score over sixty
    // files says nothing about nine that carry the capabilities.
    'trusted-core-mutation': {
      timeoutMinutes: 150,
      permissions: READ_ONLY,
      steps: [
        ...PINNED_SETUP,
        BUILD_RUNTIME,
        { run: 'npm run test:mutation', env: { STRYKER_SCOPE: 'core' } },
        { run: 'npm run test:mutation:policy:core' },
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
            'node-version': '22.23.4',
            'cache-dependency-path': 'package-lock.json\nexamples/*/package-lock.json',
          },
        },
        NPM_VERSION,
        NPM_CI,
        { run: 'bash scripts/ci-install-browser.sh chromium' },
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
        { run: 'bash scripts/ci-install-browser.sh chromium' },
        DOWNLOAD_DIST,
        fixtureInstall('astro-payload'),
        { run: 'npm run test:browser-bench' },
      ],
    },
  },
};
