import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findPackageLockMetadataViolations,
  LOCAL_FILE_PACKAGE_FIXTURES,
  LOCAL_PACKAGE_SPECIFIER,
} from '../../scripts/release-contracts';
import {
  synchronizePackageLockMetadata,
  synchronizePackageLockMetadataFiles,
  type LockfileTemporaryFile,
} from '../../scripts/sync-lockfile-metadata';

const ROOT = resolve(import.meta.dirname, '../..');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function repositoryPackageIdentity(): { readonly name: string; readonly version: string } {
  const manifest = readJson(resolve(ROOT, 'package.json')) as {
    name?: unknown;
    version?: unknown;
  };
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error('repository package identity is malformed');
  }
  return { name: manifest.name, version: manifest.version };
}

function readPackageLockMetadataInput(
  repositoryRoot = ROOT,
): Parameters<typeof findPackageLockMetadataViolations>[0] {
  return {
    root: {
      label: 'root',
      manifest: readJson(resolve(repositoryRoot, 'package.json')),
      lockfile: readJson(resolve(repositoryRoot, 'package-lock.json')),
    },
    fixtures: LOCAL_FILE_PACKAGE_FIXTURES.map(({ label, directory }) => ({
      label,
      manifest: readJson(resolve(repositoryRoot, directory, 'package.json')),
      lockfile: readJson(resolve(repositoryRoot, directory, 'package-lock.json')),
    })),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8');
}

async function createStaleLockfileMetadataRepository(): Promise<{
  readonly repositoryRoot: string;
  readonly targetPaths: readonly string[];
}> {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'plp-lockfile-metadata-'));
  const { name } = repositoryPackageIdentity();
  const currentVersion = '7.8.9';
  const nextVersion = '7.8.10';
  const targetPaths = [resolve(repositoryRoot, 'package-lock.json')];

  await writeJson(resolve(repositoryRoot, 'package.json'), { name, version: nextVersion });
  await writeJson(targetPaths[0]!, {
    name,
    version: currentVersion,
    lockfileVersion: 3,
    packages: {
      '': { name, version: currentVersion },
    },
  });

  for (const { directory } of LOCAL_FILE_PACKAGE_FIXTURES) {
    const fixtureDirectory = resolve(repositoryRoot, directory);
    const targetPath = resolve(fixtureDirectory, 'package-lock.json');
    targetPaths.push(targetPath);
    await mkdir(fixtureDirectory, { recursive: true });
    await writeJson(resolve(fixtureDirectory, 'package.json'), {
      name: `${directory.replaceAll('/', '-')}-fixture`,
      dependencies: { [name]: LOCAL_PACKAGE_SPECIFIER },
    });
    await writeJson(targetPath, {
      name: `${directory.replaceAll('/', '-')}-fixture`,
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { [name]: LOCAL_PACKAGE_SPECIFIER } },
        [`node_modules/${name}`]: {
          version: currentVersion,
          resolved: LOCAL_PACKAGE_SPECIFIER,
        },
      },
    });
  }

  return { repositoryRoot, targetPaths };
}

async function findLockfileTemporaryPaths(targetPaths: readonly string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const targetPath of targetPaths) {
    const directory = dirname(targetPath);
    for (const entry of await readdir(directory)) {
      if (entry.startsWith('.package-lock.json.') && entry.endsWith('.tmp')) {
        paths.push(resolve(directory, entry));
      }
    }
  }
  return paths;
}

