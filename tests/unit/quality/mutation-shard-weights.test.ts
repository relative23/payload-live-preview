/**
 * Measured pricing must bind each assertion to its file and full test name.
 * These cases cover shared names, deduplicated assertions and incomplete timings.
 * CLI refusals must leave the output absent instead of writing fallback weights.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { shardWeightsFrom, testDurationsFrom } from '../../../scripts/mutation-shard-weights';

const ROOT = resolve('weight-report-fixture');
const FILE = 'tests/unit/example.test.ts';
const FULL_NAME = 'suite prices the covering test';
const measured = (duration: unknown, name = FULL_NAME, file = FILE) => ({
  testResults: [{ name: resolve(ROOT, file), assertionResults: [{ fullName: name, duration }] }],
});
const report = (coveredBy: unknown = ['id']) => ({
  projectRoot: ROOT,
  testFiles: { [FILE]: { tests: [{ id: 'id', name: FULL_NAME }] } },
  files: { 'src/example.ts': { mutants: [{ coveredBy }] } },
});
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('mutation shard weight identity', () => {
  describe('reporter name boundaries', () => {
    it('prices the edge whitespace Stryker removes from actual Vitest names', () => {
      const file = 'tests/unit/detection/origin.test.ts';
      const normalises = 'normaliseOrigin normalises   https://EXAMPLE.com';
      const rejects = 'normaliseOrigin rejects';
      const input = {
        projectRoot: ROOT,
        testFiles: {
          [file]: {
            tests: [
              { id: 'normalises', name: normalises },
              { id: 'rejects', name: rejects },
            ],
          },
        },
        files: {
          'src/detection/origin.ts': { mutants: [{ coveredBy: ['normalises', 'rejects'] }] },
        },
      };
      const timings = {
        testResults: [
          {
            name: resolve(ROOT, file),
            assertionResults: [
              { fullName: normalises + '  ', duration: 2 },
              { fullName: rejects + ' ', duration: 3 },
              { fullName: rejects + '    ', duration: 5 },
            ],
          },
        ],
      };
      expect(shardWeightsFrom(input, testDurationsFrom(timings, ROOT)).weights).toEqual({
        'src/detection/origin.ts': 10,
      });
    });

    it('preserves whitespace inside full names as a different identity', () => {
      const one = 'suite prices the test',
        two = 'suite prices  the test';
      const input = {
        projectRoot: ROOT,
        testFiles: {
          [FILE]: {
            tests: [
              { id: 'one', name: one },
              { id: 'two', name: two },
            ],
          },
        },
        files: {
          'src/one.ts': { mutants: [{ coveredBy: ['one'] }] },
          'src/two.ts': { mutants: [{ coveredBy: ['two'] }] },
        },
      };
      const timings = measured(7, one);
      timings.testResults[0]!.assertionResults.push({ fullName: two, duration: 11 });
      expect(shardWeightsFrom(input, testDurationsFrom(timings, ROOT)).weights).toEqual({
        'src/one.ts': 7,
        'src/two.ts': 11,
      });
    });

    it('refuses different Stryker IDs that collapse to one trimmed identity', () => {
      const input = report();
      input.testFiles[FILE].tests.push({ id: 'other', name: '  ' + FULL_NAME + '  ' });
      const timings = measured(2);
      timings.testResults[0]!.assertionResults.push({
        fullName: '  ' + FULL_NAME + '  ',
        duration: 3,
      });
      expect(() => shardWeightsFrom(input, testDurationsFrom(timings, ROOT))).toThrow(
        /ambiguous|duplicate|identity/iu,
      );
    });

    it.each([' ', '\t\n', '\uFEFF\u00a0\u2003'])(
      'refuses a full name made only of ECMAScript whitespace %j',
      (name) => {
        expect(() => testDurationsFrom(measured(3, name), ROOT)).toThrow(/name/iu);
        const input = report();
        input.testFiles[FILE].tests[0]!.name = name;
        expect(() => shardWeightsFrom(input, testDurationsFrom(measured(3), ROOT))).toThrow(
          /name/iu,
        );
      },
    );

    it.each(['\u0085', '\u001c'])(
      'keeps boundary characters that ECMAScript trim does not remove %j',
      (prefix) => {
        const input = report();
        input.testFiles[FILE].tests[0]!.name = prefix + FULL_NAME;
        expect(
          shardWeightsFrom(input, testDurationsFrom(measured(4, prefix + FULL_NAME), ROOT)).weights,
        ).toEqual({ 'src/example.ts': 4 });
        expect(() => shardWeightsFrom(input, testDurationsFrom(measured(4), ROOT))).toThrow(
          /duration/iu,
        );
      },
    );
  });
  it('prices identical names in different files using the explicit report root', () => {
    const next = 'tests/unit/next.test.ts',
      nuxt = 'tests/unit/nuxt.test.ts';
    const input = {
      projectRoot: ROOT,
      testFiles: {
        [next]: { tests: [{ id: 'next', name: FULL_NAME }] },
        [nuxt]: { tests: [{ id: 'nuxt', name: FULL_NAME }] },
      },
      files: {
        'src/next.ts': { mutants: [{ coveredBy: ['next'] }] },
        'src/nuxt.ts': { mutants: [{ coveredBy: ['nuxt'] }] },
      },
    };
    const timings = {
      testResults: [
        ...measured(2.5, FULL_NAME, next).testResults,
        ...measured(9.5, FULL_NAME, nuxt).testResults,
      ],
    };
    expect(shardWeightsFrom(input, testDurationsFrom(timings, ROOT)).weights).toEqual({
      'src/next.ts': 3,
      'src/nuxt.ts': 10,
    });
  });

  it('sums both runtime assertions represented by one same-file Stryker ID', () => {
    const timings = measured(2);
    timings.testResults[0]!.assertionResults.push({ fullName: FULL_NAME, duration: 3 });
    const durations = testDurationsFrom(timings, ROOT);
    const input = report();
    input.files['src/example.ts'].mutants.push({ coveredBy: ['id'] });
    expect([...durations.values()]).toEqual([5]);
    expect(shardWeightsFrom(input, durations).weights).toEqual({ 'src/example.ts': 10 });
  });

  it('normalizes relative Stryker and absolute Vitest file identities', () => {
    const input = { ...report(), testFiles: { ['./' + FILE]: report().testFiles[FILE] } };
    expect(shardWeightsFrom(input, testDurationsFrom(measured(4), ROOT)).weights).toEqual({
      'src/example.ts': 4,
    });
  });

  it('refuses durations bound to another project rather than matching names alone', () => {
    expect(() =>
      shardWeightsFrom(
        { ...report(), projectRoot: resolve(ROOT, 'other') },
        testDurationsFrom(measured(4), ROOT),
      ),
    ).toThrow(/duration|project|file/iu);
  });

  it('refuses an unknown covering ID rather than pricing it at zero', () => {
    expect(() =>
      shardWeightsFrom(report(['unknown']), testDurationsFrom(measured(4), ROOT)),
    ).toThrow(/unknown|cover/iu);
  });

  it('refuses a covering test without a measured duration', () => {
    expect(() =>
      shardWeightsFrom(report(), testDurationsFrom(measured(4, 'another test'), ROOT)),
    ).toThrow(/duration/iu);
  });

  it('refuses an explicitly supplied empty duration map instead of counting executions', () => {
    expect(() => shardWeightsFrom(report(), new Map())).toThrow(/duration/iu);
  });

  it.each([undefined, null, '4', NaN, Infinity, -1])(
    'refuses malformed measured duration %s',
    (duration) => {
      expect(() => testDurationsFrom(measured(duration), ROOT)).toThrow(/duration/iu);
    },
  );

  it.each([
    null,
    {},
    { testResults: [] },
    { testResults: [{}] },
    { testResults: [{ name: resolve(ROOT, FILE), assertionResults: [] }] },
  ])('refuses malformed or empty duration report %j', (input) => {
    expect(() => testDurationsFrom(input, ROOT)).toThrow(/duration|test|report/iu);
  });

  it('refuses a duration entry without its file identity', () => {
    expect(() =>
      testDurationsFrom(
        { testResults: [{ assertionResults: [{ fullName: FULL_NAME, duration: 3 }] }] },
        ROOT,
      ),
    ).toThrow(/file|test/iu);
  });

  it('refuses a duration entry without its full name', () => {
    expect(() =>
      testDurationsFrom(
        { testResults: [{ name: resolve(ROOT, FILE), assertionResults: [{ duration: 3 }] }] },
        ROOT,
      ),
    ).toThrow(/name|test/iu);
  });

  it.each([NaN, Infinity, -1])('refuses malformed supplied map duration %s', (duration) => {
    const durations = testDurationsFrom(measured(4), ROOT);
    for (const key of durations.keys()) durations.set(key, duration);
    expect(() => shardWeightsFrom(report(), durations)).toThrow(/duration/iu);
  });

  it('refuses duplicate Stryker IDs with different identities', () => {
    const input = {
      ...report(),
      testFiles: {
        ...report().testFiles,
        'tests/other.test.ts': { tests: [{ id: 'id', name: 'other' }] },
      },
    };
    expect(() => shardWeightsFrom(input, testDurationsFrom(measured(4), ROOT))).toThrow(
      /duplicate|identity/iu,
    );
  });

  it('refuses distinct Stryker IDs that cannot distinguish the same runtime identity', () => {
    const input = report();
    input.testFiles[FILE].tests.push({ id: 'other', name: FULL_NAME });
    expect(() => shardWeightsFrom(input, testDurationsFrom(measured(4), ROOT))).toThrow(
      /duplicate|identity|ambiguous/iu,
    );
  });

  it('retains execution-count mode when no timings were provided', () => {
    expect(
      shardWeightsFrom({
        files: { 'src/example.ts': { mutants: [{ coveredBy: ['a', 'b'] }, { coveredBy: ['a'] }] } },
      }).weights,
    ).toEqual({ 'src/example.ts': 3 });
  });

  it('retains the scheduling floor for an actually uncovered file', () => {
    expect(shardWeightsFrom(report([]), testDurationsFrom(measured(4), ROOT)).weights).toEqual({
      'src/example.ts': 1,
    });
  });

  it('accepts a genuine zero duration without treating it as a missing value', () => {
    expect(shardWeightsFrom(report(), testDurationsFrom(measured(0), ROOT)).weights).toEqual({
      'src/example.ts': 1,
    });
  });

  it.each([{ testResults: [] }, { testResults: [{}] }])(
    'CLI refuses supplied malformed duration data without writing fallback weights %j',
    (timings) => {
      const directory = mkdtempSync(resolve(tmpdir(), 'plp-shard-weight-cli-'));
      directories.push(directory);
      const input = resolve(directory, 'report.json'),
        time = resolve(directory, 'duration.json'),
        output = resolve(directory, 'weights.json');
      writeFileSync(input, JSON.stringify(report()));
      writeFileSync(time, JSON.stringify(timings));
      const repository = resolve(import.meta.dirname, '../../..');
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          resolve(repository, 'node_modules/tsx/dist/loader.mjs'),
          resolve(repository, 'scripts/mutation-shard-weights.ts'),
          '--report',
          input,
          '--durations',
          time,
          '--out',
          output,
        ],
        {
          cwd: repository,
          encoding: 'utf8',
          timeout: 10_000,
          env: { ...process.env, TSX_DISABLE_CACHE: '1' },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/duration|test|report/iu);
      expect(existsSync(output)).toBe(false);
    },
  );

  it('CLI uses report.projectRoot when the report belongs to a different directory', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'plp-shard-weight-cli-'));
    directories.push(directory);
    const input = resolve(directory, 'report.json'),
      time = resolve(directory, 'duration.json'),
      output = resolve(directory, 'weights.json');
    writeFileSync(input, JSON.stringify(report()));
    writeFileSync(time, JSON.stringify(measured(6)));
    const repository = resolve(import.meta.dirname, '../../..');
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        resolve(repository, 'node_modules/tsx/dist/loader.mjs'),
        resolve(repository, 'scripts/mutation-shard-weights.ts'),
        '--report',
        input,
        '--durations',
        time,
        '--out',
        output,
      ],
      {
        cwd: repository,
        encoding: 'utf8',
        timeout: 10_000,
        env: { ...process.env, TSX_DISABLE_CACHE: '1' },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual({
      schemaVersion: 1,
      weights: { 'src/example.ts': 6 },
    });
  });
});
