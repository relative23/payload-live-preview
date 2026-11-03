/** Runtime enforcement for Playwright's zero-skip and zero-flake policy. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Where a run writes the steps it started again, empty list included. CI uploads the file from
 * every real-admin job, and `scripts/count-repeated-attempts.ts` holds their sum to a budget
 * for the whole run.
 */
export const REPEATED_ATTEMPTS_FILE = 'test-results/repeated-attempts.json';

type PlaywrightStatus = 'failed' | 'interrupted' | 'passed' | 'skipped' | 'timedOut';

export interface PlaywrightRuntimePolicyInput {
  readonly title: string;
  readonly expectedStatus: PlaywrightStatus;
  readonly outcome: 'expected' | 'flaky' | 'skipped' | 'unexpected';
  readonly resultStatus: PlaywrightStatus;
  readonly retry: number;
  readonly repeatEachIndex: number;
  readonly annotations: readonly string[];
  /** The descriptions of its `repeated-attempt` annotations, one per step it started again. */
  readonly repeatedAttempts: readonly string[];
}

const FORBIDDEN_ANNOTATIONS = new Set(['fail', 'fixme', 'skip']);

/**
 * The annotation a test adds when it starts a step again itself, as the real-admin
 * specs do with a frame reload that fired no `load` (tests/real-payload/live-preview-panel.ts).
 */
export const REPEATED_ATTEMPT = 'repeated-attempt';

/**
 * A step a test starts again itself is no retry, and it passes the policy. Every
 * one is listed at the end of the run instead, so a repeat that grows common shows.
 */
export function listRepeatedAttempts(
  tests: readonly PlaywrightRuntimePolicyInput[],
): readonly string[] {
  return tests.flatMap((test) =>
    test.repeatedAttempts.map((attempt) => `${test.title}: ${attempt}`),
  );
}

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
  readonly #attemptsFile: string;

  /** Playwright passes the options a config gives the reporter; the default suits every config. */
  constructor(options: { readonly attemptsFile?: string } = {}) {
    this.#attemptsFile = options.attemptsFile ?? REPEATED_ATTEMPTS_FILE;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.#tests.push({
      title: test.titlePath().join(' › '),
      expectedStatus: test.expectedStatus,
      outcome: test.outcome(),
      resultStatus: result.status,
      retry: result.retry,
      repeatEachIndex: test.repeatEachIndex,
      annotations: test.annotations.map(({ type }) => type),
      repeatedAttempts: test.annotations
        .filter(({ type }) => type === REPEATED_ATTEMPT)
        .map(({ description }) => description ?? REPEATED_ATTEMPT),
    });
  }

  onEnd(_result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const repeated = listRepeatedAttempts(this.#tests);
    mkdirSync(dirname(this.#attemptsFile), { recursive: true });
    writeFileSync(this.#attemptsFile, `${JSON.stringify({ attempts: repeated }, undefined, 2)}\n`);
    if (repeated.length > 0) {
      console.log(
        `Steps a test started again (${String(repeated.length)}, allowed):\n${repeated
          .map((attempt) => `- ${attempt}`)
          .join('\n')}`,
      );
    }
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
