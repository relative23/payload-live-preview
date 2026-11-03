import { describe, expect, it } from 'vitest';
import {
  certifiedRunFrom,
  changesetsFrom,
  decideReleaseAction,
  publishedVersionFrom,
  runReleaseGate,
  type CommandResult,
  type ReleaseFacts,
} from '../../scripts/release-gate';

const REPOSITORY = 'relative23/payload-live-preview';
const TESTED = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const ok = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '' });
const failed = (stderr: string, status = 1): CommandResult => ({ status, stdout: '', stderr });

const run = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 42,
  name: 'CI',
  event: 'push',
  head_branch: 'main',
  head_sha: TESTED,
  status: 'completed',
  conclusion: 'success',
  head_repository: { full_name: REPOSITORY },
  ...overrides,
});

const facts = (overrides: Partial<ReleaseFacts> = {}): ReleaseFacts => ({
  version: '2.0.0',
  published: undefined,
  changesets: false,
  tagSha: undefined,
  released: false,
  ...overrides,
});

const watchRun = (id: number, conclusion: string, createdAt: string) => ({
  id,
  conclusion,
  created_at: createdAt,
  html_url: `https://github.com/${REPOSITORY}/actions/runs/${String(id)}`,
});
const WATCH_PASSED = ok(JSON.stringify([watchRun(7, 'success', '2026-11-03T14:31:58Z')]));

interface FakeWorld {
  readonly run?: Record<string, unknown>;
  readonly ancestor?: boolean;
  readonly manifest?: Record<string, unknown>;
  readonly changesets?: string;
  readonly registry?: CommandResult;
  readonly tagSha?: string;
  readonly release?: CommandResult;
  /** The finished Latest Watch runs on the tested commit, as the gate's `--jq` prints them. */
  readonly latestWatch?: CommandResult;
  readonly commands?: string[];
}

function runner(world: FakeWorld): (executable: string, args: readonly string[]) => CommandResult {
  return (executable, args) => {
    const command = `${executable} ${args.join(' ')}`;
    world.commands?.push(command);
    if (command.startsWith('gh api') && command.includes('/actions/runs/')) {
      return ok(JSON.stringify(world.run ?? run()));
    }
    if (command.startsWith('gh api') && command.includes('/workflows/latest-watch.yml/runs')) {
      return world.latestWatch ?? WATCH_PASSED;
    }
    if (command.startsWith('git merge-base')) return (world.ancestor ?? true) ? ok() : failed('');
    if (command.startsWith('git show')) {
      return ok(JSON.stringify(world.manifest ?? { name: 'pkg', version: '2.0.0' }));
    }
    if (command.startsWith('git ls-tree')) return ok(world.changesets ?? '.changeset/README.md\n');
    if (command.startsWith('git rev-parse')) {
      return world.tagSha === undefined
        ? failed('fatal: not a valid object name')
        : ok(`${world.tagSha}\n`);
    }
    if (command.startsWith('gh api') && command.includes('/releases/')) {
      return world.release ?? failed('gh: Not Found (HTTP 404)');
    }
    if (command.startsWith('npm view')) return world.registry ?? failed('npm ERR! code E404');
    throw new Error(`unexpected command ${command}`);
  };
}

