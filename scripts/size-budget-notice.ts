/**
 * A budget that sits far above its measurement has stopped being a budget, so
 * a drop of more than 2 % is reported and the number gets tightened
 * deliberately. It never fails a run: a smaller artifact is not a defect.
 */

const IMPROVEMENT_RATIO = 0.02;

export function isBudgetImprovement(actual: number, limit: number): boolean {
  return limit > 0 && actual < limit && (limit - actual) / limit > IMPROVEMENT_RATIO;
}

export function improvementNotice(
  label: string,
  actual: number,
  limit: number,
  metric = 'gzip',
): string | undefined {
  if (!isBudgetImprovement(actual, limit)) return undefined;
  const percent = (((limit - actual) / limit) * 100).toFixed(1);
  return `[improvement] ${label} ${metric} ${String(actual)} is ${percent}% below its ${String(limit)} byte budget; lower the budget`;
}
