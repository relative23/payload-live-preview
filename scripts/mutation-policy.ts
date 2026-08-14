/** Fail-closed validation and monotonic ratcheting for a Stryker JSON report. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TERMINAL_STATUSES = new Set([
  'CompileError',
  'Ignored',
  'Killed',
  'NoCoverage',
  'RuntimeError',
  'Survived',
  'Timeout',
]);

export interface MutationPolicy {
  /** Parsed from JSON and validated at runtime before any baseline comparison. */
  readonly schemaVersion: number;
  readonly profile: string;
  readonly report: {
    readonly schemaVersion: string;
    readonly framework: {
      readonly name: string;
      readonly version: string;
    };
    readonly strykerConfigFile: string;
    readonly vitestConfigFile: string;
    readonly testRunner: string;
    readonly coverageAnalysis: string;
    readonly incremental: false;
    readonly thresholds: {
      readonly high: number;
      readonly low: number;
      readonly break: number;
    };
  };
  readonly scope: readonly string[];
  readonly baseline: {
    /** Any change requires review so scope growth and code reduction stay explicit. */
    readonly total: number;
    /** Equal to the reviewed rounded baseline; an increase must be ratcheted explicitly. */
    readonly mutationScoreMinimum: number;
    readonly mutationScorePrecision: number;
    readonly noCoverageMaximum: number;
    readonly timeoutMaximum: number;
    readonly errorMaximum: number;
    readonly ignoredMaximum: number;
  };
}

export interface MutationSummary {
  readonly total: number;
  readonly killed: number;
  readonly survived: number;
  readonly noCoverage: number;
  readonly timeout: number;
  readonly errors: number;
  readonly ignored: number;
  readonly mutationScore: number;
}

export interface MutationPolicyResult {
  readonly summary: MutationSummary;
  readonly violations: readonly string[];
}

