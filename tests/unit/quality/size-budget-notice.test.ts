import { describe, expect, it } from 'vitest';
import { improvementNotice, isBudgetImprovement } from '../../../scripts/size-budget-notice';

describe('size budget improvement notice', () => {
  it('stays silent while a measurement is within 2% of its budget', () => {
    expect(isBudgetImprovement(9_800, 10_000)).toBe(false);
    expect(improvementNotice('inline script', 9_801, 10_000)).toBeUndefined();
  });

  it('reports a measurement that dropped more than 2% below the budget', () => {
    expect(improvementNotice('inline script', 9_000, 10_000)).toBe(
      '[improvement] inline script gzip 9000 is 10.0% below its 10000 byte budget; lower the budget',
    );
  });

  it('names the metric it measured', () => {
    expect(improvementNotice('dist/core.js', 100, 1_000, 'brotli')).toContain('brotli 100');
  });

  it('never reports a measurement at or over its budget', () => {
    expect(improvementNotice('over', 10_001, 10_000)).toBeUndefined();
    expect(improvementNotice('exact', 10_000, 10_000)).toBeUndefined();
  });

  it('treats a zero budget as unmeasurable rather than an infinite improvement', () => {
    expect(isBudgetImprovement(0, 0)).toBe(false);
  });
});
