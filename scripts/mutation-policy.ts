/** Fail-closed validation and monotonic ratcheting for a Stryker JSON report. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collapseWhitespace,
  formatList,
  normalizePath,
  normalizeSource,
  parseMutationReport,
  sameStrings,
  sortedUniquePaths,
  summarizeParsedReport,
  type MutantIdentity,
  type MutationSummary,
  type ParsedMutationReport,
} from './mutation-report';

/**
 * One surviving mutant reviewed as equivalent: the program does the same with
 * and without it, and `why` says in one sentence how. Named by position and by
 * the text it replaced, so an entry cannot quietly start describing other code.
 */
export interface EquivalentMutant {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly mutator: string;
  /** The source the mutant replaced, one line, one space between tokens. */
  readonly original: string;
  readonly replacement: string;
  readonly why: string;
}

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
  /**
   * The survivors reviewed as equivalent, one entry each. When the list is
   * declared, every surviving or uncovered mutant has to be on it and every
   * entry has to name a mutant that still survives: a killed one is a ratchet
   * to take, a missing one a report from other code. Omitted, survivors are
   * held by the score alone.
   */
  readonly equivalent?: readonly EquivalentMutant[];
}

export interface MutationPolicyResult {
  readonly summary: MutationSummary;
  readonly violations: readonly string[];
  /** Deviations that are printed but do not fail the run. */
  readonly notices: readonly string[];
}

/** The mutated source per file, used to refuse a report from another working tree. */
export type MutatedSources = ReadonlyMap<string, string>;

const MINIMUM_REASON_LENGTH = 30;

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

/**
 * A ceiling rather than an exact ratchet, for the one count that is a property
 * of the machine instead of the tests. Stryker reports a timeout when a mutant's
 * run does not finish in `timeoutMS`; a loaded runner produces one where a quiet
 * one produces none, and the nightly figure is the sum over six shards on six
 * runners. Four measurements of a byte-identical tree gave 25, 35, 46 and 107.
 *
 * Two of those runs settle what the count means. Between them 61 mutants moved
 * from killed to timeout while `killed + timeout` stayed at 5755, `survived` at
 * 1259 and `noCoverage` at 85 — not one mutant changed its verdict, only the
 * mechanism that caught it. A fourth run then moved 32 mutants the other way,
 * from `survived` to `timeout`, which raised the score to 81.52 without a line
 * of source changing: a timeout counts as detected, so a slow runner flatters
 * the figure. The score is therefore load-sensitive in both directions, and the
 * drift band has to cover that spread rather than pretend it away.
 *
 * That spread came from a 20-second timeout leaving borderline mutants to the
 * clock. At 60 seconds the assertions decide, and two runs of the same tree
 * both reported exactly 25 — the mutants that genuinely never terminate. The
 * ceiling is set from that with room for a slow runner, and can only catch a
 * regime change, which is all it is for.
 * Failing because *fewer* mutants timed out would only teach the next reader to
 * edit the number. A slowdown still fails: timeouts above the ceiling
 * are a regression, and a timeout counts as detected, so the score is unaffected
 * either way.
 */
