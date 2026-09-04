/**
 * Do the example fixtures have the build you just made?
 *
 * Every fixture depends on the package through `file:../..`, and the lockfiles
 * record that two different ways. Five say `"link": true` and get a symlink to
 * the repository root, so they are current by construction. Four —
 * astro-payload, nextjs-payload, nuxt-payload, sveltekit-payload — resolve to
 * `file:../..` with a version, and npm materialises a packed copy instead.
 *
 * Keeping both is deliberate: a copy is what a consumer installs, so those four
 * exercise the packed layout and the `files` field rather than the working
 * tree. The cost is that `npm install` reuses the copy while the manifest is
 * unchanged, so the fixture keeps running the library as it was when the copy
 * was made, and the E2E suite goes green against it without saying so.
 *
 * CI never sees this: it checks out clean, downloads the dist artifact and runs
 * `npm ci`, so its copies are always current. This is a local trap, and it has
 * caught this repository twice — once as a whole E2E run that certified a build
 * nobody was testing.
 *
 * Refresh a stale fixture by deleting the copy first; installing over it is
 * what does not work:
 *
 *   rm -rf examples/<name>/node_modules/payload-live-preview
 *   npm install --prefix examples/<name>
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const EXAMPLES = join(ROOT, 'examples');
/** One built file is enough: they are emitted by the same build. */
const WITNESS = join('dist', 'index.js');

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export interface FixtureFreshness {
  readonly name: string;
  readonly state: 'current' | 'stale' | 'absent';
}

export function fixtureFreshness(
  expected: string,
  fixtures: readonly { readonly name: string; readonly copy: string }[],
): FixtureFreshness[] {
  return fixtures.map(({ name, copy }) => {
    if (!existsSync(copy)) return { name, state: 'absent' as const };
    return { name, state: digest(copy) === expected ? ('current' as const) : ('stale' as const) };
  });
}

function main(): void {
  const witness = join(ROOT, WITNESS);
  if (!existsSync(witness)) {
    console.error(`${WITNESS} is missing; run npm run build first.`);
    process.exitCode = 1;
    return;
  }
  const expected = digest(witness);
  const fixtures = readdirSync(EXAMPLES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      copy: join(EXAMPLES, entry.name, 'node_modules', 'payload-live-preview', WITNESS),
    }));

  const results = fixtureFreshness(expected, fixtures);
  const stale = results.filter((result) => result.state === 'stale');
  // A fixture that never installed the package is not stale: several of them
  // do not depend on it at all.
  const installed = results.filter((result) => result.state !== 'absent');

  if (stale.length === 0) {
    console.log(`[fixtures] ${String(installed.length)} fixture(s) carry the current build.`);
    return;
  }
  console.error(
    `[fixtures] ${String(stale.length)} fixture(s) carry an older build than ${WITNESS}:\n` +
      stale.map(({ name }) => `  - examples/${name}`).join('\n') +
      '\n\nInstalling over the copy does not replace it. Delete it first:\n' +
      stale
        .map(
          ({ name }) =>
            `  rm -rf examples/${name}/node_modules/payload-live-preview && npm install --prefix examples/${name}`,
        )
        .join('\n'),
  );
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
