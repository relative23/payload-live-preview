/** Decide whether a CI-certified commit is versioned, published, or left alone. */

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseTagForVersion } from './publish-artifact';

export interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (executable: string, args: readonly string[]) => CommandResult;

export interface CertifiedRun {
  readonly id: number;
  readonly headSha: string;
}

export interface ReleaseFacts {
  readonly version: string;
  /** The version the registry serves under this exact version, if any. */
  readonly published: string | undefined;
  readonly changesets: boolean;
  readonly tagSha: string | undefined;
  readonly released: boolean;
}

export type ReleaseAction = 'publish' | 'version-pr' | 'none';

export interface ReleaseGateOutputs {
  readonly run_id: string;
  readonly tested_sha: string;
  readonly publish: 'true' | 'false';
  readonly version_pr: 'true' | 'false';
}

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function detail(result: CommandResult): string {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return output.length > 2_000 ? output.slice(-2_000) : output;
}

/** Accept only a completed, successful CI push run on this repository's main branch. */
export function certifiedRunFrom(run: unknown, repository: string): CertifiedRun {
  if (!isRecord(run)) throw new Error('workflow run payload is not an object');
  const headRepository = isRecord(run['head_repository']) ? run['head_repository'] : {};
  const expectations: readonly (readonly [string, unknown, unknown])[] = [
    ['name', run['name'], 'CI'],
    ['event', run['event'], 'push'],
    ['head_branch', run['head_branch'], 'main'],
    ['status', run['status'], 'completed'],
    ['conclusion', run['conclusion'], 'success'],
    ['head_repository', headRepository['full_name'], repository],
  ];
  for (const [field, actual, expected] of expectations) {
    if (actual !== expected) {
      throw new Error(
        `run is not a certified CI run: ${field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
      );
    }
  }
  const id = run['id'];
  const headSha = run['head_sha'];
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) {
    throw new Error('workflow run id is not an integer');
  }
  if (typeof headSha !== 'string' || !SHA_PATTERN.test(headSha)) {
    throw new Error('workflow run head_sha is not a 40-character commit');
  }
  return { id, headSha };
}

/**
 * The published version from `npm view`, read from stdout only. npm writes
 * config warnings to stderr; folding them into the value once made a published
 * version compare as unpublished. A registry outage is not evidence of anything.
 */
export function publishedVersionFrom(result: CommandResult): string | undefined {
  if (result.status === 0) {
    const lines = result.stdout.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    const last = lines.at(-1)?.trim();
    return last === undefined || last.length === 0 ? undefined : last;
  }
  if (/\bE404\b/u.test(result.stderr)) return undefined;
  throw new Error(
    `npm registry lookup failed; refusing to infer an unpublished version:\n${detail(result)}`,
  );
}

/** Changeset files present at a commit, ignoring the directory README. */
export function changesetsFrom(listing: string): boolean {
  return listing
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((path) => path.endsWith('.md') && path !== '.changeset/README.md');
}

/**
 * Publish an unpublished version before considering a Version PR: in
 * Changesets pre-release mode the changeset files stay through the whole
 * prerelease line, so their presence alone must not block a publish.
 */
export function decideReleaseAction(facts: ReleaseFacts, testedSha: string): ReleaseAction {
  if (facts.published !== facts.version) return 'publish';
  if (facts.changesets) return 'version-pr';
  const tag = releaseTagForVersion(facts.version);
  if (facts.released) {
    if (facts.tagSha === undefined) {
      throw new Error(
        `GitHub Release ${tag} exists without a fetched Git tag; refusing inconsistent state`,
      );
    }
    return 'none';
  }
  if (facts.tagSha !== undefined && facts.tagSha !== testedSha) {
    throw new Error(
      `${tag} has no GitHub Release and points to ${facts.tagSha}, not tested commit ${testedSha}; ` +
        're-run the release for the original commit to reconcile its certified artifact',
    );
  }
  return 'publish';
}

export interface ReleaseGateEnvironment {
  readonly repository: string;
  readonly runId: string;
  readonly run: CommandRunner;
}

function readReleaseFacts(environment: ReleaseGateEnvironment, sha: string): ReleaseFacts {
  const { run, repository } = environment;
  const manifestSource = run('git', ['show', `${sha}:package.json`]);
  if (manifestSource.status !== 0) {
    throw new Error(`cannot read package.json at ${sha}:\n${detail(manifestSource)}`);
  }
  const manifest: unknown = JSON.parse(manifestSource.stdout);
  if (
    !isRecord(manifest) ||
    typeof manifest['name'] !== 'string' ||
    typeof manifest['version'] !== 'string'
  ) {
    throw new Error(`package.json at ${sha} has no string name/version`);
  }
  const { name, version } = manifest;
  const tag = releaseTagForVersion(version);

  const changesets = run('git', ['ls-tree', '--name-only', sha, '.changeset/']);
  if (changesets.status !== 0) {
    throw new Error(`cannot list changesets at ${sha}:\n${detail(changesets)}`);
  }
  const tagLookup = run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  const release = run('gh', [
    'api',
    `repos/${repository}/releases/tags/${tag}`,
    '--jq',
    '.tag_name',
  ]);
  let released: boolean;
  if (release.status === 0) {
    if (release.stdout.trim() !== tag) {
      throw new Error(`GitHub returned an unexpected release tag: ${release.stdout.trim()}`);
    }
    released = true;
  } else if (release.stderr.includes('HTTP 404')) {
    released = false;
  } else {
    throw new Error(
      `GitHub release lookup failed; refusing to infer missing release state:\n${detail(release)}`,
    );
  }

  return {
    version,
    published: publishedVersionFrom(run('npm', ['view', `${name}@${version}`, 'version'])),
    changesets: changesetsFrom(changesets.stdout),
    tagSha: tagLookup.status === 0 ? tagLookup.stdout.trim() : undefined,
    released,
  };
}

/** Resolve the certified run, prove it is on main, and decide the release action. */
export function runReleaseGate(environment: ReleaseGateEnvironment): ReleaseGateOutputs {
  const { run, repository, runId } = environment;
  if (!/^[0-9]+$/u.test(runId)) {
    throw new Error(`RELEASE_RUN_ID must be a run id, got ${JSON.stringify(runId)}`);
  }
  const lookup = run('gh', ['api', `repos/${repository}/actions/runs/${runId}`]);
  if (lookup.status !== 0) throw new Error(`cannot read workflow run ${runId}:\n${detail(lookup)}`);
  const certified = certifiedRunFrom(JSON.parse(lookup.stdout), repository);

  const ancestry = run('git', ['merge-base', '--is-ancestor', certified.headSha, 'origin/main']);
  if (ancestry.status !== 0) {
    throw new Error(`tested commit ${certified.headSha} is not on main; refusing to release it`);
  }

  const action = decideReleaseAction(
    readReleaseFacts(environment, certified.headSha),
    certified.headSha,
  );
  return {
    run_id: String(certified.id),
    tested_sha: certified.headSha,
    publish: action === 'publish' ? 'true' : 'false',
    version_pr: action === 'version-pr' ? 'true' : 'false',
  };
}

function spawn(executable: string, args: readonly string[]): CommandResult {
  const result = spawnSync(executable, args, { encoding: 'utf8', env: process.env });
  if (result.error !== undefined) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function main(): void {
  const repository = process.env['GITHUB_REPOSITORY'];
  const runId = process.env['RELEASE_RUN_ID'];
  const outputPath = process.env['GITHUB_OUTPUT'];
  if (repository === undefined || runId === undefined || outputPath === undefined) {
    throw new Error('GITHUB_REPOSITORY, RELEASE_RUN_ID and GITHUB_OUTPUT are required');
  }
  const outputs = runReleaseGate({ repository, runId, run: spawn });
  for (const [key, value] of Object.entries(outputs)) {
    appendFileSync(outputPath, `${key}=${value}\n`);
  }
  console.log(
    `run=${outputs.run_id} tested_sha=${outputs.tested_sha} publish=${outputs.publish} version_pr=${outputs.version_pr}`,
  );
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
