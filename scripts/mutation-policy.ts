/** Fail-closed validation and monotonic ratcheting for a Stryker JSON report. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatList,
  normalizePath,
  normalizeSource,
  parseMutationReport,
  sameStrings,
  sortedUniquePaths,
  summarizeParsedReport,
  type MutationSummary,
  type ParsedMutationReport,
} from './mutation-report';

export interface MutationPolicy {
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
    readonly total: number;
    readonly mutationScoreMinimum: number;
    readonly mutationScorePrecision: number;
    /**
     * Flipped mutants that count as measurement noise: drift inside the band
     * is reported, not failed. Omitted means an exact comparison.
     */
    readonly mutationScoreDriftMutants?: number;
    readonly noCoverageMaximum: number;
    readonly timeoutMaximum: number;
    readonly errorMaximum: number;
    readonly ignoredMaximum: number;
  };
}

export interface MutationPolicyResult {
  readonly summary: MutationSummary;
  readonly violations: readonly string[];
  /** Deviations that are printed but do not fail the run. */
  readonly notices: readonly string[];
}

/** The mutated source per file, used to refuse a report from another working tree. */
export type MutatedSources = ReadonlyMap<string, string>;

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

function findProfileViolations(
  report: ParsedMutationReport,
  policy: MutationPolicy,
  sources: MutatedSources | undefined,
): string[] {
  const violations: string[] = [];
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
  for (const [path, source] of report.fileSources) {
    const current = sources?.get(path);
    if (current === undefined) {
      if (sources !== undefined) {
        violations.push(`[stale] ${path} is not readable in this working tree`);
      }
    } else if (normalizeSource(current) !== normalizeSource(source)) {
      violations.push(
        `[stale] ${path} differs from the source the report mutated; rerun the mutation suite`,
      );
    }
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
  return violations;
}

/**
 * `sources` is the working tree the report is judged against; a report whose
 * mutated source differs from it describes some other code and is refused.
 */
export function evaluateMutationReport(
  input: unknown,
  policy: MutationPolicy,
  sources?: MutatedSources,
): MutationPolicyResult {
  const report = parseMutationReport(input);
  const summary = summarizeParsedReport(report);
  const violations: string[] = [];
  const notices: string[] = [];

  if (policy.schemaVersion !== 1) {
    violations.push(
      `[policy] unsupported policy schemaVersion ${String(policy.schemaVersion)}; expected 1`,
    );
  }
  if (policy.profile !== 'pr-critical' && policy.profile !== 'nightly-critical') {
    violations.push(`[policy] unsupported mutation profile ${policy.profile}`);
  }
  violations.push(...findProfileViolations(report, policy, sources));
  // A mismatched profile is not comparable to the baseline; do not present
  // its numbers as regressions or gains.
  if (violations.length > 0) return { summary, violations, notices };

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
  const driftMutants = baseline.mutationScoreDriftMutants ?? 0;
  // Both sides are rounded to the policy precision, so the band carries one
  // rounding step on top of the mutants it allows; zero stays exact.
  const tolerance =
    driftMutants > 0 && summary.total > 0
      ? (driftMutants / summary.total) * 100 + Math.pow(10, -baseline.mutationScorePrecision)
      : 0;
  const delta = score - baseline.mutationScoreMinimum;
  if (delta < -tolerance) {
    violations.push(
      `[regression] mutation score ${String(score)} is below reviewed minimum ${String(baseline.mutationScoreMinimum)}`,
    );
  } else if (delta > tolerance) {
    violations.push(
      `[improvement] mutation score ${String(score)} exceeds reviewed minimum ${String(baseline.mutationScoreMinimum)}; ratchet the policy`,
    );
  } else if (delta !== 0) {
    notices.push(
      `[drift] mutation score ${String(score)} differs from reviewed ${String(baseline.mutationScoreMinimum)} ` +
        `within the ${String(driftMutants)}-mutant noise band; not failed, but a repeated drift is worth diagnosing`,
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
  return { summary, violations, notices };
}

/** Read every scoped source from the working tree; unreadable files stay absent. */
export async function readMutatedSources(
  repositoryRoot: string,
  scope: readonly string[],
): Promise<MutatedSources> {
  const sources = new Map<string, string>();
  for (const path of scope) {
    try {
      sources.set(normalizePath(path), await readFile(resolve(repositoryRoot, path), 'utf8'));
    } catch {
      // Reported by the [stale] check as "not readable".
    }
  }
  return sources;
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
  const sources = await readMutatedSources(repositoryRoot, policy.scope);
  const result = evaluateMutationReport(report, policy, sources);
  // Printed before the throw so a drift stays visible next to a regression.
  for (const notice of result.notices) console.warn(notice);
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
