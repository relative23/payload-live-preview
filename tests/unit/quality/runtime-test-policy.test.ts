import { describe, expect, it } from 'vitest';
import {
  findRuntimeTestPolicyViolations,
  hasRuntimeSelectionFilter,
  type RuntimeTestPolicyInput,
} from '../../../scripts/zero-skip-reporter';

const cleanTest = (overrides: Partial<RuntimeTestPolicyInput> = {}): RuntimeTestPolicyInput => ({
  fullName: 'suite > case',
  resultState: 'passed',
  mode: 'run',
  fails: false,
  retry: 0,
  repeats: 0,
  retryCount: 0,
  repeatCount: 0,
  flaky: false,
  ...overrides,
});

describe('runtime test policy', () => {
  it('accepts a normally executed test without retries or repeats', () => {
    expect(findRuntimeTestPolicyViolations([cleanTest()])).toEqual([]);
  });

  it('rejects skipped/pending results and every non-run declaration mode', () => {
    expect(
      findRuntimeTestPolicyViolations([
        cleanTest({ fullName: 'skipped result', resultState: 'skipped' }),
        cleanTest({ fullName: 'pending result', resultState: 'pending' }),
        cleanTest({ fullName: 'only mode', mode: 'only' }),
        cleanTest({ fullName: 'skip mode', mode: 'skip', resultState: 'skipped' }),
        cleanTest({ fullName: 'todo mode', mode: 'todo', resultState: 'skipped' }),
      ]),
    ).toEqual([
      'skipped result: runtime result is skipped',
      'pending result: runtime result is pending',
      'only mode: declaration mode is only',
      'skip mode: declaration mode is skip',
      'skip mode: runtime result is skipped',
      'todo mode: declaration mode is todo',
      'todo mode: runtime result is skipped',
    ]);
  });

  it('rejects resolved expected-failure, retry, repeat and flaky diagnostics', () => {
    expect(
      findRuntimeTestPolicyViolations([
        cleanTest({ fullName: 'expected failure', fails: true }),
        cleanTest({ fullName: 'numeric retry', retry: 3 }),
        cleanTest({ fullName: 'object retry', retry: { count: 2 } }),
        cleanTest({ fullName: 'repeat option', repeats: 4 }),
        cleanTest({ fullName: 'retry diagnostic', retryCount: 1 }),
        cleanTest({ fullName: 'flaky diagnostic', flaky: true }),
        cleanTest({ fullName: 'repeat diagnostic', repeatCount: 1 }),
      ]),
    ).toEqual([
      'expected failure: expected-failure mode is enabled',
      'numeric retry: retry is configured',
      'object retry: retry is configured',
      'repeat option: repeats are configured',
      'retry diagnostic: test required a retry',
      'flaky diagnostic: test required a retry',
      'repeat diagnostic: test was repeated',
    ]);
  });

  it('ignores selection-induced result skips but still enforces declaration options', () => {
    expect(
      findRuntimeTestPolicyViolations(
        [
          cleanTest({ fullName: 'filtered out', mode: 'skip', resultState: 'skipped' }),
          cleanTest({
            fullName: 'configured retry',
            mode: 'skip',
            resultState: 'skipped',
            retry: 2,
          }),
        ],
        false,
      ),
    ).toEqual(['configured retry: retry is configured']);
  });

  it('recognises Vitest name-filter arguments when specifications omit their filter', () => {
    expect(hasRuntimeSelectionFilter([], ['run', '-t', 'selected case'], {})).toBe(true);
    expect(hasRuntimeSelectionFilter([], ['run', '--testNamePattern=selected'], {})).toBe(true);
    expect(hasRuntimeSelectionFilter([], ['run', 'tests/unit/example.test.ts'], {})).toBe(false);
  });

  it('recognises Stryker per-test workers whose filter lives in project config', () => {
    expect(hasRuntimeSelectionFilter([], [], { STRYKER_MUTATOR_WORKER: '2' })).toBe(true);
  });
});
