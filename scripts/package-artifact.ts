/** Exact npm archive evidence and its release hand-off manifest. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export const PACKAGE_ARTIFACT_MANIFEST = 'package-artifact.json';
export const PACKAGE_ARTIFACT_SCHEMA_VERSION = 1;

export interface PackageArtifactFile {
  readonly path: string;
  readonly size: number;
  readonly mode: number;
}

export interface PackageArchiveEvidence {
  readonly filename: string;
  readonly name: string;
  readonly version: string;
  readonly size: number;
  readonly unpackedSize: number;
  readonly sha1: string;
  readonly sha256: string;
  readonly integrity: string;
  readonly files: readonly PackageArtifactFile[];
}

export interface NpmPackReport {
  readonly filename: string;
  readonly name: string;
  readonly version: string;
  readonly size: number;
  readonly unpackedSize: number;
  readonly shasum: string;
  readonly integrity: string;
  readonly files: readonly PackageArtifactFile[];
}

export interface PackageArtifactManifest {
  readonly schemaVersion: 1;
  readonly package: {
    readonly name: string;
    readonly version: string;
  };
  readonly source: {
    readonly commit: string;
    readonly sourceDateEpoch: string | null;
  };
  readonly toolchain: {
    readonly node: string;
    readonly npm: string;
  };
  readonly archive: Omit<PackageArchiveEvidence, 'files' | 'name' | 'version'>;
  readonly files: readonly PackageArtifactFile[];
}

export interface PackageArtifactArguments {
  readonly artifactDirectory: string | undefined;
  readonly tarball: string | undefined;
  readonly manifest: string | undefined;
  readonly sourceCommit: string | undefined;
  readonly updateApiReports: boolean;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function comparePaths(left: PackageArtifactFile, right: PackageArtifactFile): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

export function isSafePackageArchiveFilename(filename: string): boolean {
  return (
    filename.endsWith('.tgz') &&
    filename !== '.tgz' &&
    !filename.includes('\\') &&
    basename(filename) === filename
  );
}

function requiredString(record: JsonRecord, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function requiredInteger(record: JsonRecord, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}.${key} must be a non-negative safe integer`);
  }
  return value;
}

function parseFiles(value: unknown): readonly PackageArtifactFile[] {
  if (!Array.isArray(value)) throw new Error('npm pack report files must be an array');
  const files = value.map((file, index): PackageArtifactFile => {
    if (!isRecord(file)) throw new Error(`npm pack report files[${String(index)}] is malformed`);
    return {
      path: requiredString(file, 'path', `files[${String(index)}]`),
      size: requiredInteger(file, 'size', `files[${String(index)}]`),
      mode: requiredInteger(file, 'mode', `files[${String(index)}]`),
    };
  });
  files.sort(comparePaths);
  const paths = new Set<string>();
  for (const file of files) {
    if (
      file.path.startsWith('/') ||
      file.path.includes('\\') ||
      file.path.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
    ) {
      throw new Error(`npm pack report contains unsafe path: ${file.path}`);
    }
    if (paths.has(file.path)) throw new Error(`npm pack report repeats path: ${file.path}`);
    paths.add(file.path);
  }
  return files;
}

/**
 * The single package entry, whichever shape npm reported it in: 11 and earlier
 * emit an array of packages, 12 an object keyed by package name. The entries
 * themselves are identical, so the shape is all that has to be reconciled.
 */
function singlePackageEntry(parsed: unknown): Record<string, unknown> {
  const entries: unknown[] = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed)
      ? Object.values(parsed)
      : [];
  const [entry] = entries;
  if (entries.length !== 1 || !isRecord(entry)) {
    throw new Error('npm pack returned an unexpected JSON report');
  }
  return entry;
}

/** Parse the one-package JSON contract produced by npm pack. */
export function parseNpmPackReport(output: string): NpmPackReport {
  const report = singlePackageEntry(JSON.parse(output));
  return {
    filename: requiredString(report, 'filename', 'npm pack report'),
    name: requiredString(report, 'name', 'npm pack report'),
    version: requiredString(report, 'version', 'npm pack report'),
    size: requiredInteger(report, 'size', 'npm pack report'),
    unpackedSize: requiredInteger(report, 'unpackedSize', 'npm pack report'),
    shasum: requiredString(report, 'shasum', 'npm pack report'),
    integrity: requiredString(report, 'integrity', 'npm pack report'),
    files: parseFiles(report['files']),
  };
}

