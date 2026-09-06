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

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAGNOSTIC_CODES } from '../src/core/diagnostic-codes';
import { readArchitectureModules } from './architecture-graph';
import { improvementNotice } from './size-budget-notice';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const API_REPORTS = resolve(ROOT, 'etc/api');
const BUDGET_FILE = resolve(ROOT, 'quality/complexity-budget.json');

export interface ComplexityBudgetEntry {
  readonly limit: number;
  readonly why: string;
}

export interface ComplexityBudget {
  readonly schemaVersion: number;
  readonly totals: Readonly<Record<string, ComplexityBudgetEntry>>;
  /** Per API report, so growth is localised to the entry that grew. */
  readonly entries: Readonly<Record<string, ComplexityBudgetEntry>>;
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

/** Public declarations in one API report: the reviewed names an entry exports. */
export function countPublicDeclarations(report: string): number {
  return [...report.matchAll(/^export /gmu)].length;
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
  for (const file of (await readdir(API_REPORTS)).sort()) {
    if (!file.endsWith('.api.md')) continue;
    entries[file] = countPublicDeclarations(await readFile(resolve(API_REPORTS, file), 'utf8'));
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
      entrySubpaths: Object.keys(manifest.exports).length,
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

async function main(): Promise<void> {
  const budget = JSON.parse(await readFile(BUDGET_FILE, 'utf8')) as ComplexityBudget;
  const measurement = await measureComplexity();
  const violations = findComplexityViolations(measurement, budget);

  for (const [metric, actual] of Object.entries(measurement.totals)) {
    const limit = budget.totals[metric]?.limit ?? 0;
    const notice = improvementNotice(metric, actual, limit, 'count');
    if (notice !== undefined) console.log(notice);
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
    `Complexity budget passed: ${String(totals['publicDeclarations'])} public declarations across ` +
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
