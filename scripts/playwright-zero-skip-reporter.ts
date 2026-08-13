/** Runtime enforcement for Playwright's zero-skip and zero-flake policy. */

import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

type PlaywrightStatus = 'failed' | 'interrupted' | 'passed' | 'skipped' | 'timedOut';

export interface PlaywrightRuntimePolicyInput {
  readonly title: string;
  readonly expectedStatus: PlaywrightStatus;
  readonly outcome: 'expected' | 'flaky' | 'skipped' | 'unexpected';
  readonly resultStatus: PlaywrightStatus;
  readonly retry: number;
  readonly repeatEachIndex: number;
  readonly annotations: readonly string[];
}

const FORBIDDEN_ANNOTATIONS = new Set(['fail', 'fixme', 'skip']);

export function findPlaywrightRuntimePolicyViolations(
  tests: readonly PlaywrightRuntimePolicyInput[],
): readonly string[] {
  const violations: string[] = [];
  for (const test of tests) {
    if (test.expectedStatus !== 'passed') {
      violations.push(`${test.title}: expected status is ${test.expectedStatus}`);
    }
    if (test.resultStatus === 'skipped') {
      violations.push(`${test.title}: runtime result is skipped`);
    }
    if (test.outcome === 'flaky' || test.outcome === 'skipped') {
      violations.push(`${test.title}: outcome is ${test.outcome}`);
    }
    if (test.retry > 0) violations.push(`${test.title}: test required retry ${String(test.retry)}`);
    if (test.repeatEachIndex > 0) {
      violations.push(`${test.title}: repeat-each index is ${String(test.repeatEachIndex)}`);
    }
    for (const annotation of test.annotations) {
      if (FORBIDDEN_ANNOTATIONS.has(annotation)) {
        violations.push(`${test.title}: forbidden annotation ${annotation}`);
      }
    }
  }
  return violations;
}

/**
 * The static inventory sees declarations that a filtered run never loads. This
 * reporter closes the complementary runtime seam: dynamic annotations, skips,
 * expected failures and pass-on-retry outcomes can never produce a green E2E
 * process.
 */
export default class PlaywrightZeroSkipReporter implements Reporter {
  readonly #tests: PlaywrightRuntimePolicyInput[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    this.#tests.push({
      title: test.titlePath().join(' › '),
      expectedStatus: test.expectedStatus,
      outcome: test.outcome(),
      resultStatus: result.status,
      retry: result.retry,
      repeatEachIndex: test.repeatEachIndex,
      annotations: test.annotations.map(({ type }) => type),
    });
  }

  onEnd(_result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const violations = findPlaywrightRuntimePolicyViolations(this.#tests);
    if (violations.length === 0) return Promise.resolve(undefined);
    console.error(
      `Playwright runtime test policy failed:\n${violations
        .map((violation) => `- ${violation}`)
        .join('\n')}`,
    );
    return Promise.resolve({ status: 'failed' });
  }
}
