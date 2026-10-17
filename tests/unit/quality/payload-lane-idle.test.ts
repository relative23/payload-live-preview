/**
 * The lane refuses to install or probe while a mutation job runs, because both jobs would compete for
 * the machine. The process table is shared with every other job on the host, and a command queued
 * behind the machine lock names the job on its command line without running it, so the check has to
 * tell a running job from a command that only mentions one. The check runs in its own Node process
 * against sample tables, as the lane does; the lines are the shapes `ps -eo pid,args` printed on
 * the host.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUN_LANE = resolve(
  import.meta.dirname,
  '../../../examples/payload-version-lanes/run-lane.mjs',
);

const QUEUED =
  '381112 bash /srv/tools/with-lock.sh real-admin systemd-run --user --scope -q -p MemoryMax=12G env STRYKER_SCOPE=nightly npx stryker run --mutate src/core/binding-writer.ts';
const SHELL =
  "381064 /bin/bash -c source /home/u/.claude/shell-snapshots/snapshot.sh && eval 'bash /srv/tools/with-lock.sh real-admin npx stryker run --mutate src/core/lifecycle.ts'";
const RUNNING_NPM =
  '383624 npm exec stryker run --mutate src/core/binding-writer.ts,src/core/lifecycle.ts';
const RUNNING_WORKER =
  '383977 /home/u/.local/bin/node /w/node_modules/@stryker-mutator/core/dist/src/child-proxy/child-process-proxy-worker.js';
const RUNNING_NIGHTLY = '4100 node /w/scripts/resume-run-nightly.mjs --shard 2';
const RUNNING_NPX = '4200 npx stryker run --mutate src/core/morph.ts';
const OTHERS = ['1 /sbin/init', '92 sleep 20', '1311 node /w/node_modules/.bin/vitest run'];

const PROGRAM = `
import { pathToFileURL } from 'node:url';
const { mutationJobRunning } = await import(pathToFileURL(process.env.PLP_RUN_LANE).href);
const tables = JSON.parse(process.env.PLP_TABLES);
console.log(JSON.stringify(tables.map((table) => mutationJobRunning(table.join('\\n') + '\\n'))));
`;

function running(...tables: readonly (readonly string[])[]): boolean[] {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', PROGRAM], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, PLP_RUN_LANE: RUN_LANE, PLP_TABLES: JSON.stringify(tables) },
  });
  return JSON.parse(stdout) as boolean[];
}

describe('Payload 2 lane idle check', () => {
  it('sees no job in a table of other processes', () => {
    expect(running([], OTHERS)).toEqual([false, false]);
  });

  it('does not count a command queued behind the machine lock or a shell that carries it', () => {
    expect(running([...OTHERS, QUEUED], [...OTHERS, SHELL], [QUEUED, SHELL])).toEqual([
      false,
      false,
      false,
    ]);
  });

  it.each([
    ['npm exec', RUNNING_NPM],
    ['a Stryker worker', RUNNING_WORKER],
    ['the nightly runner', RUNNING_NIGHTLY],
    ['npx', RUNNING_NPX],
  ])('counts %s as a running job', (_name, line) => {
    expect(running([...OTHERS, line])).toEqual([true]);
  });

  it('counts a running job even when a queued command is listed beside it', () => {
    expect(running([QUEUED, SHELL, RUNNING_WORKER, ...OTHERS])).toEqual([true]);
  });
});