describe('certified run resolution', () => {
  it('accepts a completed, successful CI push run on main from this repository', () => {
    expect(certifiedRunFrom(run(), REPOSITORY)).toEqual({
      id: 42,
      headSha: TESTED,
      branch: 'main',
    });
  });

  it('accepts the same run from the 1.x maintenance branch and names the branch', () => {
    expect(certifiedRunFrom(run({ head_branch: 'release/1.x' }), REPOSITORY)).toEqual({
      id: 42,
      headSha: TESTED,
      branch: 'release/1.x',
    });
  });

  it('accepts a certified push on the exact 2.0 maintenance branch', () => {
    expect(certifiedRunFrom(run({ head_branch: 'release/2.0' }), REPOSITORY)).toEqual({
      id: 42,
      headSha: TESTED,
      branch: 'release/2.0',
    });
  });

  it('refuses every other branch, however close its name', () => {
    for (const branch of [
      'release/2.x',
      'release/2.0-backport',
      'release/2.0.1',
      'changeset-release/release/2.0',
      'Release/2.0',
      'release/1.x-backport',
      'changeset-release/release/1.x',
      'Main',
    ]) {
      expect(() => certifiedRunFrom(run({ head_branch: branch }), REPOSITORY)).toThrow(
        /head_branch/u,
      );
    }
  });

  it.each([
    { field: 'name', value: 'Docs' },
    { field: 'event', value: 'pull_request' },
    { field: 'head_branch', value: 'feature' },
    { field: 'status', value: 'in_progress' },
    { field: 'conclusion', value: 'failure' },
    { field: 'head_repository', value: { full_name: 'someone/fork' } },
  ])('refuses a run whose $field is not certified', ({ field, value }) => {
    expect(() => certifiedRunFrom(run({ [field]: value }), REPOSITORY)).toThrow(
      /not a certified CI run/u,
    );
  });

  it.each([
    { field: 'name', value: 'Docs' },
    { field: 'event', value: 'pull_request' },
    { field: 'status', value: 'in_progress' },
    { field: 'conclusion', value: 'failure' },
    { field: 'head_repository', value: { full_name: 'someone/fork' } },
  ])('refuses an uncertified $field on release/2.0', ({ field, value }) => {
    expect(() =>
      certifiedRunFrom(run({ head_branch: 'release/2.0', [field]: value }), REPOSITORY),
    ).toThrow(/not a certified CI run/u);
  });

  it('refuses malformed identifiers', () => {
    expect(() => certifiedRunFrom(run({ head_sha: 'main' }), REPOSITORY)).toThrow(/40-character/u);
    expect(() => certifiedRunFrom(run({ id: '42' }), REPOSITORY)).toThrow(/run id/u);
  });
});

describe('registry version lookup', () => {
  it('reads the version from stdout and ignores npm warnings on stderr', () => {
    expect(
      publishedVersionFrom({ status: 0, stdout: '\n2.0.0\n', stderr: 'npm warn config x' }),
    ).toBe('2.0.0');
  });

  it('treats only E404 as unpublished and fails closed on everything else', () => {
    expect(publishedVersionFrom(failed('npm ERR! code E404'))).toBeUndefined();
    expect(() => publishedVersionFrom(failed('npm ERR! code ECONNRESET'))).toThrow(
      /refusing to infer/u,
    );
  });

  it('excludes only the changesets README', () => {
    expect(changesetsFrom('.changeset/README.md\n.changeset/config.json\n')).toBe(false);
    expect(changesetsFrom('.changeset/README.md\n.changeset/brave-owls.md\n')).toBe(true);
  });
});

describe('release decision', () => {
  it('publishes an unpublished version even while changesets are retained (pre mode)', () => {
    expect(decideReleaseAction(facts({ changesets: true }), TESTED)).toBe('publish');
  });

  it('opens a Version PR once the current version is published and changesets exist', () => {
    expect(decideReleaseAction(facts({ published: '2.0.0', changesets: true }), TESTED)).toBe(
      'version-pr',
    );
  });

  it('leaves a completed historical release alone on later commits', () => {
    expect(
      decideReleaseAction(facts({ published: '2.0.0', tagSha: OTHER, released: true }), TESTED),
    ).toBe('none');
  });

  it('reconciles a published version whose tag or release is missing', () => {
    expect(decideReleaseAction(facts({ published: '2.0.0' }), TESTED)).toBe('publish');
    expect(decideReleaseAction(facts({ published: '2.0.0', tagSha: TESTED }), TESTED)).toBe(
      'publish',
    );
  });

  it('refuses inconsistent tag state instead of guessing', () => {
    expect(() =>
      decideReleaseAction(facts({ published: '2.0.0', released: true }), TESTED),
    ).toThrow(/without a fetched Git tag/u);
    expect(() => decideReleaseAction(facts({ published: '2.0.0', tagSha: OTHER }), TESTED)).toThrow(
      /points to/u,
    );
  });
});

