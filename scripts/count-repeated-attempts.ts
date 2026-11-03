/**
 * The CI run's total of steps the real-admin suites started again. Each job's reporter writes
 * its list (`scripts/playwright-zero-skip-reporter.ts`); this sums the lists across the run and
 * fails it past the budget, so a stall that grows common is looked into rather than absorbed.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Restarts one CI run may need across its real-admin jobs. Measured 2026-11-03: none in the 435
 * real-admin jobs of 11 runs. Two independent stalls in one run stay inside it; a third says the
 * stall is no longer rare.
 */
export const REPEATED_ATTEMPT_BUDGET = 2;

export interface JobAttempts {
  /** The artifact the job uploaded its list under. */
  readonly job: string;
  readonly attempts: readonly string[];
}

/**
 * Every `<artifact>/repeated-attempts.json` under the directory the CI job downloaded them to.
 * With no artifact at all the directory never appears, and the report says no job reported.
 */
export function readJobAttempts(directory: string): JobAttempts[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((job) => {
      const parsed: unknown = JSON.parse(
        readFileSync(join(directory, job, 'repeated-attempts.json'), 'utf8'),
      );
      const attempts =
        typeof parsed === 'object' && parsed !== null && 'attempts' in parsed
          ? parsed.attempts
          : undefined;
      if (!Array.isArray(attempts) || !attempts.every((item) => typeof item === 'string')) {
        throw new Error(`${job}: repeated-attempts.json has no list of strings`);
      }
      return { job, attempts };
    });
}

export interface AttemptsVerdict {
  readonly total: number;
  readonly report: string;
  readonly overBudget: boolean;
}

export function attemptsVerdict(
  jobs: readonly JobAttempts[],
  budget = REPEATED_ATTEMPT_BUDGET,
): AttemptsVerdict {
  const total = jobs.reduce((sum, job) => sum + job.attempts.length, 0);
  const lines = jobs.flatMap((job) => job.attempts.map((attempt) => `- ${job.job}: ${attempt}`));
  const heading =
    `Steps the real-admin suites started again in this run: ${String(total)} ` +
    `(budget ${String(budget)}, ${String(jobs.length)} jobs reported)`;
  return {
    total,
    report: [heading, ...lines].join('\n'),
    overBudget: total > budget,
  };
}

function main(): void {
  const directory = resolve(process.argv[2] ?? 'repeated-attempts');
  const verdict = attemptsVerdict(readJobAttempts(directory));
  console.log(verdict.report);
  if (verdict.overBudget) {
    console.error(
      `More steps were started again than the budget allows. A stall that should be rare happened ` +
        `${String(verdict.total)} times in one run: find what slowed the frames before running again.`,
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) main();
