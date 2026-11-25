/**
 * Whether a run of the critical gates mutates the complete scope. The six shards cost 500 to 600
 * runner minutes, so a push to a release branch buys them only for a commit whose version is not
 * on npm yet: the one the release gate would publish. The nightly run buys them always. The
 * answer goes to the job's outputs; ADR 0013, section 13.
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

function main(): void {
  const manifest = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'),
  ) as { readonly name: string; readonly version: string };
  const full = fullMutation(process.env['MUTATION_MODE'], manifest.version, () => {
    const result = spawnSync('npm', ['view', `${manifest.name}@${manifest.version}`, 'version'], {
      encoding: 'utf8',
    });
    if (result.error !== undefined) throw result.error;
    return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  });
  const line = `full=${String(full)}`;
  console.log(`${manifest.name}@${manifest.version}: ${line}`);
  const output = process.env['GITHUB_OUTPUT'];
  if (output !== undefined && output.length > 0) appendFileSync(output, `${line}\n`);
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
