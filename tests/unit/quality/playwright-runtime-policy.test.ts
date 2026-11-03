import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import { describe, expect, it, vi } from 'vitest';
import PlaywrightZeroSkipReporter, {
  findPlaywrightRuntimePolicyViolations,
  REPEATED_ATTEMPT,
  type PlaywrightRuntimePolicyInput,
} from '../../../scripts/playwright-zero-skip-reporter';

const passed = (
  overrides: Partial<PlaywrightRuntimePolicyInput> = {},
): PlaywrightRuntimePolicyInput => ({
  title: 'chromium › renders an update',
  expectedStatus: 'passed',
  outcome: 'expected',
  resultStatus: 'passed',
  retry: 0,
  repeatEachIndex: 0,
  annotations: [],
  repeatedAttempts: [],
  ...overrides,
});

describe('Playwright runtime test policy', () => {
  it('accepts an ordinary first-attempt execution', () => {
    expect(findPlaywrightRuntimePolicyViolations([passed()])).toEqual([]);
  });

  it('rejects runtime skips, expected failures, retries and repeat-each executions', () => {
    expect(
      findPlaywrightRuntimePolicyViolations([
        passed({ title: 'skipped', expectedStatus: 'skipped', resultStatus: 'skipped' }),
        passed({ title: 'expected failure', expectedStatus: 'failed' }),
        passed({ title: 'flaky', outcome: 'flaky', retry: 1 }),
        passed({ title: 'repeated', repeatEachIndex: 1 }),
        passed({ title: 'annotated', annotations: ['fixme'] }),
      ]),
    ).toEqual([
      'skipped: expected status is skipped',
      'skipped: runtime result is skipped',
      'expected failure: expected status is failed',
      'flaky: outcome is flaky',
      'flaky: test required retry 1',
      'repeated: repeat-each index is 1',
      'annotated: forbidden annotation fixme',
    ]);
  });

  it('lists a step a test started again at the end of the run, and the run still passes', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const reporter = new PlaywrightZeroSkipReporter();
    const reload = 'the preview frame fired no load within 20 s; reload 2 of 3';
    reporter.onTestEnd(
      {
        titlePath: () => [
          'webkit',
          'surface-session.spec.ts',
          'a reloaded frame is the public page',
        ],
        expectedStatus: 'passed',
        outcome: () => 'expected',
        repeatEachIndex: 0,
        annotations: [{ type: REPEATED_ATTEMPT, description: reload }],
      } as unknown as TestCase,
      { status: 'passed', retry: 0 } as TestResult,
    );

    await expect(reporter.onEnd({ status: 'passed' } as FullResult)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      `Steps a test started again (1, allowed):\n- webkit › surface-session.spec.ts › a reloaded frame is the public page: ${reload}`,
    );
    log.mockRestore();
  });
});
