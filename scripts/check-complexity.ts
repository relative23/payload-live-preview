/**
 * The complexity budget: reviewed ceilings for how much of this package a
 * reader has to hold in their head.
 *
 * Byte budgets kept the runtime from growing unnoticed. Nothing did that for
 * the *surface* — and clarity is not lost in one step but in twenty, each of
 * them locally reasonable. So the same instrument, applied to the numbers a
 * reader actually pays: how many names each entry exports, how many options an
 * adapter takes, how many diagnostic codes exist, how many modules the source
 * is cut into.
 *
 * A limit is not a rule against growth. It is a rule against *silent* growth:
 * raising one means writing down why, in `quality/complexity-budget.json`,
 * where the next reader will find the reason next to the number.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAGNOSTIC_CODES } from '../src/core/diagnostic-codes';
import { readArchitectureModules } from './architecture-graph';
import { improvementNotice } from './size-budget-notice';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const API_REPORTS = resolve(ROOT, 'etc/api');
const BUDGET_FILE = resolve(ROOT, 'quality/complexity-budget.json');
const FREEZE_FILE = resolve(ROOT, 'quality/complexity-budget.frozen.json');

export interface ComplexityBudgetEntry {
  readonly limit: number;
  readonly why: string;
}

/**
 * The feature freeze (ADR 0013 §6): from the first release candidate on, no
 * limit in this file may rise. `since` names the tag the freeze started at.
 */
export interface ComplexityFreeze {
  readonly since: string;
  readonly why: string;
}

export interface ComplexityBudget {
  readonly schemaVersion: number;
  readonly frozen?: ComplexityFreeze;
  readonly totals: Readonly<Record<string, ComplexityBudgetEntry>>;
  /** Per API report, so growth is localised to the entry that grew. */
  readonly entries: Readonly<Record<string, ComplexityBudgetEntry>>;
}

/**
 * The limits as they stood when the freeze began, written once by `--freeze`
 * to `quality/complexity-budget.frozen.json`. A committed file rather than
 * `git show <tag>:…`, because CI checks out one commit without tags and a PR
 * branch that raised a limit would find its own raise at `HEAD`.
 */
export interface ComplexityFreezeSnapshot {
  readonly since: string;
  readonly totals: Readonly<Record<string, number>>;
  readonly entries: Readonly<Record<string, number>>;
}

export interface FreezeViolation {
  readonly metric: string;
  readonly limit: number;
  /** Undefined for a metric the freeze never saw: a new entry is a new surface. */
  readonly frozenLimit: number | undefined;
}

export interface ComplexityMeasurement {
  readonly totals: Readonly<Record<string, number>>;
  readonly entries: Readonly<Record<string, number>>;
}

export interface ComplexityViolation {
  readonly metric: string;
  readonly actual: number;
  readonly limit: number;
}

export interface DeclarationCounts {
  /** Names a project is meant to import: everything an example imports or a guide names, and what those signatures reach. */
  readonly public: number;
  /** Names the entry exports for the package's own tests and modules, marked `@internal` (scripts/surface-usage.ts). */
  readonly internal: number;
}

/**
 * Declarations in one API report, split by release tag. API Extractor writes
 * the tag on the line before each declaration, so an `export` line inherits
 * the tag that immediately precedes it and an untagged one counts as public.
 */
export function countDeclarations(report: string): DeclarationCounts {
  let publicCount = 0;
  let internalCount = 0;
  let internalNext = false;
  for (const line of report.split('\n')) {
    if (line.startsWith('// @')) {
      internalNext = line.startsWith('// @internal');
      continue;
    }
    if (line.startsWith('export ')) {
      if (internalNext) internalCount += 1;
      else publicCount += 1;
      internalNext = false;
    }
  }
  return { public: publicCount, internal: internalCount };
}

/** Public declarations in one API report: the reviewed names an entry exports for a project to use. */
export function countPublicDeclarations(report: string): number {
  return countDeclarations(report).public;
}

/**
 * Members of one interface in a source file, counted at its own indentation.
 * The API reports would be the better source, but the two option interfaces
 * this budget watches reach most entries through a shared declaration chunk,
 * where their members are not spelled out.
 */
