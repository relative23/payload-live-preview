import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import type { CompatEvidenceCell } from '../../scripts/compat-evidence';
import {
  RESULTS_PATH,
  recordResults,
  resultsFile,
  runProblems,
  type CiRun,
} from '../../scripts/record-compat-results';

/**
 * A Version PR turns the compatibility rows of the CI run it releases into `passed`. These hold
 * which run may stand for a release, which rows it may pass, and that the file whose digest the
 * rows carry is the file the repository keeps.
 */

const RUN: CiRun = {
  id: 41078617479,
  url: 'https://github.com/owner/repo/actions/runs/41078617479',
  commit: 'fae838f6e331fae6c9b0c05e6386473aeb13b938',
  event: 'push',
  conclusion: 'success',
  executedAt: '2026-10-30T18:00:00Z',
};

function cell(
  id: string,
  evidence: Partial<CompatEvidenceCell['evidence']>,
  configuredRange?: string,
): CompatEvidenceCell {
  return {
    id,
    surface: 'Astro',
    feature: 'f',
    version: {
      kind: 'exact',
      value: '1.0.0',
      package: 'astro',
      source: { kind: 'root-package' },
      ...(configuredRange === undefined ? {} : { configuredRange }),
    },
    mode: 'development',
    packageForm: 'copied-local-package',
    backend: 'b',
    browsers: ['chromium'],
    evidence: { status: 'configured', sources: ['a.ts'], ...evidence },
  };
}

describe('the run a release may record', () => {
  it('is a green push run of the commit the Version PR is cut from', () => {
    expect(runProblems(RUN, [{ name: 'Lint', conclusion: 'success' }], RUN.commit)).toEqual([]);
  });

  it('refuses a red run, a pull-request run, another commit and a failed job', () => {
    expect(
      runProblems(
        { ...RUN, conclusion: 'failure', event: 'pull_request' },
        [
          { name: 'E2E (webkit)', conclusion: 'failure' },
          { name: 'Optional', conclusion: 'skipped' },
        ],
        '0'.repeat(40),
      ),
    ).toEqual([
      'run 41078617479 concluded failure',
      'run 41078617479 was a pull_request, not a push',
      `run 41078617479 tested ${RUN.commit}, not ${'0'.repeat(40)}`,
      'job "E2E (webkit)" concluded failure',
    ]);
  });
});

describe('the rows it passes', () => {
  it('passes configured and earlier passed rows of ci.yml and build.yml, at an exact version', () => {
    const cells = [
      cell('ci', { workflow: { file: 'ci.yml', job: 'e2e' } }),
      cell('build', { workflow: { file: 'build.yml', job: 'build' } }),
      cell('again', {
        status: 'passed',
        workflow: { file: 'ci.yml', job: 'e2e' },
        result: {
          path: RESULTS_PATH,
          sha256: 'a'.repeat(64),
          commit: 'b'.repeat(40),
          executedAt: '2026-10-01T00:00:00Z',
          conclusion: 'success',
        },
      }),
    ];
    const recorded = recordResults(cells, RUN, 'c'.repeat(64));

    for (const row of recorded) {
      expect(row.evidence.status, row.id).toBe('passed');
      expect(row.evidence.result, row.id).toEqual({
        path: RESULTS_PATH,
        sha256: 'c'.repeat(64),
        commit: RUN.commit,
        executedAt: RUN.executedAt,
        conclusion: 'success',
      });
      expect(row.evidence.workflow, row.id).toBeDefined();
    }
  });

  it('leaves a floating range, another workflow, an open row and a command-only row alone', () => {
    const cells = [
      cell('floating', { workflow: { file: 'ci.yml', job: 'astro-matrix' } }, '^6'),
      cell('watch', { workflow: { file: 'latest-watch.yml', job: 'frameworks' } }),
      cell('open', { status: 'open' }),
      cell('command', { command: 'npm run bench' }),
    ];

    expect(recordResults(cells, RUN, 'c'.repeat(64))).toEqual(cells);
  });
});

describe('the record file', () => {
  it('lists the jobs in a fixed order and is already in the form Prettier keeps', async () => {
    const file = resultsFile(RUN, [
      { name: 'Lint', conclusion: 'success' },
      { name: 'E2E (chromium)', conclusion: 'success' },
    ]);
    const parsed = JSON.parse(file) as { jobs: { name: string }[]; workflow: string };

    expect(parsed.workflow).toBe('ci.yml');
    expect(parsed.jobs.map(({ name }) => name)).toEqual(['E2E (chromium)', 'Lint']);
    // The rows carry the digest of these bytes, so formatting must not change them.
    expect(await format(file, { parser: 'json' })).toBe(file);
  });
});
