/**
 * Structural contracts for the GitHub workflows, checked on parsed YAML.
 * A required step must exist exactly once with its exact `run`/`uses`, may
 * not carry a condition, and may only use shell operators when whitelisted.
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { WORKFLOW_EXPECTATIONS } from './workflow-expectations';

export type YamlRecord = Record<string, unknown>;

export interface RunStepSpec {
  readonly run: string;
  readonly name?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly shell?: string;
  readonly continueOnError?: string;
  /** Reviewed compound script: `||`, `;`, `&&` and newlines are allowed. */
  readonly operators?: true;
}

export interface UsesStepSpec {
  readonly uses: string;
  readonly name?: string;
  readonly with?: Readonly<Record<string, string>>;
  readonly continueOnError?: string;
}

export type StepSpec = RunStepSpec | UsesStepSpec;

export interface JobSpec {
  readonly if?: string;
  readonly needs?: readonly string[];
  readonly timeoutMinutes?: number;
  readonly permissions?: YamlRecord;
  readonly matrix?: Readonly<Record<string, readonly (string | number)[]>>;
  readonly continueOnError?: string;
  readonly steps?: readonly StepSpec[];
  readonly uses?: string;
  readonly with?: Readonly<Record<string, string>>;
}

export interface WorkflowSpec {
  readonly name: string;
  readonly on?: unknown;
  readonly permissions?: unknown;
  readonly concurrency?: unknown;
  readonly jobs: Readonly<Record<string, JobSpec>>;
}

export interface WorkflowDocument {
  readonly name: string;
  readonly document: YamlRecord;
}

const SHELL_OPERATORS = /\|\||;|&&|\n/u;
const PINNED_ACTION = /^[^@\s]+@[0-9a-f]{40}$/u;

