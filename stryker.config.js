import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stryker loads this file from disk; a test runner may load it through its own
// module graph, where `import.meta.url` is not a file URL. Both run from the
// repository root, which is what the relative `mutate` paths are resolved against.
const root = import.meta.url.startsWith('file:')
  ? dirname(fileURLToPath(import.meta.url))
  : process.cwd();

const scope = process.env['STRYKER_SCOPE'] ?? 'pr';

if (scope !== 'pr' && scope !== 'nightly') {
  throw new Error(`Unknown STRYKER_SCOPE "${scope}"; expected "pr" or "nightly"`);
}

/**
 * `STRYKER_SHARD=<index>/<total>`, e.g. `2/3`. The nightly scope outgrew one
 * job; the shards are merged back into one report before the policy grades it,
 * so the verdict does not depend on how the work was divided.
 *
 * Files are packed heaviest-first onto the currently lightest shard, weighted by
 * how many test executions each file actually costs — the sum of `coveredBy`
 * over its mutants, recorded in `quality/mutation-shard-weights.json` from the
 * last full report. File size was the first attempt and is a poor stand-in: it
 * ranges from 0.07 to 5.78 test executions per byte across this scope, so a
 * size-balanced split ran 61 minutes in one shard and past 90 in another.
 * Without the file, size is the fallback, which is still better than nothing.
 */
function parseShard(value) {
  if (value === undefined || value === '') return undefined;
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  if (match === null) throw new Error(`STRYKER_SHARD must look like "1/3"; got "${value}"`);
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1 || index < 1 || index > total) {
    throw new Error(`STRYKER_SHARD "${value}" is out of range`);
  }
  return { index, total };
}

function readRecordedWeights() {
  try {
    const parsed = JSON.parse(
      readFileSync(join(root, 'quality/mutation-shard-weights.json'), 'utf8'),
    );
    return parsed.weights ?? {};
  } catch {
    return {};
  }
}

function shardOf(files, shard) {
  if (shard === undefined || shard.total === 1) return files;
  const recorded = readRecordedWeights();
  const weighed = [...files]
    .map((file) => {
      const measured = recorded[file];
      if (typeof measured === 'number' && measured > 0) return { file, weight: measured };
      try {
        // Relative to the working directory, the way Stryker reads `mutate`.
        return { file, weight: statSync(join(root, file)).size };
      } catch {
        // A scope entry naming a file that is gone would otherwise fail here
        // with a bare ENOENT, in a config, with no hint where it came from.
        throw new Error(
          `mutation scope names "${file}", which does not exist; fix quality/coverage-policy.json`,
        );
      }
    })
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
  const buckets = Array.from({ length: shard.total }, () => ({ total: 0, files: [] }));
  for (const { file, weight } of weighed) {
    const target = buckets.reduce((least, bucket) => (bucket.total < least.total ? bucket : least));
    target.files.push(file);
    target.total += weight;
  }
  return buckets[shard.index - 1].files.sort();
}

const shard = parseShard(process.env['STRYKER_SHARD']);

const prMutate = [
  'src/security/csp.ts',
  'src/security/url-validator.ts',
  'src/core/field-value.ts',
];

const coveragePolicy = JSON.parse(readFileSync(join(root, 'quality/coverage-policy.json'), 'utf8'));
const criticalFiles = Object.keys(coveragePolicy.criticalFiles ?? {});
const nightlyMutate = [...new Set([...criticalFiles, ...prMutate, 'src/core/a11y.ts'])].sort();
const suffix = shard === undefined ? '' : `-shard${String(shard.index)}`;

export default {
  mutate: scope === 'nightly' ? shardOf(nightlyMutate, shard) : prMutate,
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.stryker.config.ts',
    related: true,
  },
  coverageAnalysis: 'perTest',
  concurrency: 4,
  // Raised from 10s: the fragment/route and dual-mode suites (event-driven,
  // with real debounce/afterUpdate waits) are `related` to field-value.ts
  // through the lifecycle, so a borderline field-value mutant can run long on
  // a shared CI runner and be miscounted as a timeout rather than killed.
  timeoutMS: 20_000,
  cleanTempDir: 'always',
  // CI and baselines are full runs. Local repeat runs can opt into the cache.
  incremental: process.env['STRYKER_INCREMENTAL'] === '1',
  incrementalFile: `test-results/stryker-${scope}${suffix}-incremental.json`,
  reporters: ['clear-text', 'progress', 'json', 'html'],
  jsonReporter: {
    fileName: `test-results/stryker-${scope}${suffix}.json`,
  },
  htmlReporter: {
    fileName: `test-results/stryker-${scope}${suffix}.html`,
  },
  thresholds:
    scope === 'pr'
      ? {
          high: 95,
          low: 90,
          break: 90,
        }
      : {
          // The report policy applies the exact reviewed ratchet. This lower
          // Stryker-native floor still fails early if that policy step is ever
          // accidentally omitted by an ad-hoc runner.
          high: 75,
          low: 70,
          break: 70,
        },
};