describe('release gate run', () => {
  it('publishes a certified commit that is on main but no longer its tip', () => {
    expect(runReleaseGate({ repository: REPOSITORY, runId: '42', run: runner({}) })).toEqual({
      run_id: '42',
      tested_sha: TESTED,
      tested_branch: 'main',
      publish: 'true',
      version_pr: 'false',
    });
  });

  it('proves ancestry against the branch the run came from', () => {
    const commands: string[] = [];
    runReleaseGate({
      repository: REPOSITORY,
      runId: '42',
      run: runner({
        run: run({ head_branch: 'release/1.x' }),
        manifest: { name: 'pkg', version: '1.8.2' },
        commands,
      }),
    });
    expect(commands).toContain(`git merge-base --is-ancestor ${TESTED} origin/release/1.x`);
    expect(commands.some((command) => command.includes('origin/main'))).toBe(false);
  });

  it('publishes an unpublished 1.x version certified on release/1.x', () => {
    expect(
      runReleaseGate({
        repository: REPOSITORY,
        runId: '42',
        run: runner({
          run: run({ head_branch: 'release/1.x' }),
          manifest: { name: 'pkg', version: '1.8.2' },
        }),
      }),
    ).toEqual({
      run_id: '42',
      tested_sha: TESTED,
      tested_branch: 'release/1.x',
      publish: 'true',
      version_pr: 'false',
    });
  });

  it('publishes certified 2.0.6 bytes only after proving the run belongs to release/2.0', () => {
    const commands: string[] = [];
    expect(
      runReleaseGate({
        repository: REPOSITORY,
        runId: '42',
        run: runner({
          run: run({ head_branch: 'release/2.0' }),
          manifest: { name: 'pkg', version: '2.0.6' },
          commands,
        }),
      }),
    ).toEqual({
      run_id: '42',
      tested_sha: TESTED,
      tested_branch: 'release/2.0',
      publish: 'true',
      version_pr: 'false',
    });
    expect(commands).toContain(`git merge-base --is-ancestor ${TESTED} origin/release/2.0`);
    expect(commands.some((command) => command.includes('origin/main'))).toBe(false);
    expect(commands).toContain(`git show ${TESTED}:package.json`);
  });

  it('refuses a 2.0 maintenance run whose commit is not on its own branch', () => {
    expect(() =>
      runReleaseGate({
        repository: REPOSITORY,
        runId: '42',
        run: runner({ run: run({ head_branch: 'release/2.0' }), ancestor: false }),
      }),
    ).toThrow(/not on release\/2\.0/u);
  });

  it('requires the manual version step on release/2.0 instead of opening a main Version PR', () => {
    expect(() =>
      runReleaseGate({
        repository: REPOSITORY,
        runId: '42',
        run: runner({
          run: run({ head_branch: 'release/2.0' }),
          manifest: { name: 'pkg', version: '2.0.5' },
          registry: ok('2.0.5\n'),
          changesets: '.changeset/README.md\n.changeset/fix.md\n',
        }),
      }),
    ).toThrow(/npm run version/u);
  });

  it('refuses a 1.x commit that is not on release/1.x', () => {
    expect(() =>
      runReleaseGate({
        repository: REPOSITORY,
        runId: '42',
        run: runner({ run: run({ head_branch: 'release/1.x' }), ancestor: false }),
      }),
    ).toThrow(/not on release\/1\.x/u);
  });

  // changesets/action resets its version branch to github.sha, the tip of main
  // under workflow_run; on release/1.x it would open a PR carrying main's tree.
  it('names the hand step instead of asking for a Version PR on a maintenance branch', () => {
    expect(() =>
      runReleaseGate({
        repository: REPOSITORY,
        runId: '42',
        run: runner({
          run: run({ head_branch: 'release/1.x' }),
          manifest: { name: 'pkg', version: '1.8.1' },
          registry: ok('1.8.1\n'),
          changesets: '.changeset/README.md\n.changeset/fix.md\n',
        }),
      }),
    ).toThrow(/npm run version/u);
  });

  it('refuses a certified commit that is not an ancestor of main', () => {
    expect(() =>
      runReleaseGate({ repository: REPOSITORY, runId: '42', run: runner({ ancestor: false }) }),
    ).toThrow(/not on main/u);
  });

  it('reads the tested commit through git, not the checkout', () => {
    const outputs = runReleaseGate({
      repository: REPOSITORY,
      runId: '42',
      run: runner({
        registry: ok('2.0.0\n'),
        changesets: '.changeset/README.md\n.changeset/next.md\n',
      }),
    });
    expect(outputs).toMatchObject({ publish: 'false', version_pr: 'true' });
  });

  it('fails closed on registry or GitHub outages', () => {
    expect(() =>
      runReleaseGate({
        repository: REPOSITORY,
        runId: '42',
        run: runner({ registry: failed('ETIMEDOUT') }),
      }),
    ).toThrow(/refusing to infer an unpublished version/u);
    expect(() =>
      runReleaseGate({
        repository: REPOSITORY,
        runId: '42',
        run: runner({ registry: ok('2.0.0\n'), release: failed('HTTP 502') }),
      }),
    ).toThrow(/refusing to infer missing release state/u);
    expect(() =>
      runReleaseGate({ repository: REPOSITORY, runId: 'latest', run: runner({}) }),
    ).toThrow(/run id/u);
  });
});

