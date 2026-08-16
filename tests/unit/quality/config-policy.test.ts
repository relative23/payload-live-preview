import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findCodspeedWorkflowViolations,
  findDeepQualityWorkflowViolations,
  findWorkflowActionPinViolations,
} from '../../../scripts/quality-workflow-policy';

const readRepositoryFile = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('test runner policy', () => {
  it('fails focused unit tests and flaky browser tests in every environment', () => {
    const vitestConfig = readRepositoryFile('vitest.config.ts');
    const playwrightConfigs = [
      readRepositoryFile('playwright.config.ts'),
      readRepositoryFile('playwright.real-payload.config.ts'),
      readRepositoryFile('playwright.soak.config.ts'),
    ];

    expect(vitestConfig).toMatch(/allowOnly:\s*false/u);
    expect(vitestConfig).toMatch(/retry:\s*0/u);
    expect(vitestConfig).toMatch(/new ZeroSkipReporter\(\)/u);
    for (const config of playwrightConfigs) {
      expect(config).toMatch(/forbidOnly:\s*true/u);
      expect(config).toMatch(/failOnFlakyTests:\s*true/u);
      expect(config).toMatch(/playwright-zero-skip-reporter\.ts/u);
    }
  });

  it('keeps Stryker sandboxes outside the repository-wide ESLint project', () => {
    const eslintConfig = readRepositoryFile('eslint.config.js');

    expect(eslintConfig).toMatch(/ignores:\s*\[[\s\S]*['"]\.stryker-tmp\/\*\*['"]/u);
  });

  it('pins CodSpeed simulation and non-PR memory measurements', () => {
    const workflow = readRepositoryFile('.github/workflows/codspeed.yml');
    expect(findCodspeedWorkflowViolations(workflow)).toEqual([]);

    for (const [label, mutated] of [
      ['cpu mode', workflow.replace('mode: simulation', 'mode: walltime')],
      [
        'cpu command',
        workflow.replace(
          'mode: simulation\n          run: npm run test:bench:codspeed',
          'mode: simulation\n          run: npm run test:bench',
        ),
      ],
      [
        'cpu hard validation',
        workflow.replace(
          'name: Validate deterministic CPU benchmark harness',
          'name: Skip deterministic CPU benchmark harness',
        ),
      ],
      [
        'cpu hard validation cannot soft-fail',
        workflow.replace(
          'name: Validate deterministic CPU benchmark harness\n        run: npm run test:bench:codspeed',
          'name: Validate deterministic CPU benchmark harness\n        continue-on-error: true\n        run: npm run test:bench:codspeed',
        ),
      ],
      [
        'cpu hard validation cannot hide its command in env',
        workflow.replace(
          'name: Validate deterministic CPU benchmark harness\n        run: npm run test:bench:codspeed\n        shell: bash',
          'name: Validate deterministic CPU benchmark harness\n        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        env:\n          run: npm run test:bench:codspeed',
        ),
      ],
      [
        'cpu hard validation cannot replace its shell',
        workflow.replace('shell: bash', 'shell: "true {0}"'),
      ],
      [
        'cpu job cannot soft-fail',
        workflow.replace(
          'cpu:\n    name: CodSpeed CPU',
          'cpu:\n    name: CodSpeed CPU\n    continue-on-error: true',
        ),
      ],
      [
        'cpu job cannot be skipped',
        workflow.replace(
          'cpu:\n    name: CodSpeed CPU',
          'cpu:\n    name: CodSpeed CPU\n    if: false',
        ),
      ],
      [
        'cpu job cannot use a quoted skip key',
        workflow.replace(
          'cpu:\n    name: CodSpeed CPU',
          'cpu:\n    name: CodSpeed CPU\n    "if": false',
        ),
      ],
      [
        'staged upload policy',
        workflow.replace(
          "continue-on-error: ${{ vars.CODSPEED_REQUIRED != 'true' }}",
          'continue-on-error: true',
        ),
      ],
      [
        'cpu upload cannot use a decoy policy',
        workflow.replace(
          "continue-on-error: ${{ vars.CODSPEED_REQUIRED != 'true' }}\n        uses: CodSpeedHQ/action@",
          "continue-on-error: ${{ vars.CODSPEED_REQUIRED != 'true' }}\n        continue-on-error: true\n        uses: CodSpeedHQ/action@",
        ),
      ],
      [
        'cpu upload cannot be skipped',
        workflow.replace(
          'name: Record deterministic CPU trends\n',
          'name: Record deterministic CPU trends\n        if: false\n',
        ),
      ],
      [
        'cpu upload cannot use a quoted skip key',
        workflow.replace(
          'name: Record deterministic CPU trends\n',
          'name: Record deterministic CPU trends\n        "if": false\n',
        ),
      ],
      [
        'cpu mode cannot use an env decoy',
        workflow.replace(
          'with:\n          mode: simulation',
          'env:\n          mode: simulation\n        with:\n          mode: instrumentation',
        ),
      ],
      [
        'memory staged upload policy',
        workflow.replace(
          "name: Record allocation trends\n        continue-on-error: ${{ vars.CODSPEED_REQUIRED != 'true' }}",
          'name: Record allocation trends\n        continue-on-error: true',
        ),
      ],
      [
        'memory PR guard',
        workflow.replace("if: github.event_name != 'pull_request'", 'if: always()'),
      ],
      [
        'memory PR guard cannot use a step decoy',
        workflow
          .replace("if: github.event_name != 'pull_request'", 'if: always()')
          .replace(
            'memory:\n    name: CodSpeed Allocations\n    if: always()\n    runs-on: ubuntu-latest\n    steps:\n      - uses:',
            "memory:\n    name: CodSpeed Allocations\n    if: always()\n    runs-on: ubuntu-latest\n    steps:\n      - name: Guard decoy\n        if: github.event_name != 'pull_request'\n        run: true\n      - uses:",
          ),
      ],
      ['memory mode', workflow.replace('mode: memory', 'mode: simulation')],
      [
        'memory command',
        workflow.replace(
          'mode: memory\n          run: npm run test:bench:codspeed',
          'mode: memory\n          run: npm run test:bench',
        ),
      ],
      [
        'memory job cannot soft-fail',
        workflow.replace(
          'memory:\n    name: CodSpeed Allocations',
          'memory:\n    name: CodSpeed Allocations\n    continue-on-error: true',
        ),
      ],
      [
        'memory job cannot use a quoted soft-fail key',
        workflow.replace(
          'memory:\n    name: CodSpeed Allocations',
          'memory:\n    name: CodSpeed Allocations\n    "continue-on-error": true',
        ),
      ],
      [
        'cpu harness cannot use a quoted soft-fail key',
        workflow.replace(
          'name: Validate deterministic CPU benchmark harness\n',
          'name: Validate deterministic CPU benchmark harness\n        "continue-on-error": true\n',
        ),
      ],
      [
        'cpu job controls cannot hide after steps',
        workflow.replace(
          '          run: npm run test:bench:codspeed\n\n  memory:',
          '          run: npm run test:bench:codspeed\n    if: false\n\n  memory:',
        ),
      ],
    ] as const) {
      expect(mutated, `${label} mutation must change the workflow`).not.toBe(workflow);
      expect(findCodspeedWorkflowViolations(mutated), label).not.toEqual([]);
    }
  });

  it('pins nightly property, mutation, leak and five/thirty-minute browser soaks', () => {
    const workflow = readRepositoryFile('.github/workflows/deep-quality.yml');
    expect(findDeepQualityWorkflowViolations(workflow)).toEqual([]);

    for (const [label, mutated] of [
      ['property volume', workflow.replace('PLP_PROPERTY_RUNS: 10000', 'PLP_PROPERTY_RUNS: 1000')],
      ['property seed', workflow.replace('${{ github.run_id }}', '42')],
      [
        'property seed log',
        workflow.replace('echo "PLP_PROPERTY_SEED=$PLP_PROPERTY_SEED"', 'echo hidden'),
      ],
      ['property command', workflow.replace('npm run test:property', 'npm run test')],
      ['Stryker scope', workflow.replace('STRYKER_SCOPE: nightly', 'STRYKER_SCOPE: pr')],
      ['mutation command', workflow.replace('npm run test:mutation', 'npm run test')],
      [
        'mutation baseline policy',
        workflow.replace('npm run test:mutation:policy', 'npm run test:mutation'),
      ],
      ['leak command', workflow.replace('npm run test:leak', 'npm run test')],
      ['Sunday duration', workflow.replace("'1800000'", "'300000'")],
      ['weekday duration', workflow.replace("'300000'", "'60000'")],
      [
        'fixture clean install',
        workflow.replace(
          'npm ci --no-audit --no-fund --prefix examples/astro-payload',
          'npm install --no-audit --no-fund --prefix examples/astro-payload',
        ),
      ],
      ['soak command', workflow.replace('npm run test:soak', 'npm run test:e2e')],
    ] as const) {
      expect(findDeepQualityWorkflowViolations(mutated), label).not.toEqual([]);
    }
  });

  it('pins every remote GitHub Action to an immutable commit SHA', () => {
    const workflows = readdirSync(resolve(process.cwd(), '.github/workflows'))
      .filter((name) => /\.ya?ml$/u.test(name))
      .sort()
      .map((name) => ({
        name,
        source: readRepositoryFile(`.github/workflows/${name}`),
      }));
    expect(findWorkflowActionPinViolations(workflows)).toEqual([]);

    const checkoutWorkflow = workflows.find(({ source }) => source.includes('actions/checkout@'));
    expect(checkoutWorkflow).toBeDefined();
    const mutated = workflows.map((workflow) =>
      workflow === checkoutWorkflow
        ? {
            ...workflow,
            source: workflow.source.replace(
              /actions\/checkout@[0-9a-f]{40}/iu,
              'actions/checkout@v4',
            ),
          }
        : workflow,
    );
    expect(findWorkflowActionPinViolations(mutated)).toEqual([
      expect.stringContaining('actions/checkout@v4'),
    ]);
  });
});
