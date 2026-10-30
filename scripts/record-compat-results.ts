/**
 * Record the CI run a release ships as the result of the compatibility rows it ran. The Version
 * PR job runs this from `changesets/action`'s version command (`npm run version:release`), after
 * the action has reset the tree, so the record moves with each release and nothing between
 * releases writes to the repository. A row may only name an unconditional job that cannot fail
 * softly (`compat:check`), so a green run means every such row passed.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompatEvidenceCell } from './compat-evidence';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RESULTS_PATH = 'quality/compat-results.json';
const MATRIX_PATH = 'quality/compat-matrix.json';
/** ci.yml and the workflow it calls for its Build job: one run decides both. */
const RECORDED_WORKFLOWS = new Set(['ci.yml', 'build.yml']);

export interface CiRun {
  readonly id: number;
  readonly url: string;
  readonly commit: string;
  readonly event: string;
  readonly conclusion: string;
  readonly executedAt: string;
}

export interface RunJob {
  readonly name: string;
  readonly conclusion: string;
}

/** What the record file says about the run; its digest is what each passed row names. */
export function resultsFile(run: CiRun, jobs: readonly RunJob[]): string {
  const sorted = [...jobs].sort((left, right) => (left.name < right.name ? -1 : 1));
  return `${JSON.stringify({ workflow: 'ci.yml', ...run, jobs: sorted }, null, 2)}\n`;
}

/** Why this run cannot stand for a release, or nothing when it can. */
export function runProblems(run: CiRun, jobs: readonly RunJob[], head: string): readonly string[] {
  const problems: string[] = [];
  if (run.conclusion !== 'success') {
    problems.push(`run ${String(run.id)} concluded ${run.conclusion}`);
  }
  if (run.event !== 'push') problems.push(`run ${String(run.id)} was a ${run.event}, not a push`);
  if (run.commit !== head) problems.push(`run ${String(run.id)} tested ${run.commit}, not ${head}`);
  const failed = jobs.filter((job) => job.conclusion !== 'success' && job.conclusion !== 'skipped');
  for (const job of failed) problems.push(`job "${job.name}" concluded ${job.conclusion}`);
  return problems;
}

/**
 * Every configured or passed row of the two workflows the run covers, at an exact version,
 * becomes passed with this result. A floating range stays configured: the schema refuses a pass
 * for a version nobody pinned.
 */
export function recordResults(
  cells: readonly CompatEvidenceCell[],
  run: CiRun,
  digest: string,
): CompatEvidenceCell[] {
  return cells.map((cell) => {
    const workflow = cell.evidence.workflow?.file;
    const recordable =
      (cell.evidence.status === 'configured' || cell.evidence.status === 'passed') &&
      workflow !== undefined &&
      RECORDED_WORKFLOWS.has(workflow) &&
      cell.version.configuredRange === undefined;
    if (!recordable) return cell;
    return {
      ...cell,
      evidence: {
        ...cell.evidence,
        status: 'passed',
        result: {
          path: RESULTS_PATH,
          sha256: digest,
          commit: run.commit,
          executedAt: run.executedAt,
          conclusion: 'success',
        },
      },
    };
  });
}

function gh(args: readonly string[]): string {
  return execFileSync('gh', [...args], { encoding: 'utf8' }).trim();
}

function main(): void {
  const id = process.env['PLP_CI_RUN_ID'];
  const repository = process.env['GITHUB_REPOSITORY'];
  if (id === undefined || !/^[1-9]\d*$/u.test(id) || repository === undefined) {
    throw new Error('record-compat-results: set PLP_CI_RUN_ID and GITHUB_REPOSITORY');
  }
  const raw = JSON.parse(gh(['api', `repos/${repository}/actions/runs/${id}`])) as {
    html_url: string;
    head_sha: string;
    event: string;
    conclusion: string | null;
    updated_at: string;
  };
  const run: CiRun = {
    id: Number(id),
    url: raw.html_url,
    commit: raw.head_sha,
    event: raw.event,
    conclusion: raw.conclusion ?? 'pending',
    executedAt: raw.updated_at,
  };
  const jobs = gh([
    'api',
    '--paginate',
    `repos/${repository}/actions/runs/${id}/jobs?per_page=100`,
    '--jq',
    '.jobs[] | {name, conclusion}',
  ])
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunJob);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const problems = runProblems(run, jobs, head);
  if (problems.length > 0) throw new Error(`record-compat-results: ${problems.join('; ')}`);

  const file = resultsFile(run, jobs);
  writeFileSync(resolve(ROOT, RESULTS_PATH), file);
  const digest = createHash('sha256').update(file).digest('hex');
  const matrix = JSON.parse(readFileSync(resolve(ROOT, MATRIX_PATH), 'utf8')) as {
    featureEvidence: CompatEvidenceCell[];
  };
  matrix.featureEvidence = recordResults(matrix.featureEvidence, run, digest);
  writeFileSync(resolve(ROOT, MATRIX_PATH), `${JSON.stringify(matrix, null, 2)}\n`);
  const passed = matrix.featureEvidence.filter((cell) => cell.evidence.status === 'passed');
  console.log(
    `record-compat-results: run ${id} (${run.commit}) recorded for ${String(passed.length)} rows`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) main();
