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

function namedStepBlock(job: string | undefined, name: string): string | undefined {
  if (job === undefined) return undefined;
  const marker = `      - name: ${name}\n`;
  const start = job.indexOf(marker);
  if (start < 0) return undefined;
  const followingStep = job.slice(start + 1).search(/\n {6}- /u);
  const end = followingStep < 0 ? job.length : start + 1 + followingStep;
  return job.slice(start, end);
}

function stepMappingBlock(step: string | undefined, key: string): string | undefined {
  if (step === undefined) return undefined;
  const marker = `        ${key}:\n`;
  const start = step.indexOf(marker);
  if (start < 0) return undefined;
  const followingRootKey = step.slice(start + 1).search(/\n {8}[A-Za-z0-9_-]+:/u);
  const end = followingRootKey < 0 ? step.length : start + 1 + followingRootKey;
  return step.slice(start, end);
}

function requireMatch(
  violations: string[],
  source: string | undefined,
  pattern: RegExp,
  message: string,
): void {
  if (source === undefined || !pattern.test(source)) violations.push(message);
}

function forbidMatch(
  violations: string[],
  source: string | undefined,
  pattern: RegExp,
  message: string,
): void {
  if (source === undefined || pattern.test(source)) violations.push(message);
}

function requireSingleLine(
  violations: string[],
  source: string | undefined,
  expected: RegExp,
  key: RegExp,
  message: string,
): void {
  const matches = source?.match(key) ?? [];
  if (source === undefined || matches.length !== 1 || !expected.test(source)) {
    violations.push(message);
  }
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
  const cpuHarness = namedStepBlock(cpu, 'Validate deterministic CPU benchmark harness');
  const cpuUpload = namedStepBlock(cpu, 'Record deterministic CPU trends');
  const memoryUpload = namedStepBlock(memory, 'Record allocation trends');
  const cpuUploadWith = stepMappingBlock(cpuUpload, 'with');
  const memoryUploadWith = stepMappingBlock(memoryUpload, 'with');

  requireSingleLine(
    violations,
    cpu,
    /^ {6}- name:\s*Validate deterministic CPU benchmark harness\s*$/mu,
    /^ {6}- name:\s*Validate deterministic CPU benchmark harness\s*$/gmu,
    'cpu benchmark harness step must exist exactly once',
  );
  requireSingleLine(
    violations,
    cpu,
    /^ {6}- name:\s*Record deterministic CPU trends\s*$/mu,
    /^ {6}- name:\s*Record deterministic CPU trends\s*$/gmu,
    'cpu upload step must exist exactly once',
  );
  requireSingleLine(
    violations,
    memory,
    /^ {6}- name:\s*Record allocation trends\s*$/mu,
    /^ {6}- name:\s*Record allocation trends\s*$/gmu,
    'memory upload step must exist exactly once',
  );
  forbidMatch(
    violations,
    cpu,
    /^ {4}(?:"(?:if|continue-on-error)"|'(?:if|continue-on-error)'|(?:if|continue-on-error)):/mu,
    'cpu job must not be conditional or soft-failing',
  );
  forbidMatch(
    violations,
    memory,
    /^ {4}(?:"continue-on-error"|'continue-on-error'|continue-on-error):/mu,
    'memory job must not be soft-failing',
  );
  requireSingleLine(
    violations,
    cpuHarness,
    /^ {8}run:\s*npm run test:bench:codspeed\s*$/mu,
    /^ {8}(?:"run"|'run'|run):.*$/gmu,
    'cpu benchmark harness must remain a hard workflow step',
  );
  requireSingleLine(
    violations,
    cpuHarness,
    /^ {8}shell:\s*bash\s*$/mu,
    /^ {8}(?:"shell"|'shell'|shell):.*$/gmu,
    'cpu benchmark harness must use the explicit bash shell',
  );
  forbidMatch(
    violations,
    cpuHarness,
    /^ {8}(?:"(?:uses|if|continue-on-error)"|'(?:uses|if|continue-on-error)'|(?:uses|if|continue-on-error)):/mu,
    'cpu benchmark harness must not be conditional or soft-failing',
  );
  requireSingleLine(
    violations,
    cpuUpload,
    /^ {8}uses:\s*CodSpeedHQ\/action@[0-9a-f]{40}\s*(?:#.*)?$/mu,
    /^ {8}(?:"uses"|'uses'|uses):.*$/gmu,
    'cpu trends must use the immutable CodSpeed action',
  );
  requireSingleLine(
    violations,
    cpuUpload,
    /^ {8}with:\s*$/mu,
    /^ {8}(?:"with"|'with'|with):.*$/gmu,
    'cpu upload must have exactly one action input mapping',
  );
  requireSingleLine(
    violations,
    cpuUploadWith,
    /^ {10}mode:\s*simulation\s*$/mu,
    /^ {10}(?:"mode"|'mode'|mode):.*$/gmu,
    'cpu job must use simulation mode',
  );
  requireSingleLine(
    violations,
    cpuUploadWith,
    /^ {10}run:\s*npm run test:bench:codspeed\s*$/mu,
    /^ {10}(?:"run"|'run'|run):.*$/gmu,
    'cpu job must run the CodSpeed benchmark suite',
  );
  forbidMatch(
    violations,
    cpuUpload,
    /^ {8}(?:"if"|'if'|if):/mu,
    'cpu upload step must not be conditionally skipped',
  );
  requireSingleLine(
    violations,
    cpuUpload,
    /^ {8}continue-on-error:\s*\$\{\{\s*vars\.CODSPEED_REQUIRED\s*!=\s*'true'\s*\}\}\s*$/mu,
    /^ {8}(?:"continue-on-error"|'continue-on-error'|continue-on-error):.*$/gmu,
    'cpu upload must use the reviewed CodSpeed onboarding policy',
  );
  requireSingleLine(
    violations,
    memory,
    /^ {4}if:\s*github\.event_name != 'pull_request'\s*$/mu,
    /^ {4}(?:"if"|'if'|if):.*$/gmu,
    'memory job must stay disabled for pull requests',
  );
  requireSingleLine(
    violations,
    memoryUpload,
    /^ {8}uses:\s*CodSpeedHQ\/action@[0-9a-f]{40}\s*(?:#.*)?$/mu,
    /^ {8}(?:"uses"|'uses'|uses):.*$/gmu,
    'memory trends must use the immutable CodSpeed action',
  );
  requireSingleLine(
    violations,
    memoryUpload,
    /^ {8}with:\s*$/mu,
    /^ {8}(?:"with"|'with'|with):.*$/gmu,
    'memory upload must have exactly one action input mapping',
  );
  requireSingleLine(
    violations,
    memoryUploadWith,
    /^ {10}mode:\s*memory\s*$/mu,
    /^ {10}(?:"mode"|'mode'|mode):.*$/gmu,
    'memory job must use memory mode',
  );
  forbidMatch(
    violations,
    memoryUpload,
    /^ {8}(?:"if"|'if'|if):/mu,
    'memory upload step must not be conditionally skipped',
  );
  requireSingleLine(
    violations,
    memoryUpload,
    /^ {8}continue-on-error:\s*\$\{\{\s*vars\.CODSPEED_REQUIRED\s*!=\s*'true'\s*\}\}\s*$/mu,
    /^ {8}(?:"continue-on-error"|'continue-on-error'|continue-on-error):.*$/gmu,
    'memory upload must use the reviewed CodSpeed onboarding policy',
  );
  requireSingleLine(
    violations,
    memoryUploadWith,
    /^ {10}run:\s*npm run test:bench:codspeed\s*$/mu,
    /^ {10}(?:"run"|'run'|run):.*$/gmu,
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
    /^\s+- run:\s*npm ci --no-audit --no-fund --prefix examples\/astro-payload\s*$/mu,
    'browser soak must clean-install the Astro fixture',
  );
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
    'Quality workflow policy passed: immutable Actions, the CodSpeed harness and staged upload policy, and deep-quality gates are pinned.',
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
