/** Push the certified release tag and create (or reconcile) its GitHub Release. */

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseTagForVersion } from './publish-artifact';
import type { CommandResult, CommandRunner } from './release-gate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface ReleaseTagState {
  readonly localTagSha: string | undefined;
  readonly remoteTagSha: string | undefined;
  readonly releaseExists: boolean;
}

export interface GithubReleasePlan {
  readonly pushTag: boolean;
  readonly createRelease: boolean;
}

function detail(result: CommandResult): string {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return output.length > 2_000 ? output.slice(-2_000) : output;
}

/** The `## <version>` section of a Changesets CHANGELOG, without its heading. */
export function changelogSection(changelog: string, version: string): string {
  const lines = changelog.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start < 0) throw new Error(`CHANGELOG.md has no "## ${version}" section`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if ((lines[index] ?? '').startsWith('## ')) {
      end = index;
      break;
    }
  }
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
  if (body.length === 0) throw new Error(`CHANGELOG.md section for ${version} is empty`);
  return `${body}\n`;
}

/** The commit a `git ls-remote` tag listing points at; annotated tags are peeled. */
export function remoteTagCommit(listing: string): string | undefined {
  const entries = listing
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter((parts): parts is [string, string] => parts.length === 2);
  const peeled = entries.find(([, ref]) => ref.endsWith('^{}'));
  return (peeled ?? entries[0])?.[0];
}

/**
 * Both the local tag (created by the publisher) and any remote tag must point
 * at the tested commit; anything else is a state to be looked at, not fixed here.
 */
export function planGithubRelease(
  state: ReleaseTagState,
  testedSha: string,
  tag: string,
): GithubReleasePlan {
  if (state.localTagSha === undefined) {
    throw new Error(`${tag} does not exist locally; the publisher did not create it`);
  }
  if (state.localTagSha !== testedSha) {
    throw new Error(`${tag} points to ${state.localTagSha}, not tested commit ${testedSha}`);
  }
  if (state.remoteTagSha !== undefined && state.remoteTagSha !== testedSha) {
    throw new Error(
      `origin already has ${tag} at ${state.remoteTagSha}, not tested commit ${testedSha}`,
    );
  }
  return { pushTag: state.remoteTagSha === undefined, createRelease: !state.releaseExists };
}

export interface GithubReleaseEnvironment {
  readonly repository: string;
  readonly version: string;
  readonly testedSha: string;
  readonly changelog: string;
  readonly run: CommandRunner;
  readonly writeNotes: (notes: string) => string;
}

export function publishGithubRelease(environment: GithubReleaseEnvironment): GithubReleasePlan {
  const { run, repository, version, testedSha } = environment;
  const tag = releaseTagForVersion(version);
  const local = run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  const remote = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remote.status !== 0) throw new Error(`cannot list remote tags:\n${detail(remote)}`);
  const release = run('gh', [
    'api',
    `repos/${repository}/releases/tags/${tag}`,
    '--jq',
    '.tag_name',
  ]);
  let releaseExists: boolean;
  if (release.status === 0) {
    if (release.stdout.trim() !== tag) {
      throw new Error(`GitHub returned an unexpected release tag: ${release.stdout.trim()}`);
    }
    releaseExists = true;
  } else if (release.stderr.includes('HTTP 404')) {
    releaseExists = false;
  } else {
    throw new Error(`GitHub release lookup failed:\n${detail(release)}`);
  }

  const plan = planGithubRelease(
    {
      localTagSha: local.status === 0 ? local.stdout.trim() : undefined,
      remoteTagSha: remoteTagCommit(remote.stdout),
      releaseExists,
    },
    testedSha,
    tag,
  );
  if (plan.pushTag) {
    const push = run('git', ['push', 'origin', `refs/tags/${tag}`]);
    if (push.status !== 0) throw new Error(`pushing ${tag} failed:\n${detail(push)}`);
  }
  if (plan.createRelease) {
    const notes = environment.writeNotes(changelogSection(environment.changelog, version));
    const args = ['release', 'create', tag, '--verify-tag', '--title', tag, '--notes-file', notes];
    if (version.includes('-')) args.push('--prerelease');
    const created = run('gh', args);
    if (created.status !== 0) {
      throw new Error(`creating the GitHub Release failed:\n${detail(created)}`);
    }
  }
  return plan;
}

function spawn(executable: string, args: readonly string[]): CommandResult {
  const result = spawnSync(executable, args, { cwd: ROOT, encoding: 'utf8', env: process.env });
  if (result.error !== undefined) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function main(): void {
  const repository = process.env['GITHUB_REPOSITORY'];
  const testedSha = process.env['PACKAGE_SOURCE_COMMIT'];
  if (repository === undefined || testedSha === undefined) {
    throw new Error('GITHUB_REPOSITORY and PACKAGE_SOURCE_COMMIT are required');
  }
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof manifest.version !== 'string') throw new Error('package.json version is not a string');
  const scratch = mkdtempSync(join(tmpdir(), 'plp-release-notes-'));
  try {
    const plan = publishGithubRelease({
      repository,
      version: manifest.version,
      testedSha,
      changelog: readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8'),
      run: spawn,
      writeNotes: (notes) => {
        const path = join(scratch, 'notes.md');
        writeFileSync(path, notes, 'utf8');
        return path;
      },
    });
    console.log(
      `[release] tag ${plan.pushTag ? 'pushed' : 'already on origin'}; GitHub Release ${plan.createRelease ? 'created' : 'already existed'}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
