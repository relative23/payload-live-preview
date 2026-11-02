/**
 * `scripts/ci-install-fixture.sh` installs a fixture again when npm fails on the network, and
 * only then. The script runs against a stand-in `npm` that follows a plan, one outcome per call,
 * so the attempts can be counted without a registry. A stand-in `node` passes the platform
 * check, which has tests of its own (platform-packages.test.ts) and is a `.ts` file that the
 * Node 20 unit job cannot run.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Outcome = 'ok' | 'network' | 'error';

const FAKE_NPM = `#!/usr/bin/env bash
n=$(( $(cat "$STATE/calls" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$STATE/calls"
case "$(sed -n "\${n}p" "$STATE/plan")" in
  network)
    printf 'npm error code ECONNRESET\\nnpm error network aborted\\n' >&2
    printf 'npm error network This is a problem related to network connectivity.\\n' >&2
    exit 1 ;;
  error)
    printf 'npm error code EUSAGE\\nnpm error \`npm ci\` can only install packages when your package.json and package-lock.json are in sync.\\n' >&2
    exit 1 ;;
  *) echo "added 1 package in 1s" ;;
esac
`;

const FAKE_NODE = `#!/usr/bin/env bash
[ "$1" = scripts/check-platform-packages.ts ] && [ -n "$2" ]
`;

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'plp-ci-install-fixture-'));
  await mkdir(join(directory, 'bin'));
  await writeFile(join(directory, 'bin/npm'), FAKE_NPM, { mode: 0o755 });
  await writeFile(join(directory, 'bin/node'), FAKE_NODE, { mode: 0o755 });
  await mkdir(join(directory, 'fixture'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function install(plan: readonly Outcome[]): Promise<{
  status: number | null;
  calls: number;
  output: string;
}> {
  await writeFile(join(directory, 'plan'), `${plan.join('\n')}\n`);
  const run = spawnSync('bash', ['scripts/ci-install-fixture.sh', join(directory, 'fixture')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      STATE: directory,
      PATH: [join(directory, 'bin'), process.env['PATH']].join(delimiter),
    },
  });
  const calls = Number(await readFile(join(directory, 'calls'), 'utf8'));
  return { status: run.status, calls, output: run.stdout + run.stderr };
}

describe('ci-install-fixture.sh', () => {
  it('installs once when npm ci succeeds', async () => {
    expect(await install(['ok'])).toMatchObject({ status: 0, calls: 1 });
  });

  it('installs again when npm ci fails on the network, and passes', async () => {
    // Main CI run 41406520393: the registry reset the connection while npm unpacked `next`.
    const run = await install(['network', 'ok']);
    expect(run).toMatchObject({ status: 0, calls: 2 });
    expect(run.output).toContain('npm error network aborted');
    expect(run.output).toContain('attempt 1 failed on the network');
  });

  it('does not install again when npm ci fails for another reason', async () => {
    const run = await install(['error', 'ok']);
    expect(run).toMatchObject({ status: 1, calls: 1 });
    expect(run.output).toContain('npm error code EUSAGE');
  });

  it('gives up after three network failures', async () => {
    const run = await install(['network', 'network', 'network', 'ok']);
    expect(run).toMatchObject({ status: 1, calls: 3 });
    expect(run.output).toContain('in three attempts');
  });
});
