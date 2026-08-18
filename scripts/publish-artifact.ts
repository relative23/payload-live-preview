/** Publish and reconcile only the package archive certified by the CI manifest. */

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPackageArchiveEvidence,
  findPackageArtifactManifestViolations,
  inspectPackageArchive,
  isSafePackageArchiveFilename,
  PACKAGE_ARTIFACT_MANIFEST,
  parseNpmPackReport,
  type PackageArtifactManifest,
} from './package-artifact';
import { sanitizeNpmScriptEnvironment } from './release-contracts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NPM_REGISTRY = 'https://registry.npmjs.org';
const STABLE_SEMVER_PATTERN = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

export type RegistryArtifactState =
  { readonly kind: 'missing' } | { readonly kind: 'published'; readonly integrity: string };

/**
 * How long the registry may take to serve what it has already accepted.
 *
 * npm acknowledges a publish before the new version is readable, and the delay
 * is neither announced nor bounded by the API. Every read after the publish is
 * therefore expected to fail for a while and to succeed afterwards — the one
 * situation where retrying is correct rather than papering over a fault.
 */
export interface RegistryPropagationPolicy {
  /** Total budget for one read to become consistent. */
  readonly timeoutMs: number;
  /** Delay between attempts. */
  readonly intervalMs: number;
}

export const REGISTRY_PROPAGATION_POLICY: RegistryPropagationPolicy = {
  timeoutMs: 180_000,
  intervalMs: 5_000,
};

/** Injectable clock so the wait is testable without real time passing. */
export interface PropagationClock {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export const systemPropagationClock: PropagationClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

export interface PropagationOutcome<T> {
  /** `false` when the budget ran out; the caller owns the error message. */
  readonly ready: boolean;
  /** Result of the last attempt, ready or not. */
  readonly value: T;
  readonly attempts: number;
  readonly waitedMs: number;
}

/**
 * Repeat a registry read until it is consistent or the budget is spent.
 *
 * The first attempt is never delayed, so a registry that is already consistent
 * costs nothing. Failure is still closed: this returns the last value with
 * `ready: false` rather than deciding what that means.
 */
export async function awaitRegistryPropagation<T>(
  read: () => T | Promise<T>,
  isReady: (value: T) => boolean,
  policy: RegistryPropagationPolicy = REGISTRY_PROPAGATION_POLICY,
  clock: PropagationClock = systemPropagationClock,
): Promise<PropagationOutcome<T>> {
  const started = clock.now();
  let attempts = 0;
  let value = await read();
  attempts += 1;

  while (!isReady(value)) {
    const waited = clock.now() - started;
    // Stop before sleeping past the budget rather than after.
    if (waited + policy.intervalMs > policy.timeoutMs) {
      return { ready: false, value, attempts, waitedMs: waited };
    }
    await clock.sleep(policy.intervalMs);
    value = await read();
    attempts += 1;
  }
  return { ready: true, value, attempts, waitedMs: clock.now() - started };
}

/**
 * Whether a failed registry command is the known read-after-write delay rather
 * than a real fault. Anything else must fail immediately.
 */
export function isRegistryPropagationDelay(output: string): boolean {
  return /\bETARGET\b|\bE404\b|\bnotarget\b|No matching version found/u.test(output);
}

export interface CertifiedPublishOperations {
  readonly readRegistryState: () => RegistryArtifactState | Promise<RegistryArtifactState>;
  readonly publishExactArchive: () => void | Promise<void>;
  readonly verifyRegistryArchive: () => void | Promise<void>;
  readonly ensureReleaseTag: () => void | Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function run(executable: string, args: readonly string[], cwd = ROOT): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: sanitizeNpmScriptEnvironment(process.env),
  });
  if (result.error !== undefined) throw result.error;
  return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? 1 };
}

function detail(result: CommandResult): string {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return output.length > 2_000 ? output.slice(-2_000) : output;
}

export function exactPublishArguments(tarball: string): readonly string[] {
  return [
    'publish',
    tarball,
    '--ignore-scripts',
    '--provenance',
    '--access',
    'public',
    '--tag',
    'latest',
    '--registry',
    NPM_REGISTRY,
    '--json',
  ];
}

export function registryArtifactAction(
  state: RegistryArtifactState,
  expectedIntegrity: string,
): 'publish' | 'reconcile' {
  if (state.kind === 'missing') return 'publish';
  if (state.integrity !== expectedIntegrity) {
    throw new Error(
      `npm already contains this version as a different archive (${state.integrity}); refusing release reconciliation`,
    );
  }
  return 'reconcile';
}