function digest(bytes: Uint8Array, algorithm: 'sha1' | 'sha256' | 'sha512'): string {
  return createHash(algorithm)
    .update(bytes)
    .digest(algorithm === 'sha512' ? 'base64' : 'hex');
}

/** Independently bind npm's report to the raw archive bytes. */
export async function createPackageArchiveEvidence(
  tarball: string,
  report: NpmPackReport,
): Promise<PackageArchiveEvidence> {
  const bytes = await readFile(tarball);
  const sha1 = digest(bytes, 'sha1');
  const sha256 = digest(bytes, 'sha256');
  const integrity = `sha512-${digest(bytes, 'sha512')}`;
  if (report.size !== bytes.byteLength) {
    throw new Error(
      `npm pack size ${String(report.size)} does not match archive size ${String(bytes.byteLength)}`,
    );
  }
  if (report.shasum !== sha1) throw new Error('npm pack SHA-1 does not match the archive bytes');
  if (report.integrity !== integrity) {
    throw new Error('npm pack integrity does not match the archive bytes');
  }
  if (!isSafePackageArchiveFilename(report.filename)) {
    throw new Error(`npm pack returned an unsafe filename: ${report.filename}`);
  }
  return {
    filename: report.filename,
    name: report.name,
    version: report.version,
    size: report.size,
    unpackedSize: report.unpackedSize,
    sha1,
    sha256,
    integrity,
    files: report.files,
  };
}

function commandDetail(stdout: string, stderr: string): string {
  const detail = `${stdout}\n${stderr}`.trim();
  return detail.length > 2_000 ? detail.slice(-2_000) : detail;
}

