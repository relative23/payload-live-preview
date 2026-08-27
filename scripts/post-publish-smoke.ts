/**
 * Install the published package from the registry and import every public
 * entry, in a directory that shares nothing with this repository.
 *
 * `check-package.ts` already proves the *tarball* installs and type-checks
 * before it is published. This proves the thing consumers actually get: the
 * artifact the registry serves, resolved by version range, installed by a
 * plain `npm install` with no workspace, no lockfile and no local `dist` to
 * fall back on. A release can be green end to end and still leave an
 * uninstallable package — a missing file in `files`, an export map that
 * resolves to nothing, a dependency that only existed locally — and nothing
 * before this step would notice.
 *
 * Registry propagation is the one delay it tolerates, bounded and only for
 * the read-after-write window. An import that fails is a failure, never a
 * retry.
 *
 * @module scripts/post-publish-smoke
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { awaitRegistryPropagation, isRegistryPropagationDelay } from './publish-artifact';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const manifest = require_(join(ROOT, 'package.json')) as {
  readonly name: string;
  readonly version: string;
  readonly exports: Readonly<Record<string, unknown>>;
};

/**
 * How each published subpath can be reached from a plain Node consumer.
 *
 * Written out rather than filtered by a rule, because the two exclusions are
 * claims that deserve to be read: `RichText.astro` is a component compiled by
 * Astro, and `middleware-entry` imports the virtual module the integration
 * provides at build time. Neither is importable by Node, and pretending
 * otherwise would make this step fail for a reason that is not a defect. A
 * subpath added later is not listed here, and the check below fails until
 * somebody decides which of these it is.
 */
export const ENTRY_REACHABILITY = {
  '.': 'import',
  './core': 'import',
  './astro': 'import',
  './nextjs': 'import',
  './sveltekit': 'import',
  './nuxt': 'import',
  './doctor': 'import',
  './payload': 'import',
  './codegen': 'needs-ts-morph',
  './codegen/astro': 'needs-ts-morph',
  './astro/RichText.astro': 'not-node-importable',
  './astro/PreviewBoundary.astro': 'not-node-importable',
  './astro/middleware-entry': 'not-node-importable',
} as const satisfies Readonly<Record<string, 'import' | 'needs-ts-morph' | 'not-node-importable'>>;

/** Fail on an unclassified subpath instead of silently not testing it. */
export function classifyPublishedEntries(
  published: readonly string[],
): readonly (readonly [string, string])[] {
  const unclassified = published.filter((key) => !(key in ENTRY_REACHABILITY));
  if (unclassified.length > 0) {
    throw new Error(
      `unclassified published subpaths: ${unclassified.join(', ')} — ` +
        `add each to ENTRY_REACHABILITY in this script`,
    );
  }
  const stale = Object.keys(ENTRY_REACHABILITY).filter((key) => !published.includes(key));
  if (stale.length > 0) {
    throw new Error(
      `ENTRY_REACHABILITY lists subpaths the package no longer exports: ${stale.join(', ')}`,
    );
  }
  return published.map((key) => [key, ENTRY_REACHABILITY[key as keyof typeof ENTRY_REACHABILITY]]);
}

function classifiedEntries(): readonly (readonly [string, string])[] {
  return classifyPublishedEntries(Object.keys(manifest.exports));
}

function run(command: string, args: readonly string[], cwd: string): string {
  return execFileSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Whether the registry serves this exact version yet. */
function registryHasVersion(): { readonly ok: boolean; readonly output: string } {
  try {
    const output = run('npm', ['view', `${manifest.name}@${manifest.version}`, 'version'], ROOT);
    return { ok: output.trim() === manifest.version, output };
  } catch (error) {
    const output = error instanceof Error ? error.message : String(error);
    // A propagation delay is expected briefly; anything else is a real fault
    // and must not be swallowed by the retry loop.
    if (!isRegistryPropagationDelay(output)) throw error;
    return { ok: false, output };
  }
}

async function main(): Promise<void> {
  const target = `${manifest.name}@${manifest.version}`;
  const propagation = await awaitRegistryPropagation(registryHasVersion, (value) => value.ok);
  if (!propagation.ready) {
    throw new Error(
      `${target} is not served by the registry after ${String(propagation.waitedMs)}ms ` +
        `and ${String(propagation.attempts)} attempts; last output: ${propagation.value.output.trim()}`,
    );
  }

  const workspace = mkdtempSync(join(tmpdir(), 'plp-smoke-'));
  try {
    writeFileSync(
      join(workspace, 'package.json'),
      `${JSON.stringify({ name: 'plp-smoke', private: true, type: 'module' }, null, 2)}\n`,
    );
    // --ignore-scripts because a consumer install must not need our scripts,
    // and because running unreviewed lifecycle scripts here would defeat the
    // point of installing from the registry.
    run(
      'npm',
      ['install', target, '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'],
      workspace,
    );

    // Read from disk, not through resolution: the package deliberately does
    // not expose `./package.json` in its export map.
    const installed = JSON.parse(
      readFileSync(join(workspace, 'node_modules', manifest.name, 'package.json'), 'utf8'),
    ) as { readonly version: string };
    if (installed.version !== manifest.version) {
      throw new Error(
        `installed ${manifest.name}@${installed.version}, expected ${manifest.version}`,
      );
    }

    const classified = classifiedEntries();
    // The optional peers are installed so the entries that declare them are
    // genuinely exercised. Without ts-morph the codegen entries fail with
    // "Cannot find package", which says nothing about whether they work.
    run(
      'npm',
      [
        'install',
        'ts-morph@^28.0.0',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--loglevel=error',
      ],
      workspace,
    );

    const entries = classified
      .filter(([, kind]) => kind !== 'not-node-importable')
      .map(([entry]) => entry);
    const probe = entries
      .map((entry, index) => {
        const specifier = entry === '.' ? manifest.name : `${manifest.name}${entry.slice(1)}`;
        return `const m${String(index)} = await import(${JSON.stringify(specifier)});
if (m${String(index)} === null || typeof m${String(index)} !== 'object') {
  throw new Error(${JSON.stringify(`${specifier} did not resolve to a module namespace`)});
}
if (Object.keys(m${String(index)}).length === 0) {
  throw new Error(${JSON.stringify(`${specifier} resolved but exports nothing`)});
}
console.log('  ', ${JSON.stringify(specifier)}, Object.keys(m${String(index)}).length, 'exports');`;
      })
      .join('\n');
    writeFileSync(join(workspace, 'probe.mjs'), `${probe}\n`);
    process.stdout.write(run('node', ['probe.mjs'], workspace));

    // The root entry also ships CJS. A consumer on `require` must reach it.
    writeFileSync(
      join(workspace, 'probe.cjs'),
      `const m = require(${JSON.stringify(manifest.name)});\n` +
        `if (m === null || typeof m !== 'object') throw new Error('CJS root did not resolve');\n` +
        `console.log('${manifest.name} (cjs)', Object.keys(m).length, 'exports');\n`,
    );
    process.stdout.write(run('node', ['probe.cjs'], workspace));

    console.log(
      `[smoke] PASS ${target} installs from the registry and imports ` +
        `${String(entries.length)} of ${String(classified.length)} subpaths plus the CJS root; ` +
        `${String(classified.length - entries.length)} are not Node-importable by nature ` +
        `(propagation ${String(propagation.waitedMs)}ms, ${String(propagation.attempts)} attempt(s)).`,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
