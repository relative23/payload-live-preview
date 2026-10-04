/**
 * npm uses the runner's GitHub environment for provenance, even after checkout changes.
 * Run the committed publish command with a recording npm so maintenance and manual releases keep their certified source identity.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runReleaseGate, type CommandResult } from '../../../scripts/release-gate';
import { parseWorkflow } from '../../../scripts/workflow-contracts';

const REPOSITORY = 'relative23/payload-live-preview';
const CERTIFIED_SHA = 'a'.repeat(40);
const DEFAULT_SHA = 'b'.repeat(40);
const directories: string[] = [];
const workflow = parseWorkflow(readFileSync('.github/workflows/release.yml', 'utf8'));
interface Job {
  readonly outputs?: Record<string, string>;
  readonly steps: { name?: string; env?: Record<string, string>; run?: string }[];
}
const jobs = workflow['jobs'] as Record<string, Job>;

function gate(branch: string, runId = '42') {
  const ok = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '' });
  return runReleaseGate({
    repository: REPOSITORY,
    runId,
    run: (executable, args) => {
      const command = `${executable} ${args.join(' ')}`;
      if (command === `gh api repos/${REPOSITORY}/actions/runs/42`) {
        return ok(
          JSON.stringify({
            id: 42,
            name: 'CI',
            event: 'push',
            head_branch: branch,
            head_sha: CERTIFIED_SHA,
            status: 'completed',
            conclusion: 'success',
            head_repository: { full_name: REPOSITORY },
          }),
        );
      }
      if (command === `git merge-base --is-ancestor ${CERTIFIED_SHA} origin/${branch}`) return ok();
      if (command === `git show ${CERTIFIED_SHA}:package.json`) {
        return ok(JSON.stringify({ name: 'payload-live-preview', version: '2.0.6' }));
      }
      if (command.startsWith('git ls-tree')) return ok('.changeset/README.md\n');
      if (command.startsWith('npm view')) return { status: 1, stdout: '', stderr: 'E404' };
      if (command.startsWith('git rev-parse')) return { status: 1, stdout: '', stderr: '' };
      if (command.startsWith('gh api repos/') && command.includes('/releases/')) {
        return { status: 1, stdout: '', stderr: 'HTTP 404' };
      }
      throw new Error(`unexpected release command ${command}`);
    },
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('certified npm provenance source', () => {
  it.each(['main', 'release/1.x', 'release/2.0'])('outputs the verified %s branch', (branch) => {
    expect(gate(branch)).toMatchObject({ tested_sha: CERTIFIED_SHA, tested_branch: branch });
  });

  it.each(['workflow_run', 'workflow_dispatch'])(
    'passes certified SHA and ref to npm on %s',
    (event) => {
      const gateStep = jobs['gate']?.steps.find(
        (step) => step.run === 'npx tsx scripts/release-gate.ts',
      );
      const runExpression = gateStep?.env?.['RELEASE_RUN_ID'];
      expect(runExpression).toBe('${{ inputs.run_id || github.event.workflow_run.id }}');
      const inputs = event === 'workflow_dispatch' ? { run_id: '42' } : { run_id: '' };
      const completedRun = event === 'workflow_run' ? { id: '42' } : undefined;
      const outputs = gate('release/2.0', inputs.run_id || completedRun?.id) as unknown as Record<
        string,
        string
      >;
      const carried = Object.fromEntries(
        Object.entries(jobs['gate']?.outputs ?? {}).map(([key, expression]) => {
          const match = /^\$\{\{ steps\.release_gate\.outputs\.([a-z_]+) \}\}$/u.exec(expression);
          if (match === null) throw new Error(`unexpected gate output ${expression}`);
          return [key, outputs[match[1] ?? ''] ?? ''];
        }),
      );
      const publish = jobs['publish']?.steps.find(
        (step) => step.name === 'Publish with provenance',
      );
      if (publish?.run === undefined) throw new Error('missing publish command');
      const environment = Object.fromEntries(
        Object.entries(publish.env ?? {}).map(([key, expression]) => [
          key,
          expression
            .replace(
              /\$\{\{ needs\.gate\.outputs\.([a-z_]+) \}\}/gu,
              (_, output: string) => carried[output] ?? '',
            )
            .replace('${{ steps.source_date.outputs.epoch }}', '1791072000'),
        ]),
      );
      const directory = mkdtempSync(join(tmpdir(), 'plp-provenance-'));
      directories.push(directory);
      writeFileSync(
        join(directory, 'npm'),
        '#!/bin/sh\nprintf "%s\\n" "$GITHUB_SHA" "$GITHUB_REF" "$GITHUB_WORKFLOW_REF" "$GITHUB_RUN_ID" "$*"\n',
        { mode: 0o700 },
      );
      const identity = {
        GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/release.yml@refs/heads/main`,
        GITHUB_RUN_ID: '99',
      };
      const actual = spawnSync(
        'bash',
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', publish.run],
        {
          env: {
            ...process.env,
            ...identity,
            ...environment,
            PATH: `${directory}:/usr/bin:/bin`,
            GITHUB_SHA: DEFAULT_SHA,
            GITHUB_REF: 'refs/heads/main',
            GITHUB_EVENT_NAME: event,
          },
          encoding: 'utf8',
          timeout: 5_000,
          killSignal: 'SIGKILL',
        },
      );
      expect(actual.error).toBeUndefined();
      expect(actual.signal).toBeNull();
      expect(actual.status).toBe(0);
      expect(actual.stdout.trimEnd().split('\n')).toEqual([
        CERTIFIED_SHA,
        'refs/heads/release/2.0',
        identity.GITHUB_WORKFLOW_REF,
        identity.GITHUB_RUN_ID,
        'run release',
      ]);
    },
  );
});
