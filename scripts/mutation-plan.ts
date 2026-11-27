/**
 * What a run of the critical gates mutates. The six shards of the complete scope cost 500 to 600
 * runner minutes, so a push to a release branch buys them only for a commit whose version is not
 * on npm yet: the one the release gate would publish. The nightly run buys them always. The
 * trusted core, about 110 minutes, runs with them, and at once for a push that changes what its
 * score is measured on. Both answers go to the job's outputs; ADR 0013, sections 13 and 14.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CommandResult, publishedVersionFrom } from './release-gate';

/**
 * `always` mutates the complete scope without asking the registry. `unpublished-version` leaves it
 * out for one answer only: the registry serves exactly this version. A version it does not serve
 * is a release in the making, and a registry that does not answer proves nothing.
 */
export function fullMutation(
  mode: string | undefined,
  version: string,
  lookup: () => CommandResult,
): boolean {
  if (mode === 'always') return true;
  if (mode !== 'unpublished-version') {
    throw new Error(
      `Unknown mutation mode "${String(mode)}"; expected "always" or "unpublished-version"`,
    );
  }
  try {
    return publishedVersionFrom(lookup()) !== version;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return true;
  }
}

/** What decides the trusted core's score besides its tests: its modules, their list, the policy, Stryker's setup. */
export function corePaths(trustedCore: {
  readonly core: { readonly modules: Readonly<Record<string, unknown>> };
}): readonly string[] {
  return [
    ...Object.keys(trustedCore.core.modules),
    'quality/trusted-core.json',
    'quality/mutation-policy-core.json',
    'stryker.config.js',
    'vitest.stryker.config.ts',
  ];
}

/**
 * The files a push changed, from the commit it started at to the checked-out one, a moved file
 * under both names. `undefined` where that cannot be read: a branch's first push has no such
 * commit, a scheduled run names none, and git may fail to fetch it into a shallow checkout.
 */
export function changedSince(
  base: string | undefined,
  git: (args: readonly string[]) => CommandResult,
): readonly string[] | undefined {
  if (base === undefined || !/^[0-9a-f]{40}$/u.test(base) || /^0+$/u.test(base)) return undefined;
  const held = git(['cat-file', '-e', `${base}^{commit}`]).status === 0;
  if (!held && git(['fetch', '--no-tags', '--depth=1', 'origin', base]).status !== 0) {
    return undefined;
  }
  const diff = git(['diff', '--name-only', '--no-renames', base, 'HEAD']);
  if (diff.status !== 0) return undefined;
  return diff.stdout.split('\n').filter((line) => line.length > 0);
}

/**
 * The trusted core is mutated whenever the complete scope is, and for a push that changes one of
 * `paths`. A push whose changes are not known counts as one that does.
 */
export function coreMutation(
  full: boolean,
  changed: readonly string[] | undefined,
  paths: readonly string[],
): boolean {
  return full || changed === undefined || changed.some((file) => paths.includes(file));
}

function main(): void {
  const root = resolve(import.meta.dirname, '..');
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    readonly name: string;
    readonly version: string;
  };
  const full = fullMutation(process.env['MUTATION_MODE'], manifest.version, () => {
    const result = spawnSync('npm', ['view', `${manifest.name}@${manifest.version}`, 'version'], {
      encoding: 'utf8',
    });
    if (result.error !== undefined) throw result.error;
    return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  });
  // The complete scope answers for the core as well, so git is asked only for the other pushes.
  const changed = full
    ? []
    : changedSince(process.env['MUTATION_BASE'], (args) => {
        const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8' });
        return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
      });
  const trustedCore = JSON.parse(
    readFileSync(resolve(root, 'quality/trusted-core.json'), 'utf8'),
  ) as Parameters<typeof corePaths>[0];
  const core = coreMutation(full, changed, corePaths(trustedCore));
  const lines = [`full=${String(full)}`, `core=${String(core)}`];
  console.log(`${manifest.name}@${manifest.version}: ${lines.join(' ')}`);
  const output = process.env['GITHUB_OUTPUT'];
  if (output !== undefined && output.length > 0) appendFileSync(output, `${lines.join('\n')}\n`);
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
