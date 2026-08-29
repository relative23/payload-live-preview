/**
 * Per-file shard weights for the nightly mutation run.
 *
 * A shard's wall time is the test executions it performs, not the bytes it
 * mutates: across this scope those differ by a factor of eighty, and a
 * size-balanced split finished one shard in 61 minutes while another ran past
 * 90. Stryker records which tests cover each mutant, so the sum of `coveredBy`
 * over a file's mutants is the work that file costs — measured, not guessed.
 *
 * Refresh this alongside the baseline, from the same report.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ShardWeights {
  readonly schemaVersion: 1;
  /** Test executions per mutated file, summed over its mutants. */
  readonly weights: Readonly<Record<string, number>>;
}

export function shardWeightsFrom(report: unknown): ShardWeights {
  if (typeof report !== 'object' || report === null) throw new Error('report is not an object');
  const files = (report as { files?: unknown }).files;
  if (typeof files !== 'object' || files === null) throw new Error('report has no files map');

  const weights: Record<string, number> = {};
  for (const [path, file] of Object.entries(files as Record<string, unknown>)) {
    const mutants = (file as { mutants?: unknown }).mutants;
    if (!Array.isArray(mutants)) throw new Error(`report file "${path}" has no mutants`);
    let total = 0;
    for (const mutant of mutants) {
      const covered = (mutant as { coveredBy?: unknown }).coveredBy;
      total += Array.isArray(covered) ? covered.length : 0;
    }
    // A file no test covers still costs a scheduling slot; one keeps it sortable.
    weights[path] = Math.max(1, total);
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

  const report: unknown = JSON.parse(await readFile(resolve(reportPath), 'utf8'));
  const weights = shardWeightsFrom(report);
  await writeFile(resolve(outPath), `${JSON.stringify(weights, null, 2)}\n`, 'utf8');

  const values = Object.values(weights.weights);
  const total = values.reduce((sum, value) => sum + value, 0);
  console.log(
    `Wrote ${outPath}: ${String(values.length)} files, ${String(total)} test executions, ` +
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