function compareCeiling(
  violations: string[],
  notices: string[],
  label: string,
  observed: number,
  ceiling: number,
): void {
  if (observed > ceiling) {
    violations.push(
      `[regression] ${label} ${String(observed)} exceed reviewed maximum ${String(ceiling)}`,
    );
  } else if (observed < ceiling) {
    notices.push(
      `[drift] ${label} ${String(observed)} is below the reviewed ceiling ${String(ceiling)}; ` +
        'expected for a machine-dependent count, worth lowering if it persists',
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

function describeMutant(file: string, identity: MutantIdentity): string {
  return `${file}:${String(identity.line)}:${String(identity.column)} ${identity.mutatorName} (${identity.original} → ${identity.replacement})`;
}

function describeEntry(entry: EquivalentMutant): string {
  return `${entry.file}:${String(entry.line)}:${String(entry.column)} ${entry.mutator}`;
}

function namesMutant(entry: EquivalentMutant, file: string, identity: MutantIdentity): boolean {
  return (
    normalizePath(entry.file) === file &&
    entry.line === identity.line &&
    entry.column === identity.column &&
    entry.mutator === identity.mutatorName &&
    collapseWhitespace(entry.replacement) === identity.replacement
  );
}

/**
 * Holds the reviewed equivalence list against the report: every survivor named,
 * every name still a survivor, every entry with a sentence and the text it
 * claims to describe. Survivors stay visible in the report; the list is a
 * review of them, not an exclusion.
 */
export function findEquivalenceViolations(
  report: ParsedMutationReport,
  equivalent: readonly EquivalentMutant[],
): readonly string[] {
  const violations: string[] = [];
  const matched = new Set<EquivalentMutant>();
  for (const [file, mutants] of report.fileMutants) {
    for (const mutant of mutants) {
      if (mutant.status !== 'Survived' && mutant.status !== 'NoCoverage') continue;
      if (mutant.identity === undefined) {
        violations.push(`[profile] ${file} has a surviving mutant without a location`);
        continue;
      }
      const identity = mutant.identity;
      const entries = equivalent.filter((entry) => namesMutant(entry, file, identity));
      if (entries.length === 0) {
        violations.push(
          `[regression] ${describeMutant(file, identity)} survives without an equivalence entry`,
        );
        continue;
      }
      if (entries.length > 1) {
        violations.push(
          `[policy] ${describeMutant(file, identity)} has duplicate equivalence entries`,
        );
      }
      for (const entry of entries) {
        matched.add(entry);
        if (collapseWhitespace(entry.original) !== identity.original) {
          violations.push(
            `[stale] the equivalence entry at ${describeMutant(file, identity)} quotes "${entry.original}"; rerun the review`,
          );
        }
      }
    }
  }
  for (const entry of equivalent) {
    if (entry.why.trim().length < MINIMUM_REASON_LENGTH) {
      violations.push(
        `[policy] the equivalence entry ${describeEntry(entry)} needs a sentence saying why the program does the same`,
      );
    }
    if (matched.has(entry)) continue;
    const file = normalizePath(entry.file);
    const killed = (report.fileMutants.get(file) ?? []).some(
      (mutant) =>
        mutant.identity !== undefined &&
        namesMutant(entry, file, mutant.identity) &&
        (mutant.status === 'Killed' || mutant.status === 'Timeout'),
    );
    violations.push(
      killed
        ? `[improvement] the equivalence entry ${describeEntry(entry)} is killed now; drop it`
        : `[stale] the equivalence entry ${describeEntry(entry)} names no mutant in the report`,
    );
  }
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
  if (
    policy.profile !== 'pr-critical' &&
    policy.profile !== 'nightly-critical' &&
    policy.profile !== 'core-critical'
  ) {
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
  compareCeiling(violations, notices, 'timeout mutants', summary.timeout, baseline.timeoutMaximum);
  compareRatchetedMaximum(violations, 'error mutants', summary.errors, baseline.errorMaximum);
  compareRatchetedMaximum(violations, 'ignored mutants', summary.ignored, baseline.ignoredMaximum);
  if (policy.equivalent !== undefined) {
    violations.push(...findEquivalenceViolations(report, policy.equivalent));
  }
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
  const reviewed =
    policy.equivalent === undefined
      ? ''
      : `, ${String(result.summary.survived + result.summary.noCoverage)} survivors each reviewed as equivalent`;
  console.log(
    `Mutation policy passed: ${String(result.summary.total)} mutants, ${result.summary.mutationScore.toFixed(policy.baseline.mutationScorePrecision)}% score, ${String(result.summary.noCoverage)} no-coverage, ${String(result.summary.timeout)} timeout, ${String(result.summary.errors)} error${reviewed}.`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
