/**
 * The CI fixture install reruns `npm ci` when this check names a package, so it
 * must name exactly the platform packages npm should have installed here. The
 * lockfiles below are synthetic; the first case is the binding npm left out in
 * main CI run 40096362187.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { missingPlatformPackages, type Platform } from '../../scripts/check-platform-packages';

const LINUX_GLIBC: Platform = { os: 'linux', cpu: 'x64', libc: 'glibc' };
const DARWIN: Platform = { os: 'darwin', cpu: 'arm64', libc: undefined };

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'plp-platform-packages-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function lockfile(packages: Record<string, object>): Promise<void> {
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...packages } }),
    'utf8',
  );
}

async function install(...paths: string[]): Promise<void> {
  for (const path of paths) {
    await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, path, 'package.json'), '{}', 'utf8');
  }
}

const binding = (os: string, cpu: string, libc?: string): object => ({
  version: '1.2.15',
  optional: true,
  os: [os],
  cpu: [cpu],
  ...(libc === undefined ? {} : { libc: [libc] }),
});

describe('missingPlatformPackages', () => {
  it('names the binding for this platform that npm left out, and none of the others', async () => {
    await lockfile({
      'node_modules/rolldown': { version: '1.2.15' },
      'node_modules/@rolldown/binding-linux-x64-gnu': binding('linux', 'x64', 'glibc'),
      'node_modules/@rolldown/binding-linux-x64-musl': binding('linux', 'x64', 'musl'),
      'node_modules/@rolldown/binding-darwin-arm64': binding('darwin', 'arm64'),
    });
    await install('node_modules/rolldown');

    expect(missingPlatformPackages(root, LINUX_GLIBC)).toEqual([
      'node_modules/@rolldown/binding-linux-x64-gnu@1.2.15',
    ]);
    expect(missingPlatformPackages(root, DARWIN)).toEqual([
      'node_modules/@rolldown/binding-darwin-arm64@1.2.15',
    ]);

    await install('node_modules/@rolldown/binding-linux-x64-gnu');
    expect(missingPlatformPackages(root, LINUX_GLIBC)).toEqual([]);
  });

  it('reads a list of exclusions as every other platform, as npm does', async () => {
    await lockfile({
      'node_modules/not-on-windows': { version: '1.0.0', os: ['!win32'] },
      'node_modules/not-on-linux': { version: '1.0.0', os: ['!linux'] },
      'node_modules/linux-or-darwin': { version: '1.0.0', os: ['linux', 'darwin'] },
    });

    expect(missingPlatformPackages(root, LINUX_GLIBC)).toEqual([
      'node_modules/not-on-windows@1.0.0',
      'node_modules/linux-or-darwin@1.0.0',
    ]);
  });

  it('expects nothing below a package this platform does not get', async () => {
    await lockfile({
      'node_modules/fsevents': binding('darwin', 'arm64'),
      'node_modules/fsevents/node_modules/inner': binding('linux', 'x64'),
      'node_modules/kept': { version: '1.0.0' },
      'node_modules/kept/node_modules/inner': binding('linux', 'x64'),
    });

    expect(missingPlatformPackages(root, LINUX_GLIBC)).toEqual([
      'node_modules/kept/node_modules/inner@1.2.15',
    ]);
  });

  it('leaves out bundled packages, packages without a platform field and the link target', async () => {
    await lockfile({
      'node_modules/plain': { version: '1.0.0', optional: true },
      'node_modules/host/node_modules/bundled': { ...binding('linux', 'x64'), inBundle: true },
      '../..': { version: '2.1.1', os: ['linux'] },
    });

    expect(missingPlatformPackages(root, LINUX_GLIBC)).toEqual([]);
  });
});