/** Enforce publish/reconcile ordering: registry proof always precedes release state. */
export async function publishCertifiedArtifact(
  expectedIntegrity: string,
  operations: CertifiedPublishOperations,
): Promise<'published' | 'reconciled'> {
  const action = registryArtifactAction(await operations.readRegistryState(), expectedIntegrity);
  if (action === 'publish') await operations.publishExactArchive();
  await operations.verifyRegistryArchive();
  await operations.ensureReleaseTag();
  return action === 'publish' ? 'published' : 'reconciled';
}

export function releaseTagForVersion(version: string): string {
  if (version.includes('-')) {
    throw new Error('prerelease publishing requires an explicit non-latest npm dist-tag policy');
  }
  if (!STABLE_SEMVER_PATTERN.test(version)) throw new Error(`invalid package version: ${version}`);
  return `v${version}`;
}

function readRegistryState(name: string, version: string): RegistryArtifactState {
  const result = run('npm', [
    'view',
    `${name}@${version}`,
    'dist.integrity',
    '--json',
    '--prefer-online',
    '--registry',
    NPM_REGISTRY,
  ]);
  if (result.status === 0) {
    let integrity: unknown;
    try {
      integrity = JSON.parse(result.stdout);
    } catch (error: unknown) {
      throw new Error(`npm returned malformed registry integrity: ${String(error)}`, {
        cause: error,
      });
    }
    if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
      throw new Error('npm registry returned no SHA-512 integrity for the package version');
    }
    return { kind: 'published', integrity };
  }
  if (/\bE404\b/u.test(`${result.stdout}\n${result.stderr}`)) return { kind: 'missing' };
  throw new Error(`npm registry lookup failed closed:\n${detail(result)}`);
}