export function countInterfaceMembers(source: string, name: string): number {
  const declaration = source.indexOf(`export interface ${name}`);
  if (declaration < 0) throw new Error(`complexity: interface ${name} not found`);
  const open = source.indexOf('{', declaration);
  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    const character = source[end];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = source.slice(open + 1, end);
  return [...body.matchAll(/^ {2}readonly [A-Za-z_][\w]*\??:/gmu)].length;
}

export async function measureComplexity(): Promise<ComplexityMeasurement> {
  const entries: Record<string, number> = {};
  let internalDeclarations = 0;
  for (const file of (await readdir(API_REPORTS)).sort()) {
    if (!file.endsWith('.api.md')) continue;
    const counts = countDeclarations(await readFile(resolve(API_REPORTS, file), 'utf8'));
    entries[file] = counts.public;
    internalDeclarations += counts.internal;
  }
  const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };
  const adapterOptions = countInterfaceMembers(
    await readFile(resolve(ROOT, 'src/adapters/shared/options.ts'), 'utf8'),
    'PreviewAdapterOptions',
  );
  const inlineOptions = countInterfaceMembers(
    await readFile(resolve(ROOT, 'src/types/inline-config.ts'), 'utf8'),
    'InlineScriptConfig',
  );
  const modules = await readArchitectureModules(ROOT);

  return {
    totals: {
      publicDeclarations: Object.values(entries).reduce((sum, count) => sum + count, 0),
      internalDeclarations,
      // `./package.json` is not one of them: it exports the manifest so
      // tooling can read the installed version, not a surface a reader chooses
      // between before writing a line of code.
      entrySubpaths: Object.keys(manifest.exports).filter((key) => key !== './package.json').length,
      adapterOptions,
      inlineOptions,
      diagnosticCodes: Object.keys(DIAGNOSTIC_CODES).length,
      sourceModules: modules.length,
    },
    entries,
  };
}

export function findComplexityViolations(
  measurement: ComplexityMeasurement,
  budget: ComplexityBudget,
): readonly ComplexityViolation[] {
  const violations: ComplexityViolation[] = [];
  const check = (
    metric: string,
    actual: number,
    entry: ComplexityBudgetEntry | undefined,
  ): void => {
    if (entry === undefined) {
      violations.push({ metric: `${metric} (no reviewed budget)`, actual, limit: 0 });
      return;
    }
    if (actual > entry.limit) violations.push({ metric, actual, limit: entry.limit });
  };
  for (const [metric, actual] of Object.entries(measurement.totals)) {
    check(metric, actual, budget.totals[metric]);
  }
  for (const [file, actual] of Object.entries(measurement.entries)) {
    check(file, actual, budget.entries[file]);
  }
  // A budget for something that no longer exists is a number nobody will ever
  // read again; the file has to shrink with the surface.
  for (const file of Object.keys(budget.entries)) {
    if (!(file in measurement.entries)) {
      violations.push({ metric: `${file} (budget without an API report)`, actual: 0, limit: 0 });
    }
  }
  return violations;
}

/** The limits of a frozen budget, in the shape the snapshot file keeps. */
export function freezeSnapshotFrom(budget: ComplexityBudget): ComplexityFreezeSnapshot {
  if (budget.frozen === undefined) {
    throw new Error('complexity: the budget is not frozen; set "frozen" before taking a snapshot');
  }
  const limits = (
    section: Readonly<Record<string, ComplexityBudgetEntry>>,
  ): Record<string, number> =>
    Object.fromEntries(Object.entries(section).map(([metric, entry]) => [metric, entry.limit]));
  return {
    since: budget.frozen.since,
    totals: limits(budget.totals),
    entries: limits(budget.entries),
  };
}

/**
 * Under the freeze, every limit is compared with the snapshot rather than only
 * with the measurement: a raise is red even when the reason beside it is good,
 * because a release candidate takes patch changes and a bigger surface is not
 * one. A limit may still fall. Without a freeze there is nothing to compare.
 */