// CI installs exact lockfiles; the Latest Watch installs each framework at its newest release over
// the same commit. A publish from main waits for that run's verdict, not for the next morning's.
describe('the Latest Watch run on the commit main publishes', () => {
  const gate = (world: FakeWorld) =>
    runReleaseGate({ repository: REPOSITORY, runId: '42', run: runner(world) });

  it('publishes once the newest finished run on the tested commit passed', () => {
    const commands: string[] = [];
    expect(gate({ commands })).toMatchObject({ publish: 'true', version_pr: 'false' });
    expect(commands).toContainEqual(
      expect.stringContaining(
        `repos/${REPOSITORY}/actions/workflows/latest-watch.yml/runs?head_sha=${TESTED}&status=completed`,
      ),
    );
  });

  it('refuses to publish when that run failed, and names it', () => {
    expect(() =>
      gate({
        latestWatch: ok(
          JSON.stringify([
            watchRun(8, 'failure', '2026-11-04T06:40:00Z'),
            watchRun(7, 'success', '2026-11-03T14:31:58Z'),
          ]),
        ),
      }),
    ).toThrow(/Latest Watch run on a{40} ended failure: .*\/actions\/runs\/8/u);
  });

  it('judges by the newest run, whatever order GitHub lists them in', () => {
    const listed = (first: string, second: string) =>
      ok(
        JSON.stringify([
          watchRun(7, first, '2026-11-03T14:31:58Z'),
          watchRun(8, second, '2026-11-04T06:40:00Z'),
        ]),
      );
    expect(gate({ latestWatch: listed('failure', 'success') })).toMatchObject({ publish: 'true' });
    expect(() => gate({ latestWatch: listed('success', 'failure') })).toThrow(/ended failure/u);
  });

  it('skips a cancelled or skipped run, which reached no verdict', () => {
    expect(
      gate({
        latestWatch: ok(
          JSON.stringify([
            watchRun(9, 'cancelled', '2026-11-04T07:00:00Z'),
            watchRun(8, 'skipped', '2026-11-04T06:50:00Z'),
            watchRun(7, 'success', '2026-11-03T14:31:58Z'),
          ]),
        ),
      }),
    ).toMatchObject({ publish: 'true' });
  });

  it('refuses to publish when no run on the tested commit reached a verdict', () => {
    expect(() => gate({ latestWatch: ok('[]') })).toThrow(
      /no finished Latest Watch run on a{40}[\s\S]*gh workflow run release\.yml -f run_id=42/u,
    );
  });

  it('fails closed when GitHub cannot list the runs', () => {
    expect(() => gate({ latestWatch: failed('HTTP 502') })).toThrow(
      /refusing to publish without its verdict/u,
    );
  });

  it('asks nothing of a maintenance branch, or of a Version PR', () => {
    const maintenance: string[] = [];
    gate({
      run: run({ head_branch: 'release/1.x' }),
      manifest: { name: 'pkg', version: '1.8.3' },
      latestWatch: ok('[]'),
      commands: maintenance,
    });
    const versionPr: string[] = [];
    expect(
      gate({
        registry: ok('2.0.0\n'),
        changesets: '.changeset/README.md\n.changeset/next.md\n',
        latestWatch: ok('[]'),
        commands: versionPr,
      }),
    ).toMatchObject({ version_pr: 'true' });
    for (const commands of [maintenance, versionPr]) {
      expect(commands.some((command) => command.includes('latest-watch.yml'))).toBe(false);
    }
  });
});
