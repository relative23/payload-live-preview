/**
 * Synchronize package identity metadata after `changeset version`.
 *
 * Changesets updates package.json and CHANGELOG.md but does not keep npm's
 * root lock identity or local `file:../..` fixture entries current. This script
 * updates only those copied name/version fields. It performs no dependency
 * resolution and invokes no package manager.
 */
import { randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findPackageLockMetadataViolations,
  LOCAL_FILE_PACKAGE_FIXTURES,
  LOCAL_PACKAGE_SPECIFIER,
  type PackageLockMetadataDocument,
  type PackageLockMetadataInput,
} from './release-contracts';

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function packageIdentity(manifest: unknown): { readonly name: string; readonly version: string } {
  const value = record(manifest, 'root package.json');
  const name = value['name'];
  const version = value['version'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('root package.json name must be a non-empty string');
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new TypeError('root package.json version must be a non-empty string');
  }
  return { name, version };
}

function fixtureEntry(fixture: PackageLockMetadataDocument, packageName: string): JsonRecord {
  const manifest = record(fixture.manifest, `${fixture.label} package.json`);
  const dependencies = record(
    manifest['dependencies'],
    `${fixture.label} package.json dependencies`,
  );
  if (dependencies[packageName] !== LOCAL_PACKAGE_SPECIFIER) {
    throw new Error(
      `${fixture.label} package.json must depend on ${packageName} through ${LOCAL_PACKAGE_SPECIFIER}`,
    );
  }

  const lockfile = record(fixture.lockfile, `${fixture.label} package-lock.json`);
  const packages = record(lockfile['packages'], `${fixture.label} package-lock.json packages`);
  const rootEntry = record(packages[''], `${fixture.label} package-lock.json packages[""]`);
  const lockedDependencies = record(
    rootEntry['dependencies'],
    `${fixture.label} package-lock.json root dependencies`,
  );
  if (lockedDependencies[packageName] !== LOCAL_PACKAGE_SPECIFIER) {
    throw new Error(
      `${fixture.label} package-lock.json root dependency must remain ${LOCAL_PACKAGE_SPECIFIER}`,
    );
  }

  const installedEntry = record(
    packages[`node_modules/${packageName}`],
    `${fixture.label} package-lock.json installed entry`,
  );
  if (installedEntry['resolved'] !== LOCAL_PACKAGE_SPECIFIER) {
    throw new Error(
      `${fixture.label} package-lock.json installed entry must resolve to ${LOCAL_PACKAGE_SPECIFIER}`,
    );
  }
  return installedEntry;
}

/** Return synchronized clones without mutating the caller's parsed documents. */
export function synchronizePackageLockMetadata(
  input: PackageLockMetadataInput,
): PackageLockMetadataInput {
  if (input.fixtures.length !== LOCAL_FILE_PACKAGE_FIXTURES.length) {
    throw new Error(
      `expected exactly ${String(LOCAL_FILE_PACKAGE_FIXTURES.length)} local package fixtures`,
    );
  }
  for (const [index, expected] of LOCAL_FILE_PACKAGE_FIXTURES.entries()) {
    if (input.fixtures[index]?.label !== expected.label) {
      throw new Error(`local package fixture ${String(index)} must be ${expected.label}`);
    }
  }

  const { name, version } = packageIdentity(input.root.manifest);
  const rootLockfile = structuredClone(input.root.lockfile);
  const rootLock = record(rootLockfile, 'root package-lock.json');
  const rootPackages = record(rootLock['packages'], 'root package-lock.json packages');
  const rootEntry = record(rootPackages[''], 'root package-lock.json packages[""]');
  rootLock['name'] = name;
  rootLock['version'] = version;
  rootEntry['name'] = name;
  rootEntry['version'] = version;

  const fixtures = input.fixtures.map((fixture) => {
    const lockfile = structuredClone(fixture.lockfile);
    const synchronizedFixture: PackageLockMetadataDocument = { ...fixture, lockfile };
    fixtureEntry(synchronizedFixture, name)['version'] = version;
    return synchronizedFixture;
  });

  const synchronized: PackageLockMetadataInput = {
    root: { ...input.root, lockfile: rootLockfile },
    fixtures,
  };
  const violations = findPackageLockMetadataViolations(synchronized);
  if (violations.length > 0) {
    throw new Error(`synchronized lock metadata is invalid:\n- ${violations.join('\n- ')}`);
  }
  return synchronized;
}

interface LoadedDocument extends PackageLockMetadataDocument {
  readonly directory: string;
  readonly lockfileSource: string;
}