function isRecord(value: unknown): value is YamlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeExpression(value: unknown): string {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function normalizeRun(value: unknown): string {
  return String(value)
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function actionName(reference: unknown): string {
  const text = String(reference);
  const at = text.lastIndexOf('@');
  return at < 0 ? text : text.slice(0, at);
}

export function parseWorkflow(source: string): YamlRecord {
  const document: unknown = parse(source);
  if (!isRecord(document)) throw new Error('workflow is not a YAML mapping');
  return document;
}

function jobs(document: YamlRecord): YamlRecord {
  return isRecord(document['jobs']) ? document['jobs'] : {};
}

function steps(job: YamlRecord): readonly YamlRecord[] {
  return Array.isArray(job['steps']) ? job['steps'].filter(isRecord) : [];
}

/** The matrix values of a job, for contracts that mirror the CI matrix elsewhere. */
export function matrixValues(
  document: YamlRecord,
  jobName: string,
  key: string,
): readonly unknown[] {
  const job = jobs(document)[jobName];
  const strategy = isRecord(job) ? job['strategy'] : undefined;
  const matrix = isRecord(strategy) ? strategy['matrix'] : undefined;
  const values = isRecord(matrix) ? matrix[key] : undefined;
  return Array.isArray(values) ? values : [];
}

/** Every remote action and reusable workflow is pinned to a full commit SHA. */
export function findActionPinViolations(workflows: readonly WorkflowDocument[]): readonly string[] {
  const violations: string[] = [];
  for (const workflow of workflows) {
    for (const [jobName, job] of Object.entries(jobs(workflow.document))) {
      if (!isRecord(job)) continue;
      const references = [job['uses'], ...steps(job).map((step) => step['uses'])];
      for (const reference of references) {
        if (typeof reference !== 'string' || reference.startsWith('./')) continue;
        if (!PINNED_ACTION.test(reference)) {
          violations.push(`${workflow.name} job ${jobName} uses an unpinned action: ${reference}`);
        }
      }
    }
  }
  return violations;
}

function matchesStep(step: YamlRecord, spec: StepSpec): boolean {
  if (spec.name !== undefined && step['name'] !== spec.name) return false;
  if ('run' in spec) {
    return step['run'] !== undefined && normalizeRun(step['run']) === normalizeRun(spec.run);
  }
  if (step['uses'] === undefined || actionName(step['uses']) !== spec.uses) return false;
  const name = spec.with?.['name'];
  const withBlock = isRecord(step['with']) ? step['with'] : {};
  return name === undefined || String(withBlock['name']) === name;
}

function describeStep(spec: StepSpec): string {
  return 'run' in spec
    ? `run "${normalizeRun(spec.run).split('\n')[0] ?? ''}"`
    : `uses ${spec.uses}`;
}

function checkStep(step: YamlRecord, spec: StepSpec, label: string, violations: string[]): void {
  if (step['if'] !== undefined) violations.push(`${label} is conditional`);
  const continueOnError = step['continue-on-error'];
  if (spec.continueOnError === undefined) {
    if (continueOnError !== undefined) violations.push(`${label} may fail without failing the job`);
  } else if (normalizeExpression(continueOnError) !== spec.continueOnError) {
    violations.push(`${label} does not use the reviewed continue-on-error policy`);
  }
  const mapping = 'run' in spec ? ['env', spec.env] : ['with', spec.with];
  const [key, expected] = mapping as [string, Readonly<Record<string, string>> | undefined];
  const actual = isRecord(step[key]) ? step[key] : {};
  for (const [name, value] of Object.entries(expected ?? {})) {
    if (
      actual[name] === undefined ||
      normalizeExpression(actual[name]) !== normalizeExpression(value)
    ) {
      violations.push(`${label} ${key}.${name} is not ${JSON.stringify(value)}`);
    }
  }
  if ('run' in spec) {
    if (spec.shell !== undefined && step['shell'] !== spec.shell) {
      violations.push(`${label} does not use shell ${spec.shell}`);
    }
    if (spec.operators === undefined && SHELL_OPERATORS.test(normalizeRun(spec.run))) {
      violations.push(`${label} uses shell operators without a reviewed whitelist`);
    }
  }
}

function checkSteps(
  job: YamlRecord,
  spec: readonly StepSpec[],
  jobLabel: string,
  violations: string[],
): void {
  const actual = steps(job);
  let previousIndex = -1;
  for (const stepSpec of spec) {
    const label = `${jobLabel} step ${describeStep(stepSpec)}`;
    const matches = actual
      .map((step, index) => [step, index] as const)
      .filter(([step]) => matchesStep(step, stepSpec));
    if (matches.length !== 1) {
      violations.push(`${label} must exist exactly once (found ${String(matches.length)})`);
      continue;
    }
    const [step, index] = matches[0]!;
    if (index < previousIndex) violations.push(`${label} is out of the reviewed order`);
    previousIndex = index;
    checkStep(step, stepSpec, label, violations);
  }
}

function checkJob(job: unknown, spec: JobSpec, label: string, violations: string[]): void {
  if (!isRecord(job)) {
    violations.push(`${label} is missing`);
    return;
  }
  if (spec.if === undefined) {
    if (job['if'] !== undefined) violations.push(`${label} is conditional`);
  } else if (normalizeExpression(job['if']) !== normalizeExpression(spec.if)) {
    violations.push(`${label} does not use the reviewed condition`);
  }
  if (spec.continueOnError === undefined) {
    if (job['continue-on-error'] !== undefined) violations.push(`${label} permits failures`);
  } else if (normalizeExpression(job['continue-on-error']) !== spec.continueOnError) {
    violations.push(`${label} does not use the reviewed continue-on-error policy`);
  }
  if (spec.needs !== undefined) {
    const needs = Array.isArray(job['needs'])
      ? job['needs']
      : job['needs'] === undefined
        ? []
        : [job['needs']];
    if (canonical(needs) !== canonical(spec.needs)) {
      violations.push(`${label} does not depend on ${spec.needs.join(', ')}`);
    }
  }
  if (spec.timeoutMinutes !== undefined && job['timeout-minutes'] !== spec.timeoutMinutes) {
    violations.push(`${label} does not set timeout-minutes ${String(spec.timeoutMinutes)}`);
  }
  if (
    spec.permissions !== undefined &&
    canonical(job['permissions']) !== canonical(spec.permissions)
  ) {
    violations.push(`${label} does not declare the reviewed permissions`);
  }
  if (spec.matrix !== undefined) {
    const strategy = isRecord(job['strategy']) ? job['strategy'] : {};
    if (canonical(strategy['matrix']) !== canonical(spec.matrix)) {
      violations.push(`${label} does not run the reviewed matrix`);
    }
  }
  if (spec.uses !== undefined) {
    if (job['uses'] !== spec.uses) violations.push(`${label} does not call ${spec.uses}`);
    const withBlock = isRecord(job['with']) ? job['with'] : {};
    for (const [key, value] of Object.entries(spec.with ?? {})) {
      if (
        withBlock[key] === undefined ||
        normalizeExpression(withBlock[key]) !== normalizeExpression(value)
      ) {
        violations.push(`${label} with.${key} is not ${JSON.stringify(value)}`);
      }
    }
  }
  if (spec.steps !== undefined) checkSteps(job, spec.steps, label, violations);
}

export function findWorkflowViolations(
  name: string,
  document: YamlRecord,
  spec: WorkflowSpec,
): readonly string[] {
  const violations: string[] = [];
  if (document['name'] !== spec.name) violations.push(`${name} is not named ${spec.name}`);
  for (const key of ['on', 'permissions', 'concurrency'] as const) {
    if (spec[key] !== undefined && canonical(document[key]) !== canonical(spec[key])) {
      violations.push(`${name} ${key} differs from the reviewed contract`);
    }
  }
  for (const [jobName, jobSpec] of Object.entries(spec.jobs)) {
    checkJob(jobs(document)[jobName], jobSpec, `${name} job ${jobName}`, violations);
  }
  return violations;
}

/** Every workflow under `.github/workflows`, keyed by file name. */
export function findWorkflowContractViolations(
  sources: ReadonlyMap<string, string>,
): readonly string[] {
  const documents: WorkflowDocument[] = [];
  const violations: string[] = [];
  for (const [name, source] of [...sources].sort(([left], [right]) => left.localeCompare(right))) {
    try {
      documents.push({ name, document: parseWorkflow(source) });
    } catch (error: unknown) {
      violations.push(
        `${name} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  violations.push(...findActionPinViolations(documents));
  for (const [name, spec] of Object.entries(WORKFLOW_EXPECTATIONS)) {
    const document = documents.find((candidate) => candidate.name === name);
    if (document === undefined) {
      violations.push(`${name} is missing`);
      continue;
    }
    violations.push(...findWorkflowViolations(name, document.document, spec));
  }
  return violations;
}

export async function readWorkflowSources(
  repositoryRoot: string,
): Promise<ReadonlyMap<string, string>> {
  const directory = resolve(repositoryRoot, '.github/workflows');
  const names = (await readdir(directory)).filter((name) => /\.ya?ml$/u.test(name)).sort();
  const sources = new Map<string, string>();
  for (const name of names) sources.set(name, await readFile(resolve(directory, name), 'utf8'));
  return sources;
}

async function main(): Promise<void> {
  const violations = findWorkflowContractViolations(
    await readWorkflowSources(resolve(import.meta.dirname, '..')),
  );
  if (violations.length > 0) {
    throw new Error(
      `workflow contracts failed:\n${violations.map((violation) => `- ${violation}`).join('\n')}`,
    );
  }
  console.log(
    `Workflow contracts passed: ${String(Object.keys(WORKFLOW_EXPECTATIONS).length)} workflows pinned.`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
