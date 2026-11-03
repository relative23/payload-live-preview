import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REPEATED_ATTEMPT_BUDGET,
  attemptsVerdict,
  readJobAttempts,
} from '../../../scripts/count-repeated-attempts';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

/** The directory `actions/download-artifact` leaves: one folder per uploaded job. */
function downloaded(jobs: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), 'plp-attempts-'));
  directories.push(directory);
  for (const [job, content] of Object.entries(jobs)) {
    mkdirSync(join(directory, job));
    writeFileSync(join(directory, job, 'repeated-attempts.json'), JSON.stringify(content));
  }
  return directory;
}

const stall = (test: string) =>
  `webkit › ${test}: the preview frame had not loaded 20 s after the panel opened (unreadable, navigating); its load started again`;

describe('the run-wide count of steps the real-admin suites started again', () => {
  it('sums the list every job uploaded, and names each step with its job', () => {
    const jobs = readJobAttempts(
      downloaded({
        'repeated-attempts-real-payload-nuxt-webkit': { attempts: [stall('smoke')] },
        'repeated-attempts-real-payload-nextjs-chromium': { attempts: [] },
      }),
    );
    const verdict = attemptsVerdict(jobs);
    expect(verdict.total).toBe(1);
    expect(verdict.overBudget).toBe(false);
    expect(verdict.report).toBe(
      [
        'Steps the real-admin suites started again in this run: 1 (budget 2, 2 jobs reported)',
        `- repeated-attempts-real-payload-nuxt-webkit: ${stall('smoke')}`,
      ].join('\n'),
    );
  });

  it('passes the run at its budget and fails it one step past', () => {
    const run = (count: number) =>
      attemptsVerdict([
        {
          job: 'repeated-attempts-real-payload-nuxt-webkit',
          attempts: Array.from({ length: count }, (_, index) => stall(`case ${String(index)}`)),
        },
      ]);
    expect(run(REPEATED_ATTEMPT_BUDGET).overBudget).toBe(false);
    expect(run(REPEATED_ATTEMPT_BUDGET + 1).overBudget).toBe(true);
  });

  it('counts across jobs, so a stall spread thin still adds up', () => {
    const jobs = ['nuxt-webkit', 'sveltekit-webkit', 'nextjs-firefox'].map((job) => ({
      job: `repeated-attempts-real-payload-${job}`,
      attempts: [stall('smoke')],
    }));
    expect(attemptsVerdict(jobs)).toMatchObject({ total: 3, overBudget: true });
  });

  it('reports no job when nothing was downloaded', () => {
    const verdict = attemptsVerdict(readJobAttempts(join(tmpdir(), 'plp-attempts-never-made')));
    expect(verdict).toMatchObject({ total: 0, overBudget: false });
    expect(verdict.report).toContain('0 jobs reported');
  });

  it('refuses a list it cannot read instead of counting it as none', () => {
    expect(() =>
      readJobAttempts(downloaded({ 'repeated-attempts-real-payload': { attempts: [1] } })),
    ).toThrow(/repeated-attempts-real-payload: repeated-attempts.json has no list of strings/u);
    expect(() =>
      readJobAttempts(downloaded({ 'repeated-attempts-real-payload': { steps: [] } })),
    ).toThrow(/no list of strings/u);
  });
});
