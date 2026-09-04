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

interface FakeWorld {
  readonly run?: Record<string, unknown>;
  readonly ancestor?: boolean;
  readonly manifest?: Record<string, unknown>;
  readonly changesets?: string;
  readonly registry?: CommandResult;
  readonly tagSha?: string;
  readonly release?: CommandResult;
}

function runner(world: FakeWorld): (executable: string, args: readonly string[]) => CommandResult {
  return (executable, args) => {
    const command = `${executable} ${args.join(' ')}`;
    if (command.startsWith('gh api') && command.includes('/actions/runs/')) {
      return ok(JSON.stringify(world.run ?? run()));
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
    expect(certifiedRunFrom(run(), REPOSITORY)).toEqual({ id: 42, headSha: TESTED });
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
      publish: 'true',
      version_pr: 'false',
    });
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
