/**
 * Per-file shard weights sum the measured cost of each mutant's covering tests.
 * File paths and full names bind Vitest timings to Stryker IDs; both readers
 * trim outer whitespace as Stryker does. Repeated assertions with that identity
 * contribute their combined duration. Without timings, weights count executions
 * and retain a scheduling floor of one.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ShardWeights {
  readonly schemaVersion: 1;
  /** Covering test milliseconds, or execution counts when no timings were supplied. */
  readonly weights: Readonly<Record<string, number>>;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function projectRootFrom(report: Record<string, unknown>): string {
  const root = report['projectRoot'];
  if (typeof root !== 'string' || !isAbsolute(root)) {
    throw new Error('report has no absolute projectRoot for test durations');
  }
  return resolve(root);
}

/** Stryker trims the joined name; whitespace inside it stays meaningful. */
function testIdentity(file: unknown, name: unknown, projectRoot: string): string {
  if (typeof file !== 'string' || file.length === 0) throw new Error('test has no file identity');
  if (typeof name !== 'string') throw new Error('test has no full name');
  const canonicalName = name.trim();
  if (canonicalName.length === 0) throw new Error('test has no full name');
  const absolute = resolve(projectRoot, file);
  const within = relative(projectRoot, absolute);
  if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new Error(`test file "${file}" is outside the report project`);
  }
  return JSON.stringify([absolute, canonicalName]);
}

function validDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Test file and full-name identity to combined milliseconds from a Vitest JSON report. */
export function testDurationsFrom(
  vitestReport: unknown,
  projectRoot = process.cwd(),
): Map<string, number> {
  if (!isAbsolute(projectRoot)) throw new Error('test duration project root must be absolute');
  const root = resolve(projectRoot);
  if (!record(vitestReport) || !Array.isArray(vitestReport['testResults'])) {
    throw new Error('duration report has no testResults array');
  }
  const durations = new Map<string, number>();
  for (const suite of vitestReport['testResults']) {
    if (!record(suite) || !Array.isArray(suite['assertionResults'])) {
      throw new Error('duration report test suite has no assertionResults array');
    }
    for (const entry of suite['assertionResults']) {
      if (!record(entry)) throw new Error('duration report test is not an object');
      const key = testIdentity(suite['name'], entry['fullName'], root);
      if (!validDuration(entry['duration'])) throw new Error(`invalid test duration for ${key}`);
      const total = (durations.get(key) ?? 0) + entry['duration'];
      if (!Number.isFinite(total)) throw new Error(`test duration sum is not finite for ${key}`);
      durations.set(key, total);
    }
  }
  if (durations.size === 0) throw new Error('duration report contains no measured tests');
  return durations;
}

/** Stryker deduplicates same-file test names into one covering ID. */
function testNamesFrom(report: Record<string, unknown>, root: string): Map<string, string> {
  if (!record(report['testFiles'])) throw new Error('report has no testFiles map for durations');
  const names = new Map<string, string>();
  const identities = new Set<string>();
  for (const [file, entry] of Object.entries(report['testFiles'])) {
    if (!record(entry) || !Array.isArray(entry['tests'])) {
      throw new Error(`report test file "${file}" has no tests array`);
    }
    for (const test of entry['tests']) {
      if (!record(test) || typeof test['id'] !== 'string' || test['id'].length === 0) {
        throw new Error(`report test file "${file}" has an invalid test ID`);
      }
      const key = testIdentity(file, test['name'], root);
      if (names.has(test['id'])) throw new Error(`duplicate Stryker test ID "${test['id']}"`);
      if (identities.has(key)) throw new Error(`ambiguous duplicate Stryker test identity ${key}`);
      names.set(test['id'], key);
      identities.add(key);
    }
  }
  return names;
}

export function shardWeightsFrom(
  report: unknown,
  durations?: ReadonlyMap<string, number>,
): ShardWeights {
  if (!record(report)) throw new Error('report is not an object');
  if (!record(report['files'])) throw new Error('report has no files map');

  const priced = durations !== undefined;
  let names: ReadonlyMap<string, string> = new Map();
  if (durations !== undefined) {
    if (durations.size === 0) throw new Error('supplied test duration map is empty');
    for (const [key, duration] of durations) {
      if (typeof key !== 'string' || !validDuration(duration)) {
        throw new Error('supplied test duration map has an invalid entry');
      }
    }
    names = testNamesFrom(report, projectRootFrom(report));
  }

  const weights: [string, number][] = [];
  for (const [path, file] of Object.entries(report['files'])) {
    if (!record(file) || !Array.isArray(file['mutants'])) {
      throw new Error(`report file "${path}" has no mutants`);
    }
    let total = 0;
    for (const mutant of file['mutants']) {
      if (!record(mutant)) throw new Error(`report file "${path}" has an invalid mutant`);
      const covered = mutant['coveredBy'];
      if (covered === undefined) continue;
      if (!Array.isArray(covered) || covered.some((id: unknown) => typeof id !== 'string')) {
        throw new Error(`report file "${path}" has invalid covering test IDs`);
      }
      if (!priced) {
        total += covered.length;
        continue;
      }
      for (const id of covered as string[]) {
        const key = names.get(id);
        if (key === undefined) throw new Error(`unknown covering test ID "${id}"`);
        const duration = durations.get(key);
        if (duration === undefined) throw new Error(`missing test duration for ${key}`);
        total += duration;
      }
    }
    if (!Number.isFinite(total)) throw new Error(`test duration sum is not finite for "${path}"`);
    // Whole milliseconds avoid churn; even an uncovered file needs a scheduling slot.
    weights.push([path, Math.max(1, Math.round(total))]);
  }
  return {
    schemaVersion: 1,
    weights: Object.fromEntries(weights.sort(([a], [b]) => a.localeCompare(b))),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const read = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    if (index === -1) return undefined;
    const value = args[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith('--')) {
      throw new Error(`missing value for ${flag}`);
    }
    if (args.lastIndexOf(flag) !== index) throw new Error(`duplicate option ${flag}`);
    return value;
  };
  const reportPath = read('--report') ?? 'test-results/stryker-nightly.json';
  const outPath = read('--out') ?? 'quality/mutation-shard-weights.json';
  const durationsPath = read('--durations');

  const report: unknown = JSON.parse(await readFile(resolve(reportPath), 'utf8'));
  const durations =
    durationsPath === undefined
      ? undefined
      : testDurationsFrom(
          JSON.parse(await readFile(resolve(durationsPath), 'utf8')),
          record(report) ? projectRootFrom(report) : '',
        );
  const weights = shardWeightsFrom(report, durations);
  await writeFile(resolve(outPath), `${JSON.stringify(weights, null, 2)}\n`, 'utf8');

  const values = Object.values(weights.weights);
  const total = values.reduce((sum, value) => sum + value, 0);
  console.log(
    `Wrote ${outPath}: ${String(values.length)} files, ${String(total)} ` +
      `${durations === undefined ? 'test executions' : 'test milliseconds'}, ` +
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
