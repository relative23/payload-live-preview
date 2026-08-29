/**
 * Per-file shard weights for the nightly mutation run.
 *
 * A shard's wall time is the test time it spends, not the bytes it mutates and
 * not the number of test executions either. Size was the first attempt and is
 * off by a factor of eighty across this scope; counting executions is closer but
 * still put 25 % of the real time in a shard nominally carrying 20 %, which ran
 * past its cap. Weighing each covering test by how long it actually takes lands
 * on 20.0 %.
 *
 * Stryker names the tests covering every mutant; Vitest reports what each test
 * costs. Refresh both alongside the baseline:
 *
 *   npx vitest run --reporter=json --outputFile=test-results/vitest-durations.json
 *   npx tsx scripts/mutation-shard-weights.ts --durations test-results/vitest-durations.json
 *
 * Without `--durations` the weights fall back to counting executions, which is
 * worse but never wrong: the split changes, the verdict does not.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ShardWeights {
  readonly schemaVersion: 1;
  /** Test executions per mutated file, summed over its mutants. */
  readonly weights: Readonly<Record<string, number>>;
}

/** Test full-name to milliseconds, from a Vitest JSON report. */
export function testDurationsFrom(vitestReport: unknown): Map<string, number> {
  const durations = new Map<string, number>();
  const suites = (vitestReport as { testResults?: unknown }).testResults;
  if (!Array.isArray(suites)) return durations;
  for (const suite of suites) {
    const cases = (suite as { assertionResults?: unknown }).assertionResults;
    if (!Array.isArray(cases)) continue;
    for (const entry of cases) {
      const name = (entry as { fullName?: unknown }).fullName;
      const duration = (entry as { duration?: unknown }).duration;
      if (typeof name === 'string') {
        durations.set(name, typeof duration === 'number' ? duration : 0);
      }
    }
  }
  return durations;
}

/** Stryker test id to full name, so a mutant's `coveredBy` can be priced. */
function testNamesFrom(report: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const files = (report as { testFiles?: unknown }).testFiles;
  if (typeof files !== 'object' || files === null) return names;
  for (const entry of Object.values(files as Record<string, unknown>)) {
    const tests = (entry as { tests?: unknown }).tests;
    if (!Array.isArray(tests)) continue;
    for (const test of tests) {
      const id = (test as { id?: unknown }).id;
      const name = (test as { name?: unknown }).name;
      if (typeof id === 'string' && typeof name === 'string') names.set(id, name);
    }
  }
  return names;
}

export function shardWeightsFrom(
  report: unknown,
  durations: ReadonlyMap<string, number> = new Map(),
): ShardWeights {
  if (typeof report !== 'object' || report === null) throw new Error('report is not an object');
  const files = (report as { files?: unknown }).files;
  if (typeof files !== 'object' || files === null) throw new Error('report has no files map');

  const names = testNamesFrom(report);
  const priced = durations.size > 0;
  const weights: Record<string, number> = {};
  for (const [path, file] of Object.entries(files as Record<string, unknown>)) {
    const mutants = (file as { mutants?: unknown }).mutants;
    if (!Array.isArray(mutants)) throw new Error(`report file "${path}" has no mutants`);
    let total = 0;
    for (const mutant of mutants) {
      const covered = (mutant as { coveredBy?: unknown }).coveredBy;
      if (!Array.isArray(covered)) continue;
      if (!priced) {
        total += covered.length;
        continue;
      }
      for (const id of covered) {
        const name = typeof id === 'string' ? names.get(id) : undefined;
        total += (name === undefined ? undefined : durations.get(name)) ?? 0;
      }
    }
    // Rounded: these are a packing hint, and fractional milliseconds would only
    // churn the committed file. A file no test covers still costs a scheduling
    // slot, so one is the floor.
    weights[path] = Math.max(1, Math.round(total));
  }
  return {
    schemaVersion: 1,
    weights: Object.fromEntries(Object.entries(weights).sort(([a], [b]) => a.localeCompare(b))),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const read = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const reportPath = read('--report') ?? 'test-results/stryker-nightly.json';
  const outPath = read('--out') ?? 'quality/mutation-shard-weights.json';
  const durationsPath = read('--durations');

  const report: unknown = JSON.parse(await readFile(resolve(reportPath), 'utf8'));
  const durations =
    durationsPath === undefined
      ? new Map<string, number>()
      : testDurationsFrom(JSON.parse(await readFile(resolve(durationsPath), 'utf8')));
  const weights = shardWeightsFrom(report, durations);
  await writeFile(resolve(outPath), `${JSON.stringify(weights, null, 2)}\n`, 'utf8');

  const values = Object.values(weights.weights);
  const total = values.reduce((sum, value) => sum + value, 0);
  console.log(
    `Wrote ${outPath}: ${String(values.length)} files, ${String(total)} ` +
      `${durations.size > 0 ? 'test milliseconds' : 'test executions'}, ` +
      `heaviest ${String(Math.max(...values))}, lightest ${String(Math.min(...values))}.`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
