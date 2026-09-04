import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findActionPinViolations,
  findWorkflowContractViolations,
  matrixValues,
  parseWorkflow,
} from '../../../scripts/workflow-contracts';

const WORKFLOWS = resolve(process.cwd(), '.github/workflows');

function readWorkflows(): Map<string, string> {
  const sources = new Map<string, string>();
  for (const name of readdirSync(WORKFLOWS)
    .filter((file) => /\.ya?ml$/u.test(file))
    .sort()) {
    sources.set(name, readFileSync(resolve(WORKFLOWS, name), 'utf8'));
  }
  return sources;
}

function mutated(file: string, original: string, replacement: string): Map<string, string> {
  const sources = readWorkflows();
  const source = sources.get(file);
  if (!source?.includes(original)) {
    throw new Error(`${file} does not contain ${JSON.stringify(original)}`);
  }
  sources.set(file, source.replace(original, replacement));
  return sources;
}

const NPM_VERSION_STEP =
  '      - name: Use repository npm version\n' +
  '        run: npm install --global "$(node -p "require(\'./package.json\').packageManager")"\n';

describe('workflow contracts', () => {
  it('accepts the committed workflows', () => {
    expect(findWorkflowContractViolations(readWorkflows())).toEqual([]);
  });

  it.each([
    {
      label: 'a soft-failed unit run',
      file: 'ci.yml',
      original: 'run: npm run test:unit',
      replacement: 'run: npm run test:unit || true',
      violation: 'ci.yml job unit step run "npm run test:unit" must exist exactly once (found 0)',
    },
    {
      label: 'a soft-failed mutation policy',
      file: 'ci.yml',
      original: 'run: npm run test:mutation:policy:pr',
      replacement: 'run: npm run test:mutation:policy:pr || echo ignored',
      violation:
        'ci.yml job mutation step run "npm run test:mutation:policy:pr" must exist exactly once (found 0)',
    },
    {
      label: 'a chained mutation run',
      file: 'critical-gates.yml',
      original: 'run: npm run test:mutation\n',
      replacement: 'run: npm run test:mutation; true\n',
      violation:
        'critical-gates.yml job critical-mutation step run "npm run test:mutation" must exist exactly once (found 0)',
    },
    {
      label: 'a skipped coverage diff step',
      file: 'ci.yml',
      original: '        run: npm run test:coverage:diff',
      replacement: '        if: false\n        run: npm run test:coverage:diff',
      violation: 'ci.yml job coverage step run "npm run test:coverage:diff" is conditional',
    },
    {
      label: 'a step that may fail',
      file: 'ci.yml',
      original: '      - run: npm run lint\n',
      replacement: '      - run: npm run lint\n        continue-on-error: true\n',
      violation: 'ci.yml job lint step run "npm run lint" may fail without failing the job',
    },
    {
      label: 'a duplicated required step',
      file: 'ci.yml',
      original: '      - run: npm run typecheck\n',
      replacement: '      - run: npm run typecheck\n      - run: npm run typecheck\n',
      violation: 'ci.yml job lint step run "npm run typecheck" must exist exactly once (found 2)',
    },
    {
      label: 'a job that may fail',
      file: 'ci.yml',
      original: '  lint:\n    name: Lint & Typecheck\n',
      replacement: '  lint:\n    name: Lint & Typecheck\n    continue-on-error: true\n',
      violation: 'ci.yml job lint permits failures',
    },
    {
      label: 'a renamed required job',
      file: 'ci.yml',
      original: '  real-payload-hybrid:\n',
      replacement: '  real-payload-hybrid-advisory:\n',
      violation: 'ci.yml job real-payload-hybrid is missing',
    },
    {
      label: 'a dropped browser fixture',
      file: 'ci.yml',
      original: '      - run: npm ci --no-audit --no-fund --prefix examples/astro-middleware\n',
      replacement: '',
      violation:
        'ci.yml job e2e step run "npm ci --no-audit --no-fund --prefix examples/astro-middleware" must exist exactly once (found 0)',
    },
    {
      label: 'a dropped fixture audit',
      file: 'ci.yml',
      original:
        '      - run: npm audit --audit-level=high --package-lock-only --prefix examples/payload-backend\n',
      replacement: '',
      violation:
        'ci.yml job fixture-audit step run "npm audit --audit-level=high --package-lock-only --prefix examples/payload-backend" must exist exactly once (found 0)',
    },
    {
      label: 'a reduced browser matrix',
      file: 'ci.yml',
      original: 'browser: [chromium, firefox, webkit]',
      replacement: 'browser: [chromium]',
      violation: 'ci.yml job e2e does not run the reviewed matrix',
    },
    {
      label: 'a reduced Node matrix',
      file: 'ci.yml',
      original: 'node: [20, 22, 24, 26]',
      replacement: 'node: [22]',
      violation: 'ci.yml job unit does not run the reviewed matrix',
    },
    {
      label: 'a reduced Astro matrix',
      file: 'ci.yml',
      original: 'astro: [6, 5, 4]',
      replacement: 'astro: [6]',
      violation: 'ci.yml job astro-matrix does not run the reviewed matrix',
    },
    {
      label: 'release gates on every push',
      file: 'ci.yml',
      original:
        "if: github.event_name == 'push' && github.ref == 'refs/heads/main'\n    needs: build",
      replacement: "if: github.event_name == 'push'\n    needs: build",
      violation: 'ci.yml job release-gates does not use the reviewed condition',
    },
    {
      label: 'a shortened browser soak',
      file: 'ci.yml',
      original: "soak-duration-ms: '300000'",
      replacement: "soak-duration-ms: '60000'",
      violation: 'ci.yml job release-gates with.soak-duration-ms is not "300000"',
    },
    {
      label: 'a PR mutation scope in the release baseline',
      file: 'critical-gates.yml',
      original: 'STRYKER_SCOPE: nightly',
      replacement: 'STRYKER_SCOPE: pr',
      violation:
        'critical-gates.yml job critical-mutation step run "npm run test:mutation" env.STRYKER_SCOPE is not "nightly"',
    },
    {
      label: 'a quick leak soak',
      file: 'critical-gates.yml',
      original: 'run: npm run test:leak',
      replacement: 'run: npm run test:leak:quick',
      violation:
        'critical-gates.yml job node-leak-soak step run "npm run test:leak" must exist exactly once (found 0)',
    },
    {
      label: 'a cancellable main verdict',
      file: 'ci.yml',
      original: "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
      replacement: 'cancel-in-progress: true',
      violation: 'ci.yml concurrency differs from the reviewed contract',
    },
    {
      label: 'a build without the package gate',
      file: 'build.yml',
      original:
        'run: npm run test:package -- --artifact-dir release-artifact --source-commit "$TESTED_SHA"',
      replacement: 'run: npm run build',
      violation:
        'build.yml job build step run "npm run test:package -- --artifact-dir release-artifact --source-commit "$TESTED_SHA"" must exist exactly once (found 0)',
    },
    {
      label: 'a floating build Node version',
      file: 'build.yml',
      original: 'node-version: 22.23.2',
      replacement: 'node-version: 22',
      violation:
        'build.yml job build step uses actions/setup-node with.node-version is not "22.23.2"',
    },
    {
      label: 'a publish job that ignores the gate',
      file: 'release.yml',
      original: "if: needs.gate.outputs.publish == 'true'",
      replacement: 'if: true',
      violation: 'release.yml job publish does not use the reviewed condition',
    },
    {
      label: 'a version PR from a non-tip commit',
      file: 'release.yml',
      original: 'needs.gate.outputs.tested_sha == github.sha',
      replacement: 'true',
      violation: 'release.yml job version does not use the reviewed condition',
    },
    {
      label: 'a replaced gate script',
      file: 'release.yml',
      original: 'run: npx tsx scripts/release-gate.ts',
      replacement: 'run: echo publish=true >> "$GITHUB_OUTPUT"',
      violation:
        'release.yml job gate step run "npx tsx scripts/release-gate.ts" must exist exactly once (found 0)',
    },
    {
      label: 'a publish through Changesets directory repacking',
      file: 'release.yml',
      original: 'run: npm run release',
      replacement: 'run: npx changeset publish',
      violation:
        'release.yml job publish step run "npm run release" must exist exactly once (found 0)',
    },
    {
      label: 'an artifact from an unrelated run',
      file: 'release.yml',
      original: 'run-id: ${{ needs.gate.outputs.run_id }}',
      replacement: 'run-id: ${{ github.run_id }}',
      violation:
        'release.yml job publish step uses actions/download-artifact with.run-id is not "${{ needs.gate.outputs.run_id }}"',
    },
    {
      label: 'a gate without workflow-run provenance checks',
      file: 'release.yml',
      original: 'github.event.workflow_run.head_repository.full_name == github.repository)',
      replacement: 'true)',
      violation: 'release.yml job gate does not use the reviewed condition',
    },
    {
      label: 'a release workflow with write permissions by default',
      file: 'release.yml',
      original: 'permissions: {}',
      replacement: 'permissions:\n  contents: write',
      violation: 'release.yml permissions differs from the reviewed contract',
    },
    {
      label: 'a floating action tag',
      file: 'ci.yml',
      original: `      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4\n        with:\n          node-version: 22\n          cache: npm\n${NPM_VERSION_STEP}      - run: npm ci\n      # The generated`,
      replacement: `      - uses: actions/checkout@v4\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4\n        with:\n          node-version: 22\n          cache: npm\n${NPM_VERSION_STEP}      - run: npm ci\n      # The generated`,
      violation: 'ci.yml job lint uses an unpinned action: actions/checkout@v4',
    },
    {
      label: 'a CodSpeed upload that always passes',
      file: 'codspeed.yml',
      original:
        "continue-on-error: ${{ vars.CODSPEED_REQUIRED != 'true' }}\n        uses: CodSpeedHQ/action",
      replacement: 'continue-on-error: true\n        uses: CodSpeedHQ/action',
      violation:
        'codspeed.yml job cpu step uses CodSpeedHQ/action does not use the reviewed continue-on-error policy',
    },
    {
      label: 'a CodSpeed harness in walltime mode',
      file: 'codspeed.yml',
      original: 'mode: simulation',
      replacement: 'mode: walltime',
      violation: 'codspeed.yml job cpu step uses CodSpeedHQ/action with.mode is not "simulation"',
    },
    {
      label: 'a fewer-case property exploration',
      file: 'deep-quality.yml',
      original: 'PLP_PROPERTY_RUNS: 10000',
      replacement: 'PLP_PROPERTY_RUNS: 1000',
      violation:
        'deep-quality.yml job property-exploration step run "echo "PLP_PROPERTY_SEED=$PLP_PROPERTY_SEED"" env.PLP_PROPERTY_RUNS is not "10000"',
    },
    {
      label: 'a Sunday soak shortened to five minutes',
      file: 'deep-quality.yml',
      original: "&& '1800000' || '300000'",
      replacement: "&& '300000' || '300000'",
      violation: 'deep-quality.yml job critical-gates with.soak-duration-ms is not',
    },
  ])('rejects $label', ({ file, original, replacement, violation }) => {
    const violations = findWorkflowContractViolations(mutated(file, original, replacement));
    expect(
      violations.some((candidate) => candidate.includes(violation)),
      violations.join('\n'),
    ).toBe(true);
  });

  it('pins job-level reusable workflow references as strictly as step actions', () => {
    const document = parseWorkflow(
      'jobs:\n  build:\n    uses: octo/build/.github/workflows/build.yml@main\n  local:\n    uses: ./.github/workflows/build.yml\n',
    );
    expect(findActionPinViolations([{ name: 'x.yml', document }])).toEqual([
      'x.yml job build uses an unpinned action: octo/build/.github/workflows/build.yml@main',
    ]);
  });

  it('ignores expressions that only exist in YAML comments', () => {
    const sources = mutated(
      'release.yml',
      "if: needs.gate.outputs.publish == 'true'",
      "if: true # needs.gate.outputs.publish == 'true'",
    );
    expect(findWorkflowContractViolations(sources)).toContain(
      'release.yml job publish does not use the reviewed condition',
    );
  });

  it('reads matrices from the parsed document', () => {
    const ci = parseWorkflow(readWorkflows().get('ci.yml') ?? '');
    expect(matrixValues(ci, 'unit', 'node')).toEqual([20, 22, 24, 26]);
    expect(matrixValues(ci, 'astro-matrix', 'astro')).toEqual([6, 5, 4]);
    expect(matrixValues(ci, 'lint', 'node')).toEqual([]);
  });
});
