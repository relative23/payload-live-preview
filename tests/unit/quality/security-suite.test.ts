/**
 * The suite is a list of names, and a name that no run can show would refuse
 * every publish, while a job the list forgot would be skipped unseen. These
 * tests hold the list to the two workflows that give the jobs their names.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECURITY_SUITE, runJobsFrom, securitySuiteProblem } from '../../../scripts/security-suite';
import { parseWorkflow } from '../../../scripts/workflow-contracts';

interface Job {
  readonly name?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly strategy?: { readonly matrix?: Readonly<Record<string, unknown>> };
}
const jobsOf = (file: string): Readonly<Record<string, Job>> =>
  parseWorkflow(readFileSync(`.github/workflows/${file}`, 'utf8'))['jobs'] as Record<string, Job>;
const ci = jobsOf('ci.yml');
const gates = jobsOf('critical-gates.yml');
const caller = Object.values(ci).find(
  (job) => job.uses === './.github/workflows/critical-gates.yml',
);

/** Every name a job's instances get: its template with each combination of the matrix lists. */
function instanceNames(job: Job, prefix: string): readonly string[] {
  let names = [job.name ?? ''];
  for (const [key, values] of Object.entries(job.strategy?.matrix ?? {})) {
    if (!Array.isArray(values)) continue;
    const slot = `\${{ matrix.${key} }}`;
    names = names.flatMap((name) =>
      name.includes(slot) ? values.map((value) => name.replaceAll(slot, String(value))) : [name],
    );
  }
  return names.map((name) => `${prefix}${name}`);
}

describe('the security suite and the workflows', () => {
  it('names each job as a run does, every instance of it', () => {
    for (const entry of SECURITY_SUITE) {
      const own = ci[entry.job];
      const job = own ?? gates[entry.job];
      expect(job, `no job "${entry.job}" in ci.yml or critical-gates.yml`).toBeDefined();
      const prefix = own === undefined ? `${caller?.name ?? ''} / ` : '';
      expect([...entry.names].sort(), entry.job).toEqual([...instanceNames(job!, prefix)].sort());
      expect(entry.names.join(), entry.job).not.toContain('${{');
    }
  });

  it('names no job of ci.yml that a condition can turn off', () => {
    const conditional = SECURITY_SUITE.filter((entry) => ci[entry.job]?.if !== undefined);
    expect(conditional.map((entry) => entry.job)).toEqual([]);
  });
});

describe('the suite in a run', () => {
  const all = (conclusion: string) =>
    SECURITY_SUITE.flatMap((entry) => entry.names).map((name) => ({ name, conclusion }));

  it('has nothing to say when every job ended success, whatever else the run holds', () => {
    expect(
      securitySuiteProblem(
        [...all('success'), { name: 'Dependency Review', conclusion: 'skipped' }],
        '7',
      ),
    ).toBeUndefined();
  });

  it('names each job that is missing, skipped or cancelled, with what it proves', () => {
    const jobs = all('success')
      .filter((job) => job.name !== 'Coverage')
      .map((job) =>
        job.name === 'Fixture Dependency Audit'
          ? { ...job, conclusion: 'cancelled' }
          : job.name === 'Unit Tests (Node 24)'
            ? { name: job.name, conclusion: null }
            : job,
      );
    expect(securitySuiteProblem(jobs, '7')).toBe(
      'CI run 7 does not carry the security suite, and a publish from main needs every job of it to have ended success:\n' +
        '- "Unit Tests (Node 24)" ended without a conclusion (the negative cases of the unit suite: tokens, sessions, messages, the sanitizer corpus, fragment scope)\n' +
        '- "Coverage" did not run (the coverage floors of the critical files and the changed-line gate)\n' +
        '- "Fixture Dependency Audit" ended cancelled (no known advisory in what the examples install)',
    );
  });

  it('reads one job per line and refuses a line that is no job', () => {
    expect(
      runJobsFrom('{"name":"A","conclusion":"success"}\n\n{"name":"B","conclusion":null}\n'),
    ).toEqual([
      { name: 'A', conclusion: 'success' },
      { name: 'B', conclusion: null },
    ]);
    expect(() => runJobsFrom('{"conclusion":"success"}')).toThrow('a job of the run is malformed');
  });
});