describe('workspace package-lock identity contract', () => {
  it('keeps package.json, the root lock, and all file:../.. fixture entries synchronized', () => {
    expect(LOCAL_FILE_PACKAGE_FIXTURES).toHaveLength(4);
    expect(findPackageLockMetadataViolations(readPackageLockMetadataInput())).toEqual([]);
  });

  it('rejects name/version drift at both root package-lock identity locations', () => {
    const input = readPackageLockMetadataInput();
    const { name, version } = repositoryPackageIdentity();
    const lockfile = structuredClone(input.root.lockfile) as {
      name: string;
      version: string;
      packages: Record<string, { name?: string; version?: string }>;
    };
    lockfile.name = 'wrong-root-name';
    lockfile.version = '9.9.9';
    lockfile.packages[''] = { name: 'wrong-entry-name', version: '8.8.8' };

    expect(
      findPackageLockMetadataViolations({
        ...input,
        root: { ...input.root, lockfile },
      }),
    ).toEqual([
      `root: package-lock.json name must match package.json name ${name}; run npm run version`,
      `root: package-lock.json version must match package.json version ${version}; run npm run version`,
      `root: package-lock.json packages[""] name must match package.json name ${name}; run npm run version`,
      `root: package-lock.json packages[""] version must match package.json version ${version}; run npm run version`,
    ]);
  });

  it.each([0, 1, 2] as const)(
    'rejects stale or redirected file:../.. fixture lock entry %i',
    (index) => {
      const input = readPackageLockMetadataInput();
      const { name, version } = repositoryPackageIdentity();
      const fixtures = structuredClone(input.fixtures) as {
        label: string;
        manifest: { dependencies: Record<string, string> };
        lockfile: {
          packages: Record<
            string,
            { dependencies?: Record<string, string>; resolved?: string; version?: string }
          >;
        };
      }[];
      const fixture = fixtures[index];
      if (fixture === undefined) throw new Error(`missing fixture ${String(index)}`);
      fixture.manifest.dependencies[name] = 'file:../../other-package';
      fixture.lockfile.packages['']!.dependencies![name] = 'file:../../other-package';
      fixture.lockfile.packages[`node_modules/${name}`] = {
        resolved: 'file:../../other-package',
        version: '0.0.0',
      };

      expect(
        findPackageLockMetadataViolations({
          ...input,
          fixtures,
        }).filter((violation) => violation.startsWith(`${fixture.label}:`)),
      ).toEqual([
        `${fixture.label}: package.json must depend on ${name} through file:../..`,
        `${fixture.label}: package-lock.json root dependency must remain file:../..`,
        `${fixture.label}: package-lock.json installed entry must resolve to file:../..`,
        `${fixture.label}: file:../.. lock entry version must match ${name}@${version}; run npm run version`,
      ]);
    },
  );

  it('synchronizes only package identity metadata and is idempotent', () => {
    const input = readPackageLockMetadataInput();
    const { name, version } = repositoryPackageIdentity();
    const stale = structuredClone(input);
    const rootLockfile = stale.root.lockfile as {
      name: string;
      version: string;
      packages: Record<string, { name?: string; version?: string }>;
    };
    rootLockfile.name = 'stale-name';
    rootLockfile.version = '0.0.0';
    rootLockfile.packages['']!.name = 'stale-name';
    rootLockfile.packages['']!.version = '0.0.0';
    for (const fixture of stale.fixtures) {
      const lockfile = fixture.lockfile as {
        packages: Record<string, { version?: string }>;
      };
      lockfile.packages[`node_modules/${name}`]!.version = '0.0.0';
    }
    const original = structuredClone(stale);
    const expected = structuredClone(original);
    const expectedRootLockfile = expected.root.lockfile as {
      name: string;
      version: string;
      packages: Record<string, { name?: string; version?: string }>;
    };
    expectedRootLockfile.name = name;
    expectedRootLockfile.version = version;
    expectedRootLockfile.packages['']!.name = name;
    expectedRootLockfile.packages['']!.version = version;
    for (const fixture of expected.fixtures) {
      const lockfile = fixture.lockfile as {
        packages: Record<string, { version?: string }>;
      };
      lockfile.packages[`node_modules/${name}`]!.version = version;
    }

    const synchronized = synchronizePackageLockMetadata(stale);

    expect(stale).toEqual(original);
    expect(synchronized).toEqual(expected);
    expect(findPackageLockMetadataViolations(synchronized)).toEqual([]);
    expect(synchronizePackageLockMetadata(synchronized)).toEqual(synchronized);
  });

  it('fails closed without changing input when fixture wiring is not the reviewed file link', () => {
    const input = readPackageLockMetadataInput();
    const { name } = repositoryPackageIdentity();
    const malformed = structuredClone(input);
    const fixture = malformed.fixtures[0];
    if (fixture === undefined) throw new Error('missing Astro fixture');
    const lockfile = fixture.lockfile as {
      packages: Record<string, { resolved?: string }>;
    };
    lockfile.packages[`node_modules/${name}`]!.resolved = 'file:../../other-package';
    const original = structuredClone(malformed);

    expect(() => synchronizePackageLockMetadata(malformed)).toThrow(
      'Astro fixture package-lock.json installed entry must resolve to file:../..',
    );
    expect(malformed).toEqual(original);
  });

  it('writes every validated lockfile through a complete same-directory temporary file', async () => {
    const { repositoryRoot, targetPaths } = await createStaleLockfileMetadataRepository();
    const events: string[] = [];
    let openCount = 0;
    try {
      await expect(
        synchronizePackageLockMetadataFiles(repositoryRoot, {
          openTemporaryFile: async (path): Promise<LockfileTemporaryFile> => {
            const ordinal = ++openCount;
            events.push(`open:${String(ordinal)}`);
            const handle = await open(path, 'wx', 0o666);
            return {
              write: async (source) => {
                events.push(`write:${String(ordinal)}`);
                await handle.writeFile(source, 'utf8');
              },
              sync: async () => {
                events.push(`sync:${String(ordinal)}`);
                await handle.sync();
              },
              close: async () => {
                events.push(`close:${String(ordinal)}`);
                await handle.close();
              },
            };
          },
          renameFile: async (source, target) => {
            const ordinal = targetPaths.indexOf(target) + 1;
            events.push(`rename:${String(ordinal)}`);
            await rename(source, target);
          },
        }),
      ).resolves.toBe(5);

      expect(
        findPackageLockMetadataViolations(readPackageLockMetadataInput(repositoryRoot)),
      ).toEqual([]);
      for (const targetPath of targetPaths) {
        expect(() => {
          JSON.parse(readFileSync(targetPath, 'utf8'));
        }).not.toThrow();
      }
      expect(await findLockfileTemporaryPaths(targetPaths)).toEqual([]);
      expect(events).toEqual([
        'open:1',
        'write:1',
        'sync:1',
        'close:1',
        'open:2',
        'write:2',
        'sync:2',
        'close:2',
        'open:3',
        'write:3',
        'sync:3',
        'close:3',
        'open:4',
        'write:4',
        'sync:4',
        'close:4',
        'open:5',
        'write:5',
        'sync:5',
        'close:5',
        'rename:1',
        'rename:2',
        'rename:3',
        'rename:4',
        'rename:5',
      ]);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('leaves every target unchanged when temporary write, sync, or close fails', async () => {
    for (const failureStage of ['write', 'sync', 'close'] as const) {
      const { repositoryRoot, targetPaths } = await createStaleLockfileMetadataRepository();
      const before = await Promise.all(targetPaths.map((path) => readFile(path, 'utf8')));
      const events: string[] = [];
      let openCount = 0;
      let renameCount = 0;
      try {
        await expect(
          synchronizePackageLockMetadataFiles(repositoryRoot, {
            openTemporaryFile: async (path): Promise<LockfileTemporaryFile> => {
              const handle = await open(path, 'wx', 0o666);
              const ordinal = ++openCount;
              return {
                write: async (source) => {
                  events.push(`write:${String(ordinal)}`);
                  if (ordinal === 2 && failureStage === 'write') {
                    await handle.writeFile('{"incomplete":', 'utf8');
                    throw new Error(`injected lockfile temporary ${failureStage} failure`);
                  }
                  await handle.writeFile(source, 'utf8');
                },
                sync: async () => {
                  events.push(`sync:${String(ordinal)}`);
                  if (ordinal === 2 && failureStage === 'sync') {
                    throw new Error(`injected lockfile temporary ${failureStage} failure`);
                  }
                  await handle.sync();
                },
                close: async () => {
                  events.push(`close:${String(ordinal)}`);
                  await handle.close();
                  if (ordinal === 2 && failureStage === 'close') {
                    throw new Error(`injected lockfile temporary ${failureStage} failure`);
                  }
                },
              };
            },
            renameFile: () => {
              renameCount += 1;
              return Promise.reject(
                new Error('rename must not run before every temporary file is durable'),
              );
            },
          }),
        ).rejects.toThrow(`injected lockfile temporary ${failureStage} failure`);

        expect(openCount).toBe(2);
        expect(events).toContain('close:2');
        expect(renameCount).toBe(0);
        await expect(
          Promise.all(targetPaths.map((path) => readFile(path, 'utf8'))),
        ).resolves.toEqual(before);
        expect(await findLockfileTemporaryPaths(targetPaths)).toEqual([]);
      } finally {
        await rm(repositoryRoot, { recursive: true, force: true });
      }
    }
  });

  it('rejects a corrupted staged reread before replacing any target', async () => {
    const { repositoryRoot, targetPaths } = await createStaleLockfileMetadataRepository();
    const before = await Promise.all(targetPaths.map((path) => readFile(path, 'utf8')));
    let renameCount = 0;
    try {
      await expect(
        synchronizePackageLockMetadataFiles(repositoryRoot, {
          readTextFile: async (path) => {
            const source = await readFile(path, 'utf8');
            return path.endsWith('.tmp')
              ? source.replace('"version": "7.8.10"', '"version": "0"')
              : source;
          },
          renameFile: () => {
            renameCount += 1;
            return Promise.reject(new Error('corrupt staged output must never be renamed'));
          },
        }),
      ).rejects.toThrow('temporary file failed byte-for-byte validation');

      expect(renameCount).toBe(0);
      await expect(Promise.all(targetPaths.map((path) => readFile(path, 'utf8')))).resolves.toEqual(
        before,
      );
      expect(await findLockfileTemporaryPaths(targetPaths)).toEqual([]);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('rejects a target changed during staging before replacing any lockfile', async () => {
    const { repositoryRoot, targetPaths } = await createStaleLockfileMetadataRepository();
    const before = await Promise.all(targetPaths.map((path) => readFile(path, 'utf8')));
    const racedTarget = targetPaths[0]!;
    let targetReadCount = 0;
    let renameCount = 0;
    try {
      await expect(
        synchronizePackageLockMetadataFiles(repositoryRoot, {
          readTextFile: async (path) => {
            const source = await readFile(path, 'utf8');
            if (path !== racedTarget) return source;
            targetReadCount += 1;
            return targetReadCount === 2 ? `${source} ` : source;
          },
          renameFile: () => {
            renameCount += 1;
            return Promise.reject(new Error('raced target must never be replaced'));
          },
        }),
      ).rejects.toThrow(`${racedTarget} changed while lockfile metadata was being staged`);

      expect(targetReadCount).toBe(2);
      expect(renameCount).toBe(0);
      await expect(Promise.all(targetPaths.map((path) => readFile(path, 'utf8')))).resolves.toEqual(
        before,
      );
      expect(await findLockfileTemporaryPaths(targetPaths)).toEqual([]);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('propagates a first rename failure and removes every uncommitted temporary', async () => {
    const { repositoryRoot, targetPaths } = await createStaleLockfileMetadataRepository();
    const before = await Promise.all(targetPaths.map((path) => readFile(path, 'utf8')));
    let renameCount = 0;
    try {
      await expect(
        synchronizePackageLockMetadataFiles(repositoryRoot, {
          renameFile: () => {
            renameCount += 1;
            return Promise.reject(new Error('injected first rename failure'));
          },
        }),
      ).rejects.toThrow('injected first rename failure');

      expect(renameCount).toBe(1);
      await expect(Promise.all(targetPaths.map((path) => readFile(path, 'utf8')))).resolves.toEqual(
        before,
      );
      expect(await findLockfileTemporaryPaths(targetPaths)).toEqual([]);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('is idempotent on disk without opening or replacing any file', async () => {
    const { repositoryRoot, targetPaths } = await createStaleLockfileMetadataRepository();
    try {
      await expect(synchronizePackageLockMetadataFiles(repositoryRoot)).resolves.toBe(5);
      const synchronized = await Promise.all(targetPaths.map((path) => readFile(path, 'utf8')));

      await expect(
        synchronizePackageLockMetadataFiles(repositoryRoot, {
          openTemporaryFile: () =>
            Promise.reject(new Error('idempotent sync must not create a temporary file')),
          renameFile: () => Promise.reject(new Error('idempotent sync must not replace a target')),
        }),
      ).resolves.toBe(0);

      await expect(Promise.all(targetPaths.map((path) => readFile(path, 'utf8')))).resolves.toEqual(
        synchronized,
      );
      expect(await findLockfileTemporaryPaths(targetPaths)).toEqual([]);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('runs the deterministic metadata sync after Changesets versions the package', () => {
    const manifest = readJson(resolve(ROOT, 'package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(manifest.scripts?.['version']).toBe(
      'changeset version && tsx scripts/sync-lockfile-metadata.ts',
    );
  });
});
