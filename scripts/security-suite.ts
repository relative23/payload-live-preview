/**
 * The jobs of a CI push run that a publish from main needs by name. A run ends
 * `success` with a job skipped, and the release gate read the run's conclusion
 * alone: a condition that turned one of these off, or a plan that left one
 * out, would have let a publish through without it. Each entry names the job
 * in `ci.yml` and the names a run gives its instances, so the workflow
 * contract can hold the list to the workflow.
 */

export interface SecuritySuiteJob {
  /** The job's key in `.github/workflows/ci.yml`, or in the workflow it calls. */
  readonly job: string;
  /** What the job proves, for whoever reads a refusal. */
  readonly proves: string;
  /** The name of every instance a run shows, matrix values and caller prefix written out. */
  readonly names: readonly string[];
}

export const SECURITY_SUITE: readonly SecuritySuiteJob[] = [
  {
    job: 'unit',
    proves:
      'the negative cases of the unit suite: tokens, sessions, messages, the sanitizer corpus, fragment scope',
    names: ['24', '26'].map((node) => `Unit Tests (Node ${node})`),
  },
  {
    job: 'coverage',
    proves: 'the coverage floors of the critical files and the changed-line gate',
    names: ['Coverage'],
  },
  {
    job: 'fixture-audit',
    proves: 'no known advisory in what the examples install',
    names: ['Fixture Dependency Audit'],
  },
  {
    job: 'production-lifecycle',
    proves: 'authorization, sessions and cache headers on the packed archive, per host',
    names: ['next', 'sveltekit', 'nuxt', 'html', 'vue', 'react'].map(
      (framework) => `Production lifecycle (${framework})`,
    ),
  },
  {
    job: 'quickstart-replay',
    proves:
      'the quickstarts of the README in fresh projects on the packed archive: no runtime for a visitor, no preview in a shared cache',
    names: ['Quickstart replay (README)'],
  },
  {
    job: 'real-payload-csrf',
    proves: 'the session strategy against a real admin with a CSRF list',
    names: ['nextjs', 'nextjs-hook'].map((target) => `Real Payload E2E (${target}, CSRF list)`),
  },
  {
    job: 'trusted-core-mutation',
    proves: 'the mutation score of the trusted core, on the commit to be published',
    names: ['Release Gates / Trusted Core Mutation'],
  },
  {
    job: 'critical-mutation-baseline',
    proves: 'the mutation baseline of the critical files, on the commit to be published',
    names: ['Release Gates / Release Critical Mutation Baseline'],
  },
];

export interface RunJob {
  readonly name: string;
  readonly conclusion: string | null;
}

/** The jobs of a run as the gate's `--jq` prints them, one object per line across pages. */
export function runJobsFrom(stdout: string): readonly RunJob[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line): RunJob => {
      const entry: unknown = JSON.parse(line);
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as Record<string, unknown>)['name'] !== 'string'
      ) {
        throw new Error(`a job of the run is malformed: ${line}`);
      }
      const { name, conclusion } = entry as { name: string; conclusion: unknown };
      return { name, conclusion: typeof conclusion === 'string' ? conclusion : null };
    });
}

/**
 * Why the run does not carry the suite, or `undefined`. Every named job has to
 * be there and to have ended `success`: skipped, cancelled and missing are all
 * the same to a publish, which is that the proof was not given.
 */
export function securitySuiteProblem(
  jobs: readonly RunJob[],
  runId: string,
  suite: readonly SecuritySuiteJob[] = SECURITY_SUITE,
): string | undefined {
  const findings: string[] = [];
  for (const entry of suite) {
    for (const name of entry.names) {
      const instances = jobs.filter((job) => job.name === name);
      if (instances.length === 0) {
        findings.push(`"${name}" did not run (${entry.proves})`);
        continue;
      }
      const other = instances.find((job) => job.conclusion !== 'success');
      if (other !== undefined) {
        findings.push(
          `"${name}" ended ${other.conclusion ?? 'without a conclusion'} (${entry.proves})`,
        );
      }
    }
  }
  if (findings.length === 0) return undefined;
  return (
    `CI run ${runId} does not carry the security suite, and a publish from main needs every job ` +
    `of it to have ended success:\n${findings.map((finding) => `- ${finding}`).join('\n')}`
  );
}
