/**
 * Join the per-shard Stryker reports back into the single report the mutation
 * policy grades. Sharding is a scheduling detail: the verdict must read exactly
 * as it would from one run, so anything that could differ between shards —
 * framework, config, thresholds — has to be identical, and the mutated files
 * have to be disjoint.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface MutationReportShape {
  readonly schemaVersion: unknown;
  readonly framework?: unknown;
  readonly thresholds?: unknown;
  readonly config?: { readonly mutate?: unknown } & Record<string, unknown>;
  readonly files: Record<string, unknown>;
}

function asReport(value: unknown, label: string): MutationReportShape {
  if (typeof value !== 'object' || value === null) throw new Error(`${label} is not an object`);
  const report = value as Record<string, unknown>;
  if (typeof report['files'] !== 'object' || report['files'] === null) {
    throw new Error(`${label} has no files map`);
  }
  return report as unknown as MutationReportShape;
}

/**
 * What a shard narrows (`mutate`), what follows from it (`files`, and the
 * `testFiles` its related-test selection touched) and where it writes its own
 * report. Everything else — framework, runner, thresholds, project root — has
 * to be identical, or the shards did not measure the same thing.
 */
const PER_SHARD_KEYS = new Set(['files', 'testFiles']);
const PER_SHARD_CONFIG_KEYS = new Set([
  'mutate',
  'incrementalFile',
  'jsonReporter',
  'htmlReporter',
]);

function identity(report: MutationReportShape): string {
  const source = report as unknown as Record<string, unknown> & {
    config?: Record<string, unknown>;
  };
  const rest = Object.fromEntries(
    Object.entries(source).filter(([key]) => !PER_SHARD_KEYS.has(key) && key !== 'config'),
  );
  const config = Object.fromEntries(
    Object.entries(source.config ?? {}).filter(([key]) => !PER_SHARD_CONFIG_KEYS.has(key)),
  );
  // Key order is not meaning; two shards must not differ over it.
  return JSON.stringify({ ...rest, config }, (_key, value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort())
      : value,
  );
}

export function mergeMutationReports(reports: readonly unknown[]): unknown {
  if (reports.length === 0) throw new Error('no shard reports to merge');
  const parsed = reports.map((report, index) => asReport(report, `shard ${String(index + 1)}`));
  const first = parsed[0]!;
  const reference = identity(first);
  for (const [index, report] of parsed.entries()) {
    if (identity(report) !== reference) {
      throw new Error(
        `shard ${String(index + 1)} was produced by a different configuration than shard 1`,
      );
    }
  }

  const files: Record<string, unknown> = {};
  const mutate: string[] = [];
  const testFiles: Record<string, unknown> = {};
  for (const [index, report] of parsed.entries()) {
    // Each shard reports the test files its related-test selection touched.
    const shardTests = (report as unknown as { testFiles?: unknown }).testFiles;
    if (typeof shardTests === 'object' && shardTests !== null) {
      Object.assign(testFiles, shardTests);
    }
    for (const [path, file] of Object.entries(report.files)) {
      if (path in files) {
        throw new Error(`file "${path}" was mutated by more than one shard`);
      }
      files[path] = file;
    }
    const configured = report.config?.mutate;
    if (Array.isArray(configured)) {
      for (const entry of configured) if (typeof entry === 'string') mutate.push(entry);
    } else if (index === 0 && configured !== undefined) {
      throw new Error('shard 1 has a config.mutate that is not a list');
    }
  }

  const merged = JSON.parse(JSON.stringify(first)) as Record<string, unknown> & {
    files: Record<string, unknown>;
    config?: Record<string, unknown>;
  };
  merged.files = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  if (Object.keys(testFiles).length > 0) {
    (merged as { testFiles?: unknown }).testFiles = Object.fromEntries(
      Object.entries(testFiles).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  if (merged.config !== undefined) {
    merged.config = { ...merged.config, mutate: [...new Set(mutate)].sort() };
  }
  return merged;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  if (outIndex === -1 || args[outIndex + 1] === undefined) {
    throw new Error('usage: merge-mutation-reports --out <file> <shard.json>...');
  }
  const out = args[outIndex + 1]!;
  const inputs = args.filter((_arg, index) => index !== outIndex && index !== outIndex + 1);
  if (inputs.length === 0) throw new Error('no shard reports given');

  const reports = await Promise.all(
    inputs.map(async (path) => JSON.parse(await readFile(resolve(path), 'utf8')) as unknown),
  );
  const merged = mergeMutationReports(reports);
  await writeFile(resolve(out), `${JSON.stringify(merged)}\n`, 'utf8');
  const count = Object.keys((merged as { files: Record<string, unknown> }).files).length;
  console.log(
    `Merged ${String(inputs.length)} shard reports into ${out} (${String(count)} files).`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