/** Inspect an existing tgz without packing the checked-out directory again. */
export async function inspectPackageArchive(
  tarball: string,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PackageArchiveEvidence> {
  const result = spawnSync('npm', ['pack', tarball, '--dry-run', '--ignore-scripts', '--json'], {
    cwd,
    encoding: 'utf8',
    env: environment,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `npm could not inspect the existing package archive:\n${commandDetail(result.stdout, result.stderr)}`,
    );
  }
  return createPackageArchiveEvidence(tarball, parseNpmPackReport(result.stdout));
}

export function createPackageArtifactManifest(input: {
  readonly evidence: PackageArchiveEvidence;
  readonly sourceCommit: string;
  readonly sourceDateEpoch: string | undefined;
  readonly nodeVersion: string;
  readonly npmVersion: string;
}): PackageArtifactManifest {
  const { evidence } = input;
  return {
    schemaVersion: PACKAGE_ARTIFACT_SCHEMA_VERSION,
    package: { name: evidence.name, version: evidence.version },
    source: {
      commit: input.sourceCommit,
      sourceDateEpoch: input.sourceDateEpoch ?? null,
    },
    toolchain: { node: input.nodeVersion, npm: input.npmVersion },
    archive: {
      filename: evidence.filename,
      size: evidence.size,
      unpackedSize: evidence.unpackedSize,
      sha1: evidence.sha1,
      sha256: evidence.sha256,
      integrity: evidence.integrity,
    },
    files: [...evidence.files].sort(comparePaths),
  };
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

export function findPackageArtifactManifestViolations(
  manifest: unknown,
  expected: {
    readonly evidence: PackageArchiveEvidence;
    readonly expectedName: string;
    readonly expectedVersion: string;
    readonly expectedSourceCommit: string;
    readonly expectedSourceDateEpoch: string | undefined;
    readonly expectedNodeVersion: string;
    readonly expectedNpmVersion: string;
  },
): readonly string[] {
  const violations: string[] = [];
  if (!isRecord(manifest)) return ['artifact manifest is not an object'];
  if (manifest['schemaVersion'] !== PACKAGE_ARTIFACT_SCHEMA_VERSION) {
    violations.push(
      `artifact manifest schemaVersion must be ${String(PACKAGE_ARTIFACT_SCHEMA_VERSION)}`,
    );
  }

  const packageValue = manifest['package'];
  if (!isRecord(packageValue)) violations.push('artifact manifest package is malformed');
  else {
    if (
      packageValue['name'] !== expected.expectedName ||
      packageValue['name'] !== expected.evidence.name
    ) {
      violations.push('artifact manifest package name does not match the archive/repository');
    }
    if (
      packageValue['version'] !== expected.expectedVersion ||
      packageValue['version'] !== expected.evidence.version
    ) {
      violations.push('artifact manifest package version does not match the archive/repository');
    }
  }

  const source = manifest['source'];
  if (!isRecord(source)) violations.push('artifact manifest source is malformed');
  else {
    if (source['commit'] !== expected.expectedSourceCommit) {
      violations.push('artifact manifest source commit does not match the tested commit');
    }
    const expectedEpoch = expected.expectedSourceDateEpoch;
    if (expectedEpoch !== undefined && source['sourceDateEpoch'] !== expectedEpoch) {
      violations.push('artifact manifest SOURCE_DATE_EPOCH does not match the tested commit');
    }
    if (
      source['sourceDateEpoch'] !== null &&
      (typeof source['sourceDateEpoch'] !== 'string' ||
        !/^(?:0|[1-9][0-9]*)$/u.test(source['sourceDateEpoch']))
    ) {
      violations.push('artifact manifest SOURCE_DATE_EPOCH is malformed');
    }
  }

  const toolchain = manifest['toolchain'];
  if (!isRecord(toolchain)) violations.push('artifact manifest toolchain is malformed');
  else {
    if (toolchain['node'] !== expected.expectedNodeVersion) {
      violations.push('artifact manifest Node version does not match the verifying toolchain');
    }
    if (toolchain['npm'] !== expected.expectedNpmVersion) {
      violations.push('artifact manifest npm version does not match the pinned npm');
    }
  }

  const { evidence } = expected;
  const archive = manifest['archive'];
  const expectedArchive = {
    filename: evidence.filename,
    size: evidence.size,
    unpackedSize: evidence.unpackedSize,
    sha1: evidence.sha1,
    sha256: evidence.sha256,
    integrity: evidence.integrity,
  };
  if (!isRecord(archive) || canonical(archive) !== canonical(expectedArchive)) {
    violations.push('artifact manifest archive digests/metadata do not match the exact tgz');
  }
  const expectedFiles = [...evidence.files].sort(comparePaths);
  if (
    !Array.isArray(manifest['files']) ||
    canonical(manifest['files']) !== canonical(expectedFiles)
  ) {
    violations.push('artifact manifest file inventory does not match the exact tgz');
  }
  return violations;
}

export function serializePackageArtifactManifest(manifest: PackageArtifactManifest): string {
  return `${JSON.stringify(manifest, undefined, 2)}\n`;
}

function argumentValue(arguments_: readonly string[], index: number, option: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

/** Parse check-package modes before any archive is created or consumed. */
export function parsePackageArtifactArguments(
  arguments_: readonly string[],
): PackageArtifactArguments {
  let artifactDirectory: string | undefined;
  let tarball: string | undefined;
  let manifest: string | undefined;
  let sourceCommit: string | undefined;
  let updateApiReports = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--update-api-reports') updateApiReports = true;
    else if (argument === '--artifact-dir') {
      artifactDirectory = argumentValue(arguments_, index, argument);
      index += 1;
    } else if (argument === '--tarball') {
      tarball = argumentValue(arguments_, index, argument);
      index += 1;
    } else if (argument === '--manifest') {
      manifest = argumentValue(arguments_, index, argument);
      index += 1;
    } else if (argument === '--source-commit') {
      sourceCommit = argumentValue(arguments_, index, argument);
      index += 1;
    } else {
      throw new Error(`unknown package-check argument: ${String(argument)}`);
    }
  }

  if (artifactDirectory !== undefined && tarball !== undefined) {
    throw new Error('--artifact-dir and --tarball are mutually exclusive');
  }
  if (manifest !== undefined && tarball === undefined) {
    throw new Error('--manifest is only valid together with --tarball');
  }
  if (tarball !== undefined && manifest === undefined) {
    manifest = join(dirname(tarball), PACKAGE_ARTIFACT_MANIFEST);
  }
  return { artifactDirectory, tarball, manifest, sourceCommit, updateApiReports };
}