export function findFreezeViolations(
  budget: ComplexityBudget,
  snapshot: ComplexityFreezeSnapshot | undefined,
): readonly FreezeViolation[] {
  if (budget.frozen === undefined) return [];
  if (snapshot === undefined) {
    throw new Error(
      `complexity: the budget is frozen since ${budget.frozen.since} but quality/complexity-budget.frozen.json is missing; ` +
        'run: tsx scripts/check-complexity.ts --freeze',
    );
  }
  if (snapshot.since !== budget.frozen.since) {
    throw new Error(
      `complexity: the snapshot was taken for the freeze since ${snapshot.since}, the budget is frozen since ${budget.frozen.since}; ` +
        'run: tsx scripts/check-complexity.ts --freeze',
    );
  }
  const violations: FreezeViolation[] = [];
  const compare = (
    section: Readonly<Record<string, ComplexityBudgetEntry>>,
    frozen: Readonly<Record<string, number>>,
  ): void => {
    for (const [metric, entry] of Object.entries(section)) {
      const frozenLimit = frozen[metric];
      if (frozenLimit === undefined || entry.limit > frozenLimit) {
        violations.push({ metric, limit: entry.limit, frozenLimit });
      }
    }
  };
  compare(budget.totals, snapshot.totals);
  compare(budget.entries, snapshot.entries);
  return violations;
}

export function freezeViolationMessage(
  violation: FreezeViolation,
  freeze: ComplexityFreeze,
): string {
  const movement =
    violation.frozenLimit === undefined
      ? `has a budget of ${String(violation.limit)} the freeze never saw`
      : `rose ${String(violation.frozenLimit)} → ${String(violation.limit)}`;
  return (
    `FAIL ${violation.metric}: the limit ${movement} under the feature freeze since ${freeze.since}. ` +
    'A release candidate takes patch changes only; a bigger surface waits for the next minor.'
  );
}

async function readFreezeSnapshot(): Promise<ComplexityFreezeSnapshot | undefined> {
  try {
    return JSON.parse(await readFile(FREEZE_FILE, 'utf8')) as ComplexityFreezeSnapshot;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function main(): Promise<void> {
  const budget = JSON.parse(await readFile(BUDGET_FILE, 'utf8')) as ComplexityBudget;
  if (process.argv.includes('--freeze')) {
    const snapshot = freezeSnapshotFrom(budget);
    await writeFile(FREEZE_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(
      `Complexity budget frozen since ${snapshot.since}: limits written to ${FREEZE_FILE}`,
    );
    return;
  }
  const measurement = await measureComplexity();
  const violations = findComplexityViolations(measurement, budget);
  const freezeViolations = findFreezeViolations(budget, await readFreezeSnapshot());

  for (const [metric, actual] of Object.entries(measurement.totals)) {
    const limit = budget.totals[metric]?.limit ?? 0;
    const notice = improvementNotice(metric, actual, limit, 'count');
    if (notice !== undefined) console.log(notice);
  }
  if (freezeViolations.length > 0 && budget.frozen !== undefined) {
    for (const violation of freezeViolations) {
      console.error(freezeViolationMessage(violation, budget.frozen));
    }
    throw new Error(
      `complexity budget: ${String(freezeViolations.length)} limit(s) raised under the freeze since ${budget.frozen.since}`,
    );
  }
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `FAIL ${violation.metric}: ${String(violation.actual)} exceeds the reviewed ${String(violation.limit)}`,
      );
    }
    console.error(
      'complexity budget: raise the number in quality/complexity-budget.json and write down why. ' +
        'Every name, option and code here is something a reader has to hold in their head.',
    );
    throw new Error(`complexity budget failed with ${String(violations.length)} violation(s)`);
  }
  const { totals } = measurement;
  console.log(
    `Complexity budget passed: ${String(totals['publicDeclarations'])} public and ` +
      `${String(totals['internalDeclarations'])} internal declarations across ` +
      `${String(totals['entrySubpaths'])} entries, ${String(totals['adapterOptions'])} adapter options, ` +
      `${String(totals['inlineOptions'])} inline options, ${String(totals['diagnosticCodes'])} codes, ` +
      `${String(totals['sourceModules'])} modules.`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