export interface LockfileTemporaryFile {
  write(source: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface LockfileMetadataFileOperations {
  readTextFile(path: string): Promise<string>;
  openTemporaryFile(path: string): Promise<LockfileTemporaryFile>;
  renameFile(source: string, target: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}

const DEFAULT_FILE_OPERATIONS: LockfileMetadataFileOperations = {
  readTextFile: async (path) => readFile(path, 'utf8'),
  openTemporaryFile: async (path) => {
    const handle = await open(path, 'wx', 0o666);
    return {
      write: async (source) => {
        await handle.writeFile(source, 'utf8');
      },
      sync: async () => {
        await handle.sync();
      },
      close: async () => {
        await handle.close();
      },
    };
  },
  renameFile: async (source, target) => rename(source, target),
  removeFile: async (path) => unlink(path),
};

async function loadDocument(
  label: string,
  directory: string,
  readTextFile: LockfileMetadataFileOperations['readTextFile'],
): Promise<LoadedDocument> {
  const [manifestSource, lockfileSource] = await Promise.all([
    readTextFile(resolve(directory, 'package.json')),
    readTextFile(resolve(directory, 'package-lock.json')),
  ]);
  return {
    label,
    directory,
    manifest: JSON.parse(manifestSource) as unknown,
    lockfile: JSON.parse(lockfileSource) as unknown,
    lockfileSource,
  };
}

interface PlannedLockfileOutput {
  readonly targetPath: string;
  readonly temporaryPath: string;
  readonly originalSource: string;
  readonly serialized: string;
}

async function writeAndCloseTemporary(
  output: PlannedLockfileOutput,
  fileOperations: LockfileMetadataFileOperations,
  ownedTemporaryPaths: Set<string>,
): Promise<void> {
  const temporary = await fileOperations.openTemporaryFile(output.temporaryPath);
  ownedTemporaryPaths.add(output.temporaryPath);
  let failure: { readonly error: unknown } | undefined;

  try {
    await temporary.write(output.serialized);
    await temporary.sync();
  } catch (error: unknown) {
    failure = { error };
  }

  try {
    await temporary.close();
  } catch (error: unknown) {
    failure ??= { error };
  }

  if (failure !== undefined) throw failure.error;
}

async function removeOwnedTemporaries(
  temporaryPaths: ReadonlySet<string>,
  removeFile: LockfileMetadataFileOperations['removeFile'],
): Promise<void> {
  await Promise.allSettled([...temporaryPaths].map((path) => removeFile(path)));
}

/**
 * Synchronize every reviewed lockfile through same-directory temporary files.
 * Each rename is atomic for its own target; the set of lockfiles is deliberately
 * not presented as one cross-file transaction.
 */
export async function synchronizePackageLockMetadataFiles(
  repositoryRoot: string,
  operationOverrides: Partial<LockfileMetadataFileOperations> = {},
): Promise<number> {
  const fileOperations: LockfileMetadataFileOperations = {
    ...DEFAULT_FILE_OPERATIONS,
    ...operationOverrides,
  };
  const root = await loadDocument('root', repositoryRoot, (path) =>
    fileOperations.readTextFile(path),
  );
  const fixtures = await Promise.all(
    LOCAL_FILE_PACKAGE_FIXTURES.map(({ label, directory }) =>
      loadDocument(label, resolve(repositoryRoot, directory), (path) =>
        fileOperations.readTextFile(path),
      ),
    ),
  );
  const synchronized = synchronizePackageLockMetadata({ root, fixtures });
  const outputs = [synchronized.root, ...synchronized.fixtures];
  const inputs = [root, ...fixtures];
  const planned = outputs.map((output, index): Omit<PlannedLockfileOutput, 'temporaryPath'> => {
    const input = inputs[index];
    if (input === undefined) throw new Error(`missing lockfile input ${String(index)}`);
    const lockfile = record(output.lockfile, `${output.label} package-lock.json`);
    const serialized = `${JSON.stringify(lockfile, undefined, 2)}\n`;
    JSON.parse(serialized);
    return {
      targetPath: resolve(input.directory, 'package-lock.json'),
      originalSource: input.lockfileSource,
      serialized,
    };
  });
  const targetPaths = new Set(planned.map(({ targetPath }) => targetPath));
  if (targetPaths.size !== planned.length) {
    throw new Error('lockfile metadata outputs must have distinct target paths');
  }

  const changedOutputs: PlannedLockfileOutput[] = planned
    .filter(({ originalSource, serialized }) => serialized !== originalSource)
    .map((output, index) => ({
      ...output,
      temporaryPath: resolve(
        dirname(output.targetPath),
        `.${basename(output.targetPath)}.${String(process.pid)}.${String(index)}.${randomUUID()}.tmp`,
      ),
    }));
  if (changedOutputs.length === 0) return 0;

  const ownedTemporaryPaths = new Set<string>();
  try {
    for (const output of changedOutputs) {
      await writeAndCloseTemporary(output, fileOperations, ownedTemporaryPaths);
    }

    for (const output of changedOutputs) {
      const stagedSource = await fileOperations.readTextFile(output.temporaryPath);
      if (stagedSource !== output.serialized) {
        throw new Error(`${output.targetPath} temporary file failed byte-for-byte validation`);
      }
      JSON.parse(stagedSource);
      const currentTargetSource = await fileOperations.readTextFile(output.targetPath);
      if (currentTargetSource !== output.originalSource) {
        throw new Error(`${output.targetPath} changed while lockfile metadata was being staged`);
      }
    }

    for (const output of changedOutputs) {
      await fileOperations.renameFile(output.temporaryPath, output.targetPath);
      ownedTemporaryPaths.delete(output.temporaryPath);
    }
  } catch (error: unknown) {
    await removeOwnedTemporaries(ownedTemporaryPaths, (path) => fileOperations.removeFile(path));
    throw error;
  }

  return changedOutputs.length;
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const changed = await synchronizePackageLockMetadataFiles(repositoryRoot);

  console.log(
    changed === 0
      ? '[lockfile-metadata] already synchronized'
      : `[lockfile-metadata] synchronized ${String(changed)} lockfile(s)`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