interface ParsedMutationReport {
  readonly schemaVersion: string;
  readonly frameworkName: string;
  readonly frameworkVersion: string;
  readonly configFile: string;
  readonly configuredScope: readonly string[];
  readonly testRunner: string;
  readonly vitestConfigFile: string;
  readonly vitestRelated: boolean;
  readonly coverageAnalysis: string;
  readonly incremental: boolean;
  readonly thresholds: {
    readonly high: number;
    readonly low: number;
    readonly break: number | null;
  };
  readonly excludedMutations: readonly unknown[];
  readonly ignorers: readonly unknown[];
  readonly fileStatuses: ReadonlyMap<string, readonly string[]>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  return arrayValue(value, label).map((entry, index) =>
    stringValue(entry, `${label}[${String(index)}]`),
  );
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function sortedUniquePaths(paths: readonly string[], label: string): readonly string[] {
  const normalized = paths.map(normalizePath);
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) throw new Error(`${label} contains duplicate paths`);
  return [...unique].sort((left, right) => left.localeCompare(right));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatList(values: readonly string[]): string {
  return `[${values.join(', ')}]`;
}

function parseMutationReport(input: unknown): ParsedMutationReport {
  const report = record(input, 'mutation report');
  const framework = record(report['framework'], 'mutation report.framework');
  const config = record(report['config'], 'mutation report.config');
  const vitest = record(config['vitest'], 'mutation report.config.vitest');
  const mutator = record(config['mutator'], 'mutation report.config.mutator');
  const thresholds = record(config['thresholds'], 'mutation report.config.thresholds');
  const files = record(report['files'], 'mutation report.files');
  const fileStatuses = new Map<string, readonly string[]>();

  for (const [rawPath, rawFile] of Object.entries(files)) {
    const path = normalizePath(rawPath);
    if (fileStatuses.has(path)) throw new Error(`mutation report has duplicate file ${path}`);
    const file = record(rawFile, `mutation report.files[${rawPath}]`);
    const mutants = arrayValue(file['mutants'], `mutation report.files[${rawPath}].mutants`);
    const statuses = mutants.map((rawMutant, index) => {
      const mutant = record(
        rawMutant,
        `mutation report.files[${rawPath}].mutants[${String(index)}]`,
      );
      return stringValue(
        mutant['status'],
        `mutation report.files[${rawPath}].mutants[${String(index)}].status`,
      );
    });
    fileStatuses.set(path, statuses);
  }

  return {
    schemaVersion: stringValue(report['schemaVersion'], 'mutation report.schemaVersion'),
    frameworkName: stringValue(framework['name'], 'mutation report.framework.name'),
    frameworkVersion: stringValue(framework['version'], 'mutation report.framework.version'),
    configFile: stringValue(config['configFile'], 'mutation report.config.configFile'),
    configuredScope: stringArray(config['mutate'], 'mutation report.config.mutate'),
    testRunner: stringValue(config['testRunner'], 'mutation report.config.testRunner'),
    vitestConfigFile: stringValue(vitest['configFile'], 'mutation report.config.vitest.configFile'),
    vitestRelated: booleanValue(vitest['related'], 'mutation report.config.vitest.related'),
    coverageAnalysis: stringValue(
      config['coverageAnalysis'],
      'mutation report.config.coverageAnalysis',
    ),
    incremental: booleanValue(config['incremental'], 'mutation report.config.incremental'),
    thresholds: {
      high: numberValue(thresholds['high'], 'mutation report.config.thresholds.high'),
      low: numberValue(thresholds['low'], 'mutation report.config.thresholds.low'),
      break:
        thresholds['break'] === null
          ? null
          : numberValue(thresholds['break'], 'mutation report.config.thresholds.break'),
    },
    excludedMutations: arrayValue(
      mutator['excludedMutations'],
      'mutation report.config.mutator.excludedMutations',
    ),
    ignorers: arrayValue(config['ignorers'], 'mutation report.config.ignorers'),
    fileStatuses,
  };
}

function summarizeParsedReport(report: ParsedMutationReport): MutationSummary {
  const counts = {
    killed: 0,
    survived: 0,
    noCoverage: 0,
    timeout: 0,
    errors: 0,
    ignored: 0,
  };

  for (const statuses of report.fileStatuses.values()) {
    for (const status of statuses) {
      if (!TERMINAL_STATUSES.has(status)) {
        throw new Error(
          `unsupported mutant status ${status}; report is incomplete or incompatible`,
        );
      }
      switch (status) {
        case 'Killed':
          counts.killed += 1;
          break;
        case 'Survived':
          counts.survived += 1;
          break;
        case 'NoCoverage':
          counts.noCoverage += 1;
          break;
        case 'Timeout':
          counts.timeout += 1;
          break;
        case 'CompileError':
        case 'RuntimeError':
          counts.errors += 1;
          break;
        case 'Ignored':
          counts.ignored += 1;
          break;
      }
    }
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const scored = counts.killed + counts.timeout + counts.survived + counts.noCoverage;
  const mutationScore = scored === 0 ? 100 : ((counts.killed + counts.timeout) / scored) * 100;
  return { total, ...counts, mutationScore };
}

export function summarizeMutationReport(input: unknown): MutationSummary {
  return summarizeParsedReport(parseMutationReport(input));
}

function rounded(value: number, precision: number): number {
  return Number(value.toFixed(precision));
}

function compareRatchetedMaximum(
  violations: string[],
  label: string,
  observed: number,
  maximum: number,
): void {
  if (observed > maximum) {
    violations.push(
      `[regression] ${label} ${String(observed)} exceed reviewed maximum ${String(maximum)}`,
    );
  } else if (observed < maximum) {
    violations.push(
      `[improvement] ${label} improved from ${String(maximum)} to ${String(observed)}; ratchet the policy`,
    );
  }
}

export function evaluateMutationReport(
  input: unknown,
  policy: MutationPolicy,
): MutationPolicyResult {
  const report = parseMutationReport(input);
  const summary = summarizeParsedReport(report);
  const violations: string[] = [];

  if (policy.schemaVersion !== 1) {
    violations.push(
      `[policy] unsupported policy schemaVersion ${String(policy.schemaVersion)}; expected 1`,
    );
  }
  if (policy.profile !== 'pr-critical' && policy.profile !== 'nightly-critical') {
    violations.push(`[policy] unsupported mutation profile ${policy.profile}`);
  }
  const expectedScope = sortedUniquePaths(policy.scope, 'mutation policy scope');
  const configuredScope = sortedUniquePaths(report.configuredScope, 'configured mutation scope');
  const reportedScope = sortedUniquePaths([...report.fileStatuses.keys()], 'reported file scope');

  if (report.schemaVersion !== policy.report.schemaVersion) {
    violations.push(
      `[profile] report schema differs: expected ${policy.report.schemaVersion}, got ${report.schemaVersion}`,
    );
  }
  if (
    report.frameworkName !== policy.report.framework.name ||
    report.frameworkVersion !== policy.report.framework.version
  ) {
    violations.push(
      `[profile] framework differs: expected ${policy.report.framework.name}@${policy.report.framework.version}, got ${report.frameworkName}@${report.frameworkVersion}`,
    );
  }
  if (report.configFile !== policy.report.strykerConfigFile) {
    violations.push(
      `[profile] Stryker config differs: expected ${policy.report.strykerConfigFile}, got ${report.configFile}`,
    );
  }
  if (!sameStrings(configuredScope, expectedScope)) {
    violations.push(
      `[profile] configured mutation scope differs: expected ${formatList(expectedScope)}, got ${formatList(configuredScope)}`,
    );
  }
  if (!sameStrings(reportedScope, expectedScope)) {
    violations.push(
      `[profile] reported file scope differs: expected ${formatList(expectedScope)}, got ${formatList(reportedScope)}`,
    );
  }
  for (const [path, statuses] of report.fileStatuses) {
    if (statuses.length === 0) violations.push(`[profile] ${path} contains no mutants`);
  }
  if (report.testRunner !== policy.report.testRunner) {
    violations.push(
      `[profile] test runner differs: expected ${policy.report.testRunner}, got ${report.testRunner}`,
    );
  }
  if (report.vitestConfigFile !== policy.report.vitestConfigFile) {
    violations.push(
      `[profile] Vitest config differs: expected ${policy.report.vitestConfigFile}, got ${report.vitestConfigFile}`,
    );
  }
  if (!report.vitestRelated) {
    violations.push('[profile] related-test selection must remain enabled');
  }
  if (report.coverageAnalysis !== policy.report.coverageAnalysis) {
    violations.push(
      `[profile] coverage analysis differs: expected ${policy.report.coverageAnalysis}, got ${report.coverageAnalysis}`,
    );
  }
  if (report.incremental !== policy.report.incremental) {
    violations.push('[profile] incremental report is not a baseline');
  }
  if (
    report.thresholds.high !== policy.report.thresholds.high ||
    report.thresholds.low !== policy.report.thresholds.low ||
    report.thresholds.break !== policy.report.thresholds.break
  ) {
    violations.push(
      `[profile] thresholds differ: expected high/low/break ${String(policy.report.thresholds.high)}/${String(policy.report.thresholds.low)}/${String(policy.report.thresholds.break)}, got ${String(report.thresholds.high)}/${String(report.thresholds.low)}/${String(report.thresholds.break)}`,
    );
  }
  if (report.excludedMutations.length > 0) {
    violations.push('[profile] excluded mutations are not allowed');
  }
  if (report.ignorers.length > 0) violations.push('[profile] mutation ignorers are not allowed');

  // A mismatched/partial profile is not comparable to the baseline. Avoid
  // presenting numeric changes from it as either quality regressions or gains.
  if (violations.length > 0) return { summary, violations };

  const baseline = policy.baseline;
  if (summary.total > baseline.total) {
    violations.push(
      `[regression] total mutants increased from ${String(baseline.total)} to ${String(summary.total)}; review the expanded mutation surface`,
    );
  } else if (summary.total < baseline.total) {
    violations.push(
      `[improvement] total mutants decreased from ${String(baseline.total)} to ${String(summary.total)}; ratchet the policy`,
    );
  }

  const score = rounded(summary.mutationScore, baseline.mutationScorePrecision);
  if (score < baseline.mutationScoreMinimum) {
    violations.push(
      `[regression] mutation score ${String(score)} is below reviewed minimum ${String(baseline.mutationScoreMinimum)}`,
    );
  } else if (score > baseline.mutationScoreMinimum) {
    violations.push(
      `[improvement] mutation score ${String(score)} exceeds reviewed minimum ${String(baseline.mutationScoreMinimum)}; ratchet the policy`,
    );
  }
  compareRatchetedMaximum(
    violations,
    'no-coverage mutants',
    summary.noCoverage,
    baseline.noCoverageMaximum,
  );
  compareRatchetedMaximum(violations, 'timeout mutants', summary.timeout, baseline.timeoutMaximum);
  compareRatchetedMaximum(violations, 'error mutants', summary.errors, baseline.errorMaximum);
  compareRatchetedMaximum(violations, 'ignored mutants', summary.ignored, baseline.ignoredMaximum);
  return { summary, violations };
}

function readArgument(name: string, fallback: string): string {
  const equals = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (equals !== undefined) return equals.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const knownArguments = new Set(['--policy', '--report']);
  const positional = process.argv.slice(2).filter((argument, index, all) => {
    if (argument.includes('=')) return !knownArguments.has(argument.split('=')[0]!);
    return !knownArguments.has(argument) && !knownArguments.has(all[index - 1] ?? '');
  });
  if (positional.length > 0) throw new Error(`unknown arguments: ${positional.join(', ')}`);

  const policyPath = resolve(
    repositoryRoot,
    readArgument('--policy', 'quality/mutation-policy.json'),
  );
  const reportPath = resolve(
    repositoryRoot,
    readArgument('--report', 'test-results/stryker-nightly.json'),
  );
  const policy = JSON.parse(await readFile(policyPath, 'utf8')) as MutationPolicy;
  const report: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
  const result = evaluateMutationReport(report, policy);
  if (result.violations.length > 0) {
    throw new Error(
      `mutation policy failed:\n${result.violations.map((violation) => `- ${violation}`).join('\n')}`,
    );
  }
  console.log(
    `Mutation policy passed: ${String(result.summary.total)} mutants, ${result.summary.mutationScore.toFixed(policy.baseline.mutationScorePrecision)}% score, ${String(result.summary.noCoverage)} no-coverage, ${String(result.summary.timeout)} timeout, ${String(result.summary.errors)} error.`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
