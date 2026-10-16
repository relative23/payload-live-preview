/**
 * JSON output must preserve the runtime test policy when invoked through the CLI.
 * These cases load the public reporter and distinguish a skip refusal from loader errors.
 * A short temporary root and one worker bound each child process.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const REPORTER = resolve(ROOT, 'scripts/zero-skip-reporter.ts');

interface CliAssertion {
  readonly title: string;
  readonly fullName: string;
  readonly status: string;
  readonly duration?: number;
}

interface CliReport {
  readonly success: boolean;
  readonly numTotalTests: number;
  readonly numPassedTests: number;
  readonly numFailedTests: number;
  readonly numPendingTests: number;
  readonly numTodoTests: number;
  readonly numFailedTestSuites: number;
  readonly testResults: readonly {
    readonly name: string;
    readonly assertionResults: readonly CliAssertion[];
  }[];
}

function runCliFixture(mode: 'clean' | 'runtime-skip', reporters: 'guarded' | 'json-only') {
  // tsx uses a Unix socket below TMPDIR; the repository fixture path can exceed its limit.
  const temporary = mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'plp-zs-'));
  let fixtureDirectory: string | undefined;
  try {
    const cacheRoot = resolve(ROOT, '.vitest-cache');
    mkdirSync(cacheRoot, { recursive: true });
    fixtureDirectory = mkdtempSync(join(cacheRoot, 'zero-skip-cli-'));
    const fixtureFile = join(fixtureDirectory, 'fixture.test.ts');
    const configFile = join(fixtureDirectory, 'vitest.config.mjs');
    const outputFile = join(fixtureDirectory, 'results.json');
    const include = relative(ROOT, fixtureFile).split(sep).join('/');
    writeFileSync(
      fixtureFile,
      `import { expect, test } from 'vitest';
test('measured pass', () => { expect(2 + 2).toBe(4); });
${mode === 'runtime-skip' ? "test('runtime skip', ({ skip }) => { skip('runtime policy sentinel'); });\n" : ''}`,
    );
    writeFileSync(
      configFile,
      `import base from '../../vitest.config.ts';
export default { ...base, test: { ...base.test, include: ${JSON.stringify([include])} } };
`,
    );
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      TMPDIR: temporary,
      TMP: temporary,
      TEMP: temporary,
      TSX_DISABLE_CACHE: '1',
    };
    for (const key of [
      'NODE_OPTIONS',
      'NODE_PATH',
      'ESBUILD_BINARY_PATH',
      'TSX_TSCONFIG_PATH',
      'STRYKER_MUTATOR_WORKER',
      'PLP_PROPERTY_RUNS',
      'PLP_PROPERTY_SEED',
    ]) {
      environment[key] = undefined;
    }
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        resolve(ROOT, 'node_modules/tsx/dist/loader.mjs'),
        resolve(ROOT, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--root',
        ROOT,
        '--config',
        configFile,
        '--pool=threads',
        '--maxWorkers=1',
        '--bail=0',
        '--allowOnly=false',
        '--retry=0',
        '--passWithNoTests=false',
        ...(reporters === 'guarded'
          ? ['--reporter=default', '--reporter=json', `--reporter=${REPORTER}`]
          : ['--reporter=json']),
        `--outputFile.json=${outputFile}`,
      ],
      {
        cwd: ROOT,
        env: environment,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 256 * 1024,
        killSignal: 'SIGKILL',
      },
    );
    return {
      ...result,
      fixtureFile,
      output: `${result.stdout}\n${result.stderr}`,
      report: existsSync(outputFile)
        ? (JSON.parse(readFileSync(outputFile, 'utf8')) as CliReport)
        : undefined,
    };
  } finally {
    if (fixtureDirectory !== undefined) rmSync(fixtureDirectory, { recursive: true, force: true });
    rmSync(temporary, { recursive: true, force: true });
  }
}

describe('runtime test policy through the JSON CLI', () => {
  it(
    'loads the public reporter and writes measured assertions for a clean run',
    { timeout: 15_000 },
    () => {
      const result = runCliFixture('clean', 'guarded');
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.output).toBe(0);
      expect(result.report).toMatchObject({
        success: true,
        numTotalTests: 1,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        numFailedTestSuites: 0,
      });
      const file = result.report!.testResults[0]!;
      expect(result.report!.testResults).toHaveLength(1);
      expect(resolve(file.name)).toBe(result.fixtureFile);
      expect(file.assertionResults).toHaveLength(1);
      const assertion = file.assertionResults[0]!;
      expect(assertion).toMatchObject({ title: 'measured pass', status: 'passed' });
      expect(assertion.fullName).toContain('measured pass');
      expect(assertion.duration).toEqual(expect.any(Number));
      expect(Number.isFinite(assertion.duration)).toBe(true);
      expect(assertion.duration).toBeGreaterThanOrEqual(0);
    },
  );

  it(
    'rejects a runtime skip with the actual policy diagnostic alongside JSON',
    { timeout: 15_000 },
    () => {
      const result = runCliFixture('runtime-skip', 'guarded');
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain('runtime test policy failed');
      expect(result.output).toContain('runtime result is skipped');
      expect(result.output).not.toMatch(
        /not the default export|Failed to load custom Reporter|No test files found/u,
      );
      expect(result.report).toMatchObject({
        success: true,
        numTotalTests: 2,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 1,
        numTodoTests: 0,
        numFailedTestSuites: 0,
      });
      const file = result.report!.testResults[0]!;
      expect(result.report!.testResults).toHaveLength(1);
      expect(resolve(file.name)).toBe(result.fixtureFile);
      expect(file.assertionResults).toEqual([
        expect.objectContaining({ title: 'measured pass', status: 'passed' }),
        expect.objectContaining({ title: 'runtime skip', status: 'skipped' }),
      ]);
    },
  );

  it(
    'demonstrates that JSON alone does not reject the same runtime skip',
    { timeout: 15_000 },
    () => {
      const result = runCliFixture('runtime-skip', 'json-only');
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.output).toBe(0);
      expect(result.output).not.toContain('runtime test policy failed');
      expect(result.report).toMatchObject({
        success: true,
        numTotalTests: 2,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 1,
        numTodoTests: 0,
        numFailedTestSuites: 0,
      });
      const file = result.report!.testResults[0]!;
      expect(result.report!.testResults).toHaveLength(1);
      expect(resolve(file.name)).toBe(result.fixtureFile);
      expect(file.assertionResults).toEqual([
        expect.objectContaining({ title: 'measured pass', status: 'passed' }),
        expect.objectContaining({ title: 'runtime skip', status: 'skipped' }),
      ]);
    },
  );
});
