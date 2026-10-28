/**
 * Did `npm ci` install every platform package its lockfile names for this machine?
 *
 * A native binding ships as optional packages limited by `os`, `cpu` and `libc`, and npm
 * installs the one that matches. On 2026-10-24 (main CI run 40096362187) it left out
 * `@rolldown/binding-linux-x64-gnu` in the SvelteKit fixture although the lockfile names it for
 * linux-x64-glibc, reported success with 72 instead of 73 packages, and the dev server failed 20 s
 * later as a test failure. `scripts/ci-install-fixture.sh` runs this after `npm ci` and installs
 * again when it reports a package.
 *
 *   usage: node scripts/check-platform-packages.ts <directory with package-lock.json>
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Platform {
  readonly os: string;
  readonly cpu: string;
  /** `glibc` or `musl` on Linux, absent elsewhere, as npm decides it. */
  readonly libc: string | undefined;
}

export interface LockEntry {
  readonly version?: string;
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
  readonly libc?: readonly string[];
  readonly inBundle?: boolean;
}

const NESTED = '/node_modules/';

export function currentPlatform(): Platform {
  const header = (process.report.getReport() as { header?: { glibcVersionRuntime?: string } })
    .header;
  const libc =
    process.platform !== 'linux'
      ? undefined
      : header?.glibcVersionRuntime === undefined
        ? 'musl'
        : 'glibc';
  return { os: process.platform, cpu: process.arch, libc };
}

// npm-install-checks: a `!value` entry excludes, and a list of exclusions alone admits the rest.
function admits(list: readonly string[] | undefined, value: string | undefined): boolean {
  if (list === undefined) return true;
  let match = false;
  let excluded = 0;
  for (const entry of list) {
    if (entry.startsWith('!')) {
      if (entry.slice(1) === value) return false;
      excluded++;
    } else if (entry === value) {
      match = true;
    }
  }
  return match || excluded === list.length;
}

function installsHere(entry: LockEntry, platform: Platform): boolean {
  return (
    admits(entry.os, platform.os) &&
    admits(entry.cpu, platform.cpu) &&
    admits(entry.libc, platform.libc)
  );
}

// A package nested under one this platform does not get is not installed either.
function parentsInstallHere(
  path: string,
  packages: Readonly<Record<string, LockEntry>>,
  platform: Platform,
): boolean {
  for (let at = path.lastIndexOf(NESTED); at > 0; at = path.lastIndexOf(NESTED, at - 1)) {
    const parent = packages[path.slice(0, at)];
    if (parent !== undefined && !installsHere(parent, platform)) return false;
  }
  return true;
}

/** Whether npm installs the lockfile entry at `path` on this platform, its parents included. */
export function installsOn(
  path: string,
  packages: Readonly<Record<string, LockEntry>>,
  platform: Platform,
): boolean {
  const entry = packages[path];
  return (
    entry !== undefined &&
    installsHere(entry, platform) &&
    parentsInstallHere(path, packages, platform)
  );
}

/** The lockfile paths of the platform packages this platform should have and does not. */
export function missingPlatformPackages(
  root: string,
  platform: Platform = currentPlatform(),
): readonly string[] {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
    packages?: Record<string, LockEntry>;
  };
  const packages = lock.packages ?? {};
  return Object.entries(packages)
    .filter(
      ([path, entry]) =>
        path.startsWith('node_modules/') &&
        entry.inBundle !== true &&
        (entry.os ?? entry.cpu ?? entry.libc) !== undefined &&
        installsOn(path, packages, platform) &&
        !existsSync(join(root, path, 'package.json')),
    )
    .map(([path, entry]) => `${path}@${entry.version ?? '?'}`);
}

function main(): void {
  const root = process.argv[2];
  if (root === undefined) {
    console.error(
      'usage: node scripts/check-platform-packages.ts <directory with package-lock.json>',
    );
    process.exitCode = 2;
    return;
  }
  const platform = currentPlatform();
  const missing = missingPlatformPackages(root, platform);
  const target = `${platform.os}-${platform.cpu}${platform.libc === undefined ? '' : `-${platform.libc}`}`;
  if (missing.length === 0) {
    console.log(
      `[platform packages] ${root}: every package the lockfile names for ${target} is installed.`,
    );
    return;
  }
  console.error(
    `[platform packages] ${root}: npm left out ${String(missing.length)} package(s) the lockfile names for ${target}:\n` +
      missing.map((path) => `  - ${path}`).join('\n'),
  );
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
