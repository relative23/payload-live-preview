/**
 * Runtime enforcement for the repository's zero-skip and zero-retry policy.
 *
 * The static scanner protects declarations that a filtered run never loads.
 * This reporter complements it with the resolved Vitest result/options, which
 * also exposes dynamic skips and retry options forwarded through variables.
 */

import type { Reporter, TestCase, TestModule, TestSpecification } from 'vitest/node';

type RuntimeTestMode = 'run' | 'only' | 'skip' | 'todo';
type RuntimeTestState = 'failed' | 'passed' | 'pending' | 'skipped';

export interface RuntimeTestPolicyInput {
  readonly fullName: string;
  readonly resultState?: RuntimeTestState | undefined;
  readonly mode?: RuntimeTestMode | undefined;
  readonly fails?: boolean | undefined;
  readonly retry?: number | { readonly count?: number | undefined } | undefined;
  readonly repeats?: number | undefined;
  readonly retryCount?: number | undefined;
  readonly repeatCount?: number | undefined;
  readonly flaky?: boolean | undefined;
}

function hasRetry(retry: RuntimeTestPolicyInput['retry']): boolean {
  if (typeof retry === 'number') return retry > 0;
  return retry !== undefined && (retry.count ?? 0) > 0;
}

export function findRuntimeTestPolicyViolations(
  tests: readonly RuntimeTestPolicyInput[],
  inspectExecutionState = true,
): readonly string[] {
  const violations: string[] = [];

  for (const test of tests) {
    const prefix = test.fullName;
    if (inspectExecutionState && test.mode !== undefined && test.mode !== 'run') {
      violations.push(`${prefix}: declaration mode is ${test.mode}`);
    }
    if (test.fails === true) violations.push(`${prefix}: expected-failure mode is enabled`);
    if (hasRetry(test.retry)) violations.push(`${prefix}: retry is configured`);
    if ((test.repeats ?? 0) > 0) violations.push(`${prefix}: repeats are configured`);
    if ((test.retryCount ?? 0) > 0 || test.flaky === true) {
      violations.push(`${prefix}: test required a retry`);
    }
    if ((test.repeatCount ?? 0) > 0) violations.push(`${prefix}: test was repeated`);
    if (
      inspectExecutionState &&
      (test.resultState === 'skipped' || test.resultState === 'pending')
    ) {
      violations.push(`${prefix}: runtime result is ${test.resultState}`);
    }
  }

  return violations;
}

function toPolicyInput(test: TestCase): RuntimeTestPolicyInput {
  const diagnostic = test.diagnostic();
  return {
    fullName: test.fullName,
    resultState: test.result().state,
    mode: test.options.mode,
    fails: test.options.fails,
    retry: test.options.retry,
    repeats: test.options.repeats,
    retryCount: diagnostic?.retryCount,
    repeatCount: diagnostic?.repeatCount,
    flaky: diagnostic?.flaky,
  };
}

function specificationHasSelectionFilter(specification: TestSpecification): boolean {
  return (
    specification.testNamePattern !== undefined ||
    (specification.testIds?.length ?? 0) > 0 ||
    (specification.testLines?.length ?? 0) > 0 ||
    (specification.testTagsFilter?.length ?? 0) > 0
  );
}

export function hasRuntimeSelectionFilter(
  specifications: readonly TestSpecification[],
  arguments_: readonly string[] = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  // Vitest currently does not expose the CLI name filter on every
  // TestSpecification, so retain the documented CLI spellings as a second,
  // explicit signal. File-only filters do not skip tests within selected files.
  const hasNameFilterArgument = arguments_.some(
    (argument) =>
      argument === '-t' ||
      argument === '--testNamePattern' ||
      argument.startsWith('--testNamePattern='),
  );
  const isStrykerWorker = environment['STRYKER_MUTATOR_WORKER'] !== undefined;
  return (
    hasNameFilterArgument || isStrykerWorker || specifications.some(specificationHasSelectionFilter)
  );
}

/** Vitest reporter used by the main configuration. */
export class ZeroSkipReporter implements Reporter {
  private inspectExecutionState = true;

  onTestRunStart(specifications: readonly TestSpecification[]): void {
    // Vitest marks filtered-out declarations themselves as `mode: skip`, so
    // both mode and result are selection artifacts in this case. Resolved
    // retry/repeat/expected-failure options remain enforced; the unfiltered CI
    // run provides the absolute execution-state gate.
    this.inspectExecutionState = !hasRuntimeSelectionFilter(specifications);
  }

  onTestRunEnd(testModules: readonly TestModule[]): void {
    const tests = testModules.flatMap((module) => [...module.children.allTests()]);
    const violations = findRuntimeTestPolicyViolations(
      tests.map(toPolicyInput),
      this.inspectExecutionState,
    );
    if (violations.length > 0) {
      throw new Error(
        `runtime test policy failed:\n${violations.map((violation) => `- ${violation}`).join('\n')}`,
      );
    }
  }
}
