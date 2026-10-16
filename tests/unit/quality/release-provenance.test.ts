/**
 * A checkout cannot change the workflow source identity signed by GitHub.
 * Execute the committed release shell against recording tools so routing, drift refusal and the source receiver stay coupled to the workflow actually run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
interface Step {
  readonly name?: string;
  readonly env?: Record<string, string>;
  readonly run?: string;
  readonly if?: string;
}
interface Job {
  readonly if?: string;
  readonly permissions?: Record<string, string>;
  readonly outputs?: Record<string, string>;
  readonly steps: Step[];
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

function step(job: string, name: string): Step {
  const found = jobs[job]?.steps.find((candidate) => candidate.name === name);
  if (found?.run === undefined) throw new Error(`missing ${job} step ${name}`);
  return found;
}

function execute(command: Step, overrides: Record<string, string> = {}, branch = 'release/2.0') {
  const outputs = gate(branch) as unknown as Record<string, string>;
  const carried = Object.fromEntries(
    Object.entries(jobs['gate']?.outputs ?? {}).map(([key, expression]) => {
      const match = /^\$\{\{ steps\.release_gate\.outputs\.([a-z_]+) \}\}$/u.exec(expression);
      if (match === null) throw new Error(`unexpected gate output ${expression}`);
      return [key, outputs[match[1] ?? ''] ?? ''];
    }),
  );
  const environment = Object.fromEntries(
    Object.entries(command.env ?? {}).map(([key, expression]) => [
      key,
      expression
        .replace(
          /\$\{\{ needs\.gate\.outputs\.([a-z_]+) \}\}/gu,
          (_, name: string) => carried[name] ?? '',
        )
        .replace(
          /\$\{\{ steps\.release_gate\.outputs\.([a-z_]+) \}\}/gu,
          (_, name: string) => outputs[name] ?? '',
        )
        .replace('${{ steps.source_date.outputs.epoch }}', '1791072000')
        .replace('${{ github.token }}', 'recording-token'),
    ]),
  );
  const directory = mkdtempSync(join(tmpdir(), 'plp-source-'));
  directories.push(directory);
  writeFileSync(
    join(directory, 'npm'),
    '#!/bin/sh\nprintf "%s\\n" "$GITHUB_SHA" "$GITHUB_REF" "$GITHUB_WORKFLOW_SHA" "$GITHUB_WORKFLOW_REF" "$GITHUB_RUN_ID" "$*" > "$RUNNER_TEMP/npm-call"\n',
    { mode: 0o700 },
  );
  writeFileSync(
    join(directory, 'gh'),
    [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$RUNNER_TEMP/gh-calls"',
      'case "$*" in',
      '  "api repos/$GITHUB_REPOSITORY/git/ref/heads/"*)',
      '    if [ "$MOCK_REF_STATUS" != "0" ]; then exit "$MOCK_REF_STATUS"; fi',
      '    printf "%s\\n" "$MOCK_REF_HEAD" ;;',
      '  "api repos/$GITHUB_REPOSITORY/contents/.github/workflows/release.yml?ref="*)',
      '    if [ "$*" = "api repos/$GITHUB_REPOSITORY/contents/.github/workflows/release.yml?ref=$GITHUB_WORKFLOW_SHA --jq .sha" ]; then',
      '      if [ "$MOCK_ROUTER_WORKFLOW_STATUS" != "0" ]; then exit "$MOCK_ROUTER_WORKFLOW_STATUS"; fi',
      '      printf "%s\\n" "$MOCK_ROUTER_WORKFLOW"',
      '    else',
      '      if [ "$MOCK_SOURCE_WORKFLOW_STATUS" != "0" ]; then exit "$MOCK_SOURCE_WORKFLOW_STATUS"; fi',
      '      printf "%s\\n" "$MOCK_SOURCE_WORKFLOW"',
      '    fi ;;',
      '  "api --method POST repos/$GITHUB_REPOSITORY/actions/workflows/release.yml/dispatches --input "*)',
      '    while [ "$#" -gt 0 ]; do',
      '      if [ "$1" = "--input" ]; then cp "$2" "$RUNNER_TEMP/dispatched.json"; break; fi',
      '      shift',
      '    done',
      '    exit "$MOCK_DISPATCH_STATUS" ;;',
      '  *) echo "unexpected mocked gh call" >&2; exit 90 ;;',
      'esac',
    ].join('\n'),
    { mode: 0o700 },
  );
  const actual = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', command.run ?? ''],
    {
      env: {
        ...process.env,
        ...environment,
        PATH: `${directory}:/usr/bin:/bin`,
        RUNNER_TEMP: directory,
        GITHUB_REPOSITORY: REPOSITORY,
        GITHUB_SHA: CERTIFIED_SHA,
        GITHUB_REF: `refs/heads/${branch}`,
        GITHUB_WORKFLOW_SHA: overrides['GITHUB_SHA'] ?? CERTIFIED_SHA,
        GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/release.yml@${overrides['GITHUB_REF'] ?? `refs/heads/${branch}`}`,
        GITHUB_RUN_ID: '99',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        MOCK_REF_HEAD: CERTIFIED_SHA,
        MOCK_REF_STATUS: '0',
        MOCK_DISPATCH_STATUS: '0',
        MOCK_ROUTER_WORKFLOW: 'c'.repeat(40),
        MOCK_SOURCE_WORKFLOW: 'c'.repeat(40),
        MOCK_ROUTER_WORKFLOW_STATUS: '0',
        MOCK_SOURCE_WORKFLOW_STATUS: '0',
        ...overrides,
      },
      encoding: 'utf8',
      timeout: 5_000,
      killSignal: 'SIGKILL',
    },
  );
  expect(actual.error).toBeUndefined();
  expect(actual.signal).toBeNull();
  const read = (name: string) =>
    existsSync(join(directory, name))
      ? readFileSync(join(directory, name), 'utf8').trimEnd()
      : undefined;
  return {
    ...actual,
    directory,
    npm: read('npm-call'),
    gh: read('gh-calls'),
    dispatched: read('dispatched.json'),
  };
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

  it('re-certifies the requested CI run for a source dispatch', () => {
    const gateStep = jobs['gate']?.steps.find(
      (candidate) => candidate.run === 'npx tsx scripts/release-gate.ts',
    );
    expect(gateStep?.env?.['RELEASE_RUN_ID']).toBe(
      '${{ inputs.run_id || github.event.workflow_run.id }}',
    );
    expect(gate('release/2.0', '42')).toMatchObject({ run_id: '42', publish: 'true' });
  });

  it.each(['main', 'release/1.x', 'release/2.0'])(
    'publishes only with the actual certified %s workflow identity',
    (branch) => {
      const actual = execute(step('publish', 'Publish with provenance'), {}, branch);
      expect(actual.status).toBe(0);
      expect(actual.npm?.split('\n')).toEqual([
        CERTIFIED_SHA,
        `refs/heads/${branch}`,
        CERTIFIED_SHA,
        `${REPOSITORY}/.github/workflows/release.yml@refs/heads/${branch}`,
        '99',
        'run release',
      ]);
    },
  );

  it.each<{ label: string; values: Record<string, string> }>([
    { label: 'source commit', values: { GITHUB_SHA: DEFAULT_SHA } },
    { label: 'source branch', values: { GITHUB_REF: 'refs/heads/main' } },
    { label: 'workflow commit', values: { GITHUB_WORKFLOW_SHA: DEFAULT_SHA } },
    { label: 'missing workflow commit', values: { GITHUB_WORKFLOW_SHA: '' } },
    {
      label: 'workflow ref',
      values: {
        GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/release.yml@refs/heads/main`,
      },
    },
    { label: 'missing workflow ref', values: { GITHUB_WORKFLOW_REF: '' } },
  ])('refuses npm when the actual $label differs from certified CI', ({ values }) => {
    const actual = execute(step('publish', 'Publish with provenance'), values);
    expect(actual.status).not.toBe(0);
    expect(actual.npm).toBeUndefined();
  });

  it('grants publishing only to the matching actual workflow snapshot', () => {
    expect(jobs['publish']?.if?.replace(/\s+/gu, ' ').trim()).toBe(
      "needs.gate.outputs.publish == 'true' && github.sha == needs.gate.outputs.tested_sha && github.ref == format('refs/heads/{0}', needs.gate.outputs.tested_branch) && github.workflow_sha == needs.gate.outputs.tested_sha && github.workflow_ref == format('{0}/.github/workflows/release.yml@refs/heads/{1}', github.repository, needs.gate.outputs.tested_branch)",
    );
  });
});

describe('release source receiver', () => {
  it('accepts the matching source snapshot after CI certification', () => {
    const receiver = step('gate', 'Verify dispatched source snapshot');
    expect(receiver.if).toBe("github.event_name == 'workflow_dispatch'");
    const actual = execute(receiver);
    expect(actual.status).toBe(0);
    expect(actual.npm).toBeUndefined();
    expect(actual.gh).toBeUndefined();
  });

  it.each<{ label: string; values: Record<string, string> }>([
    { label: 'branch drift', values: { GITHUB_SHA: DEFAULT_SHA } },
    { label: 'wrong dispatch branch', values: { GITHUB_REF: 'refs/heads/main' } },
    { label: 'wrong workflow commit', values: { GITHUB_WORKFLOW_SHA: DEFAULT_SHA } },
    { label: 'missing workflow commit', values: { GITHUB_WORKFLOW_SHA: '' } },
    {
      label: 'wrong workflow ref',
      values: {
        GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/release.yml@refs/heads/main`,
      },
    },
    { label: 'missing workflow ref', values: { GITHUB_WORKFLOW_REF: '' } },
  ])('fails closed on $label without dispatching again', ({ values }) => {
    const actual = execute(step('gate', 'Verify dispatched source snapshot'), values);
    expect(actual.status).not.toBe(0);
    expect(actual.npm).toBeUndefined();
    expect(actual.gh).toBeUndefined();
  });
});

describe('release source router', () => {
  it('can only route workflow_run mismatches with Actions write and Contents read', () => {
    expect(jobs['source-dispatch']?.if?.replace(/\s+/gu, ' ').trim()).toBe(
      "github.event_name == 'workflow_run' && needs.gate.outputs.publish == 'true' && (github.sha != needs.gate.outputs.tested_sha || github.ref != format('refs/heads/{0}', needs.gate.outputs.tested_branch) || github.workflow_sha != needs.gate.outputs.tested_sha || github.workflow_ref != format('{0}/.github/workflows/release.yml@refs/heads/{1}', github.repository, needs.gate.outputs.tested_branch))",
    );
    expect(jobs['source-dispatch']?.permissions).toEqual({ actions: 'write', contents: 'read' });
  });

  it.each(['main', 'release/1.x', 'release/2.0'])(
    'checks the official %s head, dispatches certified inputs once and exits',
    (branch) => {
      const actual = execute(
        step('source-dispatch', 'Dispatch certified source workflow'),
        {
          GITHUB_EVENT_NAME: 'workflow_run',
          GITHUB_SHA: DEFAULT_SHA,
          GITHUB_REF: 'refs/heads/main',
          RELEASE_RUN_ID: '999',
        },
        branch,
      );
      expect(actual.status).toBe(0);
      expect(actual.npm).toBeUndefined();
      expect(actual.gh?.split('\n')).toEqual([
        `api repos/${REPOSITORY}/git/ref/heads/${branch} --jq .object.sha`,
        `api repos/${REPOSITORY}/contents/.github/workflows/release.yml?ref=${DEFAULT_SHA} --jq .sha`,
        `api repos/${REPOSITORY}/contents/.github/workflows/release.yml?ref=${CERTIFIED_SHA} --jq .sha`,
        `api --method POST repos/${REPOSITORY}/actions/workflows/release.yml/dispatches --input ${actual.directory}/source-dispatch.json`,
      ]);
      expect(JSON.parse(actual.dispatched ?? 'null')).toEqual({
        ref: branch,
        inputs: { run_id: '42' },
      });
    },
  );

  it.each<{ label: string; values: Record<string, string> }>([
    { label: 'moved branch', values: { MOCK_REF_HEAD: DEFAULT_SHA } },
    { label: 'malformed API head', values: { MOCK_REF_HEAD: 'not-a-commit' } },
    { label: 'failed branch lookup', values: { MOCK_REF_STATUS: '1' } },
  ])('refuses dispatch on $label', ({ values }) => {
    const actual = execute(step('source-dispatch', 'Dispatch certified source workflow'), values);
    expect(actual.status).not.toBe(0);
    expect(actual.dispatched).toBeUndefined();
    expect(actual.gh?.split('\n')).toHaveLength(1);
    expect(actual.npm).toBeUndefined();
  });

  it.each<{ label: string; values: Record<string, string> }>([
    { label: 'unknown branch', values: { TESTED_BRANCH: 'release/2.x' } },
    { label: 'malformed commit', values: { TESTED_SHA: 'main' } },
    { label: 'injected run id', values: { TESTED_RUN_ID: '42;false' } },
  ])('rejects $label before contacting GitHub', ({ values }) => {
    const actual = execute(step('source-dispatch', 'Dispatch certified source workflow'), values);
    expect(actual.status).not.toBe(0);
    expect(actual.dispatched).toBeUndefined();
    expect(actual.gh).toBeUndefined();
  });

  it.each<{ label: string; values: Record<string, string> }>([
    { label: 'old receiver workflow', values: { MOCK_SOURCE_WORKFLOW: 'd'.repeat(40) } },
    { label: 'empty receiver workflow', values: { MOCK_SOURCE_WORKFLOW: '' } },
    { label: 'malformed receiver workflow', values: { MOCK_SOURCE_WORKFLOW: 'invalid' } },
    { label: 'empty router workflow', values: { MOCK_ROUTER_WORKFLOW: '' } },
    { label: 'malformed router workflow', values: { MOCK_ROUTER_WORKFLOW: 'invalid' } },
    { label: 'failed receiver workflow lookup', values: { MOCK_SOURCE_WORKFLOW_STATUS: '1' } },
  ])('refuses dispatch for $label', ({ values }) => {
    const actual = execute(step('source-dispatch', 'Dispatch certified source workflow'), {
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_SHA: DEFAULT_SHA,
      ...values,
    });
    expect(actual.status).not.toBe(0);
    expect(actual.dispatched).toBeUndefined();
    expect(actual.npm).toBeUndefined();
  });

  it.each<{ label: string; values: Record<string, string> }>([
    { label: 'missing workflow commit', values: { GITHUB_WORKFLOW_SHA: '' } },
    { label: 'malformed workflow commit', values: { GITHUB_WORKFLOW_SHA: 'invalid' } },
    { label: 'missing workflow ref', values: { GITHUB_WORKFLOW_REF: '' } },
    {
      label: 'foreign workflow repository',
      values: {
        GITHUB_WORKFLOW_REF: 'other/project/.github/workflows/release.yml@refs/heads/release/2.0',
      },
    },
    {
      label: 'wrong workflow path',
      values: {
        GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/other.yml@refs/heads/release/2.0`,
      },
    },
    {
      label: 'wrong workflow branch',
      values: {
        GITHUB_WORKFLOW_REF: `${REPOSITORY}/.github/workflows/release.yml@refs/heads/main`,
      },
    },
  ])('rejects $label before routing from an unverified workflow', ({ values }) => {
    const actual = execute(step('source-dispatch', 'Dispatch certified source workflow'), values);
    expect(actual.status).not.toBe(0);
    expect(actual.dispatched).toBeUndefined();
    expect(actual.gh).toBeUndefined();
  });

  it('looks up the actual workflow commit independently of the event commit', () => {
    const workflowSha = 'e'.repeat(40);
    const actual = execute(step('source-dispatch', 'Dispatch certified source workflow'), {
      GITHUB_SHA: DEFAULT_SHA,
      GITHUB_WORKFLOW_SHA: workflowSha,
      GITHUB_REF: 'refs/heads/main',
    });
    expect(actual.status).toBe(0);
    expect(actual.gh?.split('\n')[1]).toBe(
      `api repos/${REPOSITORY}/contents/.github/workflows/release.yml?ref=${workflowSha} --jq .sha`,
    );
  });

  it('reports a failed dispatch instead of claiming it started a source run', () => {
    const actual = execute(step('source-dispatch', 'Dispatch certified source workflow'), {
      MOCK_DISPATCH_STATUS: '1',
    });
    expect(actual.status).not.toBe(0);
    expect(actual.gh?.split('\n')).toHaveLength(4);
    expect(actual.npm).toBeUndefined();
  });
});
