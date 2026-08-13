/** Contracts for scheduled performance, mutation, property and soak workflows. */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function jobBlock(workflow: string, job: string): string | undefined {
  const start = workflow.indexOf(`  ${job}:\n`);
  if (start < 0) return undefined;
  const followingJob = workflow.slice(start + 1).search(/\n {2}[A-Za-z0-9_-]+:\n/u);
  const end = followingJob < 0 ? workflow.length : start + 1 + followingJob;
  return workflow.slice(start, end);
}

function requireMatch(
  violations: string[],
  source: string | undefined,
  pattern: RegExp,
  message: string,
): void {
  if (source === undefined || !pattern.test(source)) violations.push(message);
}

export interface WorkflowSource {
  readonly name: string;
  readonly source: string;
}

/** Every remote action is content-addressed; repository-local actions are exempt. */
export function findWorkflowActionPinViolations(
  workflows: readonly WorkflowSource[],
): readonly string[] {
  const violations: string[] = [];
  for (const workflow of workflows) {
    for (const [index, line] of workflow.source.split('\n').entries()) {
      const match = /^\s*(?:-\s*)?uses:\s*([^\s#]+)/u.exec(line);
      if (match === null) continue;
      const action = match[1]!.replace(/^['"]|['"]$/gu, '');
      if (action.startsWith('./')) continue;
      const separator = action.lastIndexOf('@');
      const revision = separator < 0 ? '' : action.slice(separator + 1);
      if (!/^[0-9a-f]{40}$/iu.test(revision)) {
        violations.push(
          `${workflow.name}:${String(index + 1)} remote action is not pinned to a 40-hex commit: ${action}`,
        );
      }
    }
  }
  return violations;
}

export function findCodspeedWorkflowViolations(workflow: string): readonly string[] {
  const violations: string[] = [];
  const cpu = jobBlock(workflow, 'cpu');
  const memory = jobBlock(workflow, 'memory');

  requireMatch(violations, cpu, /^\s+mode:\s*simulation\s*$/mu, 'cpu job must use simulation mode');
  requireMatch(
    violations,
    cpu,
    /^\s+run:\s*npm run test:bench:codspeed\s*$/mu,
    'cpu job must run the CodSpeed benchmark suite',
  );
  requireMatch(
    violations,
    memory,
    /^\s+if:\s*github\.event_name != 'pull_request'\s*$/mu,
    'memory job must stay disabled for pull requests',
  );
  requireMatch(violations, memory, /^\s+mode:\s*memory\s*$/mu, 'memory job must use memory mode');
  requireMatch(
    violations,
    memory,
    /^\s+run:\s*npm run test:bench:codspeed\s*$/mu,
    'memory job must run the CodSpeed benchmark suite',
  );
  return violations;
}

export function findDeepQualityWorkflowViolations(workflow: string): readonly string[] {
  const violations: string[] = [];
  const mutation = jobBlock(workflow, 'mutation-and-properties');
  const leak = jobBlock(workflow, 'node-leak-soak');
  const browser = jobBlock(workflow, 'browser-soak');

  requireMatch(
    violations,
    workflow,
    /^\s+- cron:\s*'17 2 \* \* 1-6'\s*$/mu,
    'deep quality must schedule the five-minute Monday-Saturday soak',
  );
  requireMatch(
    violations,
    workflow,
    /^\s+- cron:\s*'17 2 \* \* 0'\s*$/mu,
    'deep quality must schedule the thirty-minute Sunday soak',
  );
  requireMatch(
    violations,
    mutation,
    /^\s+PLP_PROPERTY_RUNS:\s*10000\s*$/mu,
    'nightly property exploration must run 10,000 cases per property',
  );
  requireMatch(
    violations,
    mutation,
    /^\s+PLP_PROPERTY_SEED:\s*\$\{\{ github\.run_id \}\}\s*$/mu,
    'nightly property exploration must rotate and record a run-specific seed',
  );
  requireMatch(
    violations,
    mutation,
    /^\s+echo "PLP_PROPERTY_SEED=\$PLP_PROPERTY_SEED"\s*$/mu,
    'nightly property exploration must print its replay seed',
  );
  requireMatch(
    violations,
    mutation,
    /^\s+npm run test:property\s*$/mu,
    'nightly property exploration command is missing',
  );
  requireMatch(
    violations,
    mutation,
    /^\s+STRYKER_SCOPE:\s*nightly\s*$/mu,
    'nightly Stryker scope is missing',
  );
  requireMatch(
    violations,
    mutation,
    /^\s+run:\s*npm run test:mutation\s*$/mu,
    'nightly mutation command is missing',
  );
  requireMatch(
    violations,
    mutation,
    /^\s+run:\s*npm run test:mutation:policy\s*$/mu,
    'nightly mutation baseline policy is missing',
  );
  requireMatch(violations, leak, /^\s+run:\s*npm run test:leak\s*$/mu, 'node leak gate is missing');
  requireMatch(
    violations,
    browser,
    /^\s+PLP_SOAK_DURATION_MS:\s*\$\{\{ github\.event\.schedule == '17 2 \* \* 0' && '1800000' \|\| '300000' \}\}\s*$/mu,
    'browser soak must retain five-minute and thirty-minute durations',
  );
  requireMatch(
    violations,
    browser,
    /^\s+run:\s*npm run test:soak\s*$/mu,
    'browser soak command is missing',
  );
  return violations;
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const workflowDirectory = resolve(repositoryRoot, '.github/workflows');
  const workflowNames = (await readdir(workflowDirectory))
    .filter((name) => /\.ya?ml$/u.test(name))
    .sort();
  const workflows = await Promise.all(
    workflowNames.map(async (name) => ({
      name,
      source: await readFile(resolve(workflowDirectory, name), 'utf8'),
    })),
  );
  const codspeed = workflows.find(({ name }) => name === 'codspeed.yml')?.source ?? '';
  const deepQuality = workflows.find(({ name }) => name === 'deep-quality.yml')?.source ?? '';
  const violations = [
    ...findCodspeedWorkflowViolations(codspeed),
    ...findDeepQualityWorkflowViolations(deepQuality),
    ...findWorkflowActionPinViolations(workflows),
  ];
  if (violations.length > 0) {
    throw new Error(
      `quality workflow policy failed:\n${violations.map((violation) => `- ${violation}`).join('\n')}`,
    );
  }
  console.log(
    'Quality workflow policy passed: immutable Actions, CodSpeed and deep-quality gates are fail-closed.',
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
