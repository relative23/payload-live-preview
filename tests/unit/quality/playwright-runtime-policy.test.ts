import { describe, expect, it } from 'vitest';
import {
  findPlaywrightRuntimePolicyViolations,
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
});
