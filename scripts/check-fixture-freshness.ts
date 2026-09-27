/**
 * Do the example fixtures have the build you just made?
 *
 * Every fixture depends on the package through `file:../..`, and the lockfiles
 * record that two different ways. Five say `"link": true` and get a symlink to
 * the repository root, so they are current by construction. Five —
 * astro-payload, nextjs-payload, nuxt-payload, sveltekit-payload and payload-backend — resolve to
 * `file:../..` with a version, and npm materialises a packed copy instead.
 *
 * Keeping both is deliberate: a copy is what a consumer installs, so those five
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
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const EXAMPLES = join(ROOT, 'examples');
const PACKAGE_MANIFEST = 'package.json';

function packageFileRoots(packageRoot: string): readonly string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(packageRoot, PACKAGE_MANIFEST), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new TypeError('package.json must contain an object');
  }
  const files = (manifest as Record<string, unknown>)['files'];
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new TypeError('package.json files must contain non-empty paths');
  }
  return [PACKAGE_MANIFEST, ...(files as string[])];
}

function collectFiles(packageRoot: string, entry: string, target: Set<string>): void {
  const root = resolve(packageRoot);
  const path = resolve(root, entry);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`package file path escapes its root: ${entry}`);
  }
  const metadata = lstatSync(path);
  if (metadata.isDirectory()) {
    const children = readdirSync(path, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const child of children) collectFiles(root, join(entry, child.name), target);
    return;
  }
  if (!metadata.isFile()) throw new Error(`package payload entry is not a regular file: ${entry}`);
  target.add(relative(root, path).split(sep).join('/'));
}

function packageDigest(
  packageRoot: string,
  fileRoots: readonly string[],
  includeOnlyDeclaredRoots: boolean,
): string {
  const paths = new Set<string>();
  if (includeOnlyDeclaredRoots) {
    for (const entry of fileRoots) collectFiles(packageRoot, entry, paths);
  } else {
    collectFiles(packageRoot, '.', paths);
  }

  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    const contents = readFileSync(join(packageRoot, path));
    hash.update(`${String(Buffer.byteLength(path))}:${path}${String(contents.byteLength)}:`);
    hash.update(contents);
  }
  return hash.digest('hex');
}

export interface FixtureFreshness {
  readonly name: string;
  readonly state: 'current' | 'stale' | 'absent';
}

export function fixtureFreshness(
  expectedPackageRoot: string,
  fixtures: readonly { readonly name: string; readonly copy: string }[],
): FixtureFreshness[] {
  const fileRoots = packageFileRoots(expectedPackageRoot);
  const expected = packageDigest(expectedPackageRoot, fileRoots, true);
  return fixtures.map(({ name, copy }) => {
    if (!existsSync(copy)) return { name, state: 'absent' as const };
    try {
      const linked = lstatSync(copy).isSymbolicLink();
      return {
        name,
        state:
          packageDigest(copy, fileRoots, linked) === expected
            ? ('current' as const)
            : ('stale' as const),
      };
    } catch {
      return { name, state: 'stale' as const };
    }
  });
}

function main(): void {
  if (!existsSync(join(ROOT, 'dist'))) {
    console.error('dist is missing; run npm run build first.');
    process.exitCode = 1;
    return;
  }
  const fixtures = readdirSync(EXAMPLES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      copy: join(EXAMPLES, entry.name, 'node_modules', 'payload-live-preview'),
    }));

  const results = fixtureFreshness(ROOT, fixtures);
  const stale = results.filter((result) => result.state === 'stale');
  // A fixture that never installed the package is not stale: several of them
  // do not depend on it at all.
  const installed = results.filter((result) => result.state !== 'absent');

  if (stale.length === 0) {
    console.log(
      `[fixtures] ${String(installed.length)} fixture(s) carry the current package payload.`,
    );
    return;
  }
  console.error(
    `[fixtures] ${String(stale.length)} fixture(s) carry an older package payload:\n` +
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