async function verifyRegistryArchive(
  manifest: PackageArtifactManifest,
  expected: {
    readonly name: string;
    readonly version: string;
    readonly sourceCommit: string;
    readonly sourceDateEpoch: string;
    readonly nodeVersion: string;
    readonly npmVersion: string;
  },
): Promise<void> {
  const visible = await awaitRegistryPropagation(
    () => readRegistryState(expected.name, expected.version),
    (candidate) => candidate.kind === 'published',
  );
  if (visible.value.kind !== 'published') {
    throw new Error(
      'npm publish returned success but the exact package version is not observable ' +
        `after ${String(visible.attempts)} attempts over ${String(Math.round(visible.waitedMs / 1000))}s`,
    );
  }
  registryArtifactAction(visible.value, manifest.archive.integrity);

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'payload-live-preview-registry-proof-'));
  try {
    // Metadata can be readable while the tarball still is not, so this read
    // gets its own budget instead of trusting the visibility check above.
    const download = await awaitRegistryPropagation(
      () =>
        run('npm', [
          'pack',
          `${expected.name}@${expected.version}`,
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          temporaryRoot,
          '--prefer-online',
          '--registry',
          NPM_REGISTRY,
        ]),
      (result) => result.status === 0 || !isRegistryPropagationDelay(detail(result)),
    );
    const packed = download.value;
    if (packed.status !== 0) {
      const waited = isRegistryPropagationDelay(detail(packed))
        ? ` after ${String(download.attempts)} attempts over ${String(Math.round(download.waitedMs / 1000))}s`
        : '';
      throw new Error(`downloading the published npm archive failed${waited}:\n${detail(packed)}`);
    }
    const report = parseNpmPackReport(packed.stdout);
    const registryTarball = resolve(temporaryRoot, report.filename);
    const evidence = await createPackageArchiveEvidence(registryTarball, report);
    const violations = findPackageArtifactManifestViolations(manifest, {
      evidence,
      expectedName: expected.name,
      expectedVersion: expected.version,
      expectedSourceCommit: expected.sourceCommit,
      expectedSourceDateEpoch: expected.sourceDateEpoch,
      expectedNodeVersion: expected.nodeVersion,
      expectedNpmVersion: expected.npmVersion,
    });
    if (violations.length > 0) {
      throw new Error(
        `registry archive differs from the CI-certified artifact:\n- ${violations.join('\n- ')}`,
      );
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function exactHeadCommit(expectedCommit: string): void {
  const head = run('git', ['rev-parse', 'HEAD']);
  if (head.status !== 0 || head.stdout.trim() !== expectedCommit) {
    throw new Error(`release checkout is not the manifest source commit:\n${detail(head)}`);
  }
}

function ensureChangesetsTag(version: string, expectedCommit: string): void {
  const tag = releaseTagForVersion(version);
  const existing = run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  if (existing.status === 0) {
    if (existing.stdout.trim() !== expectedCommit) {
      throw new Error(`${tag} already points to a different commit`);
    }
    // changesets/action v1 recognizes this stable Changesets output contract,
    // then pushes the tag and creates/reconciles the GitHub Release.
    console.log(`New tag: ${tag}`);
    return;
  }

  const changeset = run(
    process.platform === 'win32'
      ? resolve(ROOT, 'node_modules/.bin/changeset.cmd')
      : resolve(ROOT, 'node_modules/.bin/changeset'),
    ['tag'],
  );
  if (changeset.status !== 0) {
    throw new Error(`Changesets could not create the release tag:\n${detail(changeset)}`);
  }
  if (changeset.stdout.trim().length > 0) console.log(changeset.stdout.trim());
  const created = run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  if (created.status !== 0 || created.stdout.trim() !== expectedCommit) {
    throw new Error(`Changesets did not create ${tag} at the certified commit`);
  }
  if (!changeset.stdout.includes('New tag:')) console.log(`New tag: ${tag}`);
}

async function main(): Promise<void> {
  const artifactDirectory = resolve(
    ROOT,
    process.env['PACKAGE_ARTIFACT_DIR'] ?? 'release-artifact',
  );
  const manifestPath = resolve(artifactDirectory, PACKAGE_ARTIFACT_MANIFEST);
  const manifestValue: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!isRecord(manifestValue) || !isRecord(manifestValue['archive'])) {
    throw new Error('package artifact manifest is malformed');
  }
  const archiveFilename = manifestValue['archive']['filename'];
  if (typeof archiveFilename !== 'string' || !isSafePackageArchiveFilename(archiveFilename)) {
    throw new Error('package artifact manifest contains an unsafe archive filename');
  }
  const manifest = manifestValue as unknown as PackageArtifactManifest;
  const tarball = resolve(artifactDirectory, archiveFilename);

  const rootManifestValue: unknown = JSON.parse(
    await readFile(resolve(ROOT, 'package.json'), 'utf8'),
  );
  if (!isRecord(rootManifestValue)) throw new Error('repository package.json is malformed');
  const name = rootManifestValue['name'];
  const version = rootManifestValue['version'];
  const packageManager = rootManifestValue['packageManager'];
  if (
    typeof name !== 'string' ||
    typeof version !== 'string' ||
    typeof packageManager !== 'string' ||
    !packageManager.startsWith('npm@')
  ) {
    throw new Error('repository package identity/toolchain is malformed');
  }
  const npmVersion = packageManager.slice('npm@'.length);
  // npm publish defaults to `latest`. Prereleases stay fail-closed until this
  // release path has an explicit, reviewed non-latest dist-tag policy.
  releaseTagForVersion(version);
  const actualNpm = run('npm', ['--version']);
  if (actualNpm.status !== 0 || actualNpm.stdout.trim() !== npmVersion) {
    throw new Error(`release requires npm ${npmVersion}:\n${detail(actualNpm)}`);
  }
  const sourceCommit = process.env['PACKAGE_SOURCE_COMMIT'];
  const sourceDateEpoch = process.env['SOURCE_DATE_EPOCH'];
  if (sourceCommit === undefined || sourceDateEpoch === undefined) {
    throw new Error('PACKAGE_SOURCE_COMMIT and SOURCE_DATE_EPOCH are required for release');
  }
  exactHeadCommit(sourceCommit);

  const evidence = await inspectPackageArchive(
    tarball,
    ROOT,
    sanitizeNpmScriptEnvironment(process.env),
  );
  const localViolations = findPackageArtifactManifestViolations(manifest, {
    evidence,
    expectedName: name,
    expectedVersion: version,
    expectedSourceCommit: sourceCommit,
    expectedSourceDateEpoch: sourceDateEpoch,
    expectedNodeVersion: process.version,
    expectedNpmVersion: npmVersion,
  });
  if (localViolations.length > 0) {
    throw new Error(
      `local release artifact failed verification:\n- ${localViolations.join('\n- ')}`,
    );
  }

  const outcome = await publishCertifiedArtifact(evidence.integrity, {
    readRegistryState: () => readRegistryState(name, version),
    publishExactArchive: () => {
      const published = run('npm', exactPublishArguments(tarball));
      if (published.status !== 0) {
        throw new Error(`publishing the exact CI archive failed:\n${detail(published)}`);
      }
      if (published.stdout.trim().length > 0) console.log(published.stdout.trim());
    },
    // No Git/GitHub release state is mutated until npm serves the exact bytes.
    verifyRegistryArchive: async () =>
      verifyRegistryArchive(manifest, {
        name,
        version,
        sourceCommit,
        sourceDateEpoch,
        nodeVersion: process.version,
        npmVersion,
      }),
    ensureReleaseTag: () => ensureChangesetsTag(version, sourceCommit),
  });
  if (outcome === 'reconciled') {
    console.log(`[release] npm already had ${name}@${version} with the certified integrity`);
  }
  console.log(`[release] npm registry archive exactly matches ${evidence.sha256}`);
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
