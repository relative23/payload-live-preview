import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeMutationReports } from '../../../scripts/merge-mutation-reports';

/**
 * Sharding may divide the work, never the verdict. Every mutated file has to
 * land in exactly one shard, and merging the shard reports has to produce the
 * report the policy would have graded from a single run.
 */

const CONFIG = pathToFileURL(resolve(import.meta.dirname, '../../../stryker.config.js')).href;

async function mutateList(shard?: string): Promise<readonly string[]> {
  process.env['STRYKER_SCOPE'] = 'nightly';
  if (shard === undefined) delete process.env['STRYKER_SHARD'];
  else process.env['STRYKER_SHARD'] = shard;
  // The config reads the environment once, at load.
  const module = (await import(`${CONFIG}?case=${shard ?? 'full'}`)) as {
    default: { mutate: readonly string[] };
  };
  return module.default.mutate;
}

afterEach(() => {
  delete process.env['STRYKER_SHARD'];
  delete process.env['STRYKER_SCOPE'];
});

describe('nightly mutation sharding', () => {
  it('splits the scope into disjoint shards that together are the whole scope', async () => {
    const full = await mutateList();
    const shards = [await mutateList('1/3'), await mutateList('2/3'), await mutateList('3/3')];
    const union = shards.flat();

    expect(new Set(union).size).toBe(union.length);
    expect([...union].sort()).toEqual([...full].sort());
  });

  it('balances the shards, so the job is not as slow as its worst split', async () => {
    const shards = [await mutateList('1/3'), await mutateList('2/3'), await mutateList('3/3')];
    const weights = shards.map((files) =>
      files.reduce(
        (total, file) => total + statSync(resolve(import.meta.dirname, '../../../', file)).size,
        0,
      ),
    );
    const spread = Math.max(...weights) - Math.min(...weights);
    // Bytes are a proxy for work; a tenth of the average is a generous ceiling.
    expect(spread).toBeLessThan(weights.reduce((a, b) => a + b, 0) / weights.length / 10);
  });

  it('is the unsharded scope when no shard is named', async () => {
    expect((await mutateList('1/1')).length).toBe((await mutateList()).length);
  });

  it('refuses a shard specification it cannot honour', async () => {
    for (const bad of ['0/3', '4/3', 'x', '1/0', '1']) {
      process.env['STRYKER_SCOPE'] = 'nightly';
      process.env['STRYKER_SHARD'] = bad;
      await expect(import(`${CONFIG}?bad=${bad}`)).rejects.toThrow();
    }
  });
});

describe('merging shard reports', () => {
  const base = {
    schemaVersion: '1.0',
    framework: { name: 'StrykerJS', version: '9.6.1' },
    config: { configFile: 'stryker.config.js', testRunner: 'vitest', mutate: [] as string[] },
    files: {} as Record<string, unknown>,
  };
  const shard = (paths: readonly string[]) => ({
    ...base,
    config: { ...base.config, mutate: [...paths] },
    files: Object.fromEntries(paths.map((path) => [path, { source: 'x', mutants: [] }])),
  });

  it('joins disjoint shards into one report with the union of the scope', () => {
    const merged = mergeMutationReports([shard(['b.ts', 'a.ts']), shard(['c.ts'])]) as {
      files: Record<string, unknown>;
      config: { mutate: string[] };
    };
    expect(Object.keys(merged.files)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(merged.config.mutate).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('accepts the differences a shard is supposed to have', () => {
    // Each shard writes its own report and touches its own related tests;
    // treating those as a configuration mismatch rejected every real run.
    const one = {
      ...shard(['a.ts']),
      testFiles: { 'a.test.ts': { tests: [] } },
      config: {
        ...base.config,
        mutate: ['a.ts'],
        incrementalFile: 'test-results/stryker-nightly-shard1-incremental.json',
        jsonReporter: { fileName: 'test-results/stryker-nightly-shard1.json' },
        htmlReporter: { fileName: 'test-results/stryker-nightly-shard1.html' },
      },
    };
    const two = {
      ...shard(['b.ts']),
      testFiles: { 'b.test.ts': { tests: [] } },
      config: {
        ...base.config,
        mutate: ['b.ts'],
        incrementalFile: 'test-results/stryker-nightly-shard2-incremental.json',
        jsonReporter: { fileName: 'test-results/stryker-nightly-shard2.json' },
        htmlReporter: { fileName: 'test-results/stryker-nightly-shard2.html' },
      },
    };
    const merged = mergeMutationReports([one, two]) as {
      files: Record<string, unknown>;
      testFiles: Record<string, unknown>;
    };
    expect(Object.keys(merged.files)).toEqual(['a.ts', 'b.ts']);
    expect(Object.keys(merged.testFiles)).toEqual(['a.test.ts', 'b.test.ts']);
  });

  it('ignores key order when comparing two shard configurations', () => {
    const one = shard(['a.ts']);
    const two = {
      files: Object.fromEntries([['b.ts', { source: 'x', mutants: [] }]]),
      config: { mutate: ['b.ts'], testRunner: 'vitest', configFile: 'stryker.config.js' },
      framework: { version: '9.6.1', name: 'StrykerJS' },
      schemaVersion: '1.0',
    };
    expect(() => mergeMutationReports([one, two])).not.toThrow();
  });

  it('refuses shards that mutated the same file, which would double-count it', () => {
    expect(() => mergeMutationReports([shard(['a.ts']), shard(['a.ts'])])).toThrow(
      /more than one shard/u,
    );
  });

  it('refuses shards produced by different configurations', () => {
    const other = { ...shard(['b.ts']), framework: { name: 'StrykerJS', version: '9.0.0' } };
    expect(() => mergeMutationReports([shard(['a.ts']), other])).toThrow(
      /different configuration/u,
    );
  });

  it('refuses an empty set of shards rather than reporting a clean run', () => {
    expect(() => mergeMutationReports([])).toThrow(/no shard reports/u);
  });
});
