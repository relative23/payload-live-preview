/**
 * Obtain and vet the exact archive npm would publish. A supplied tarball is
 * verified against its recorded manifest instead of being repacked, so a
 * release candidate is measured as the same bytes CI produced; otherwise the
 * repository is packed without lifecycle hooks so the artifact under test
 * cannot rebuild itself while it is measured.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { buildAttwInvocations, type TypedApiEntry } from './api-contracts';
import {
  createPackageArchiveEvidence,
  createPackageArtifactManifest,
  findPackageArtifactManifestViolations,
  inspectPackageArchive,
  PACKAGE_ARTIFACT_MANIFEST,
  parseNpmPackReport,
  serializePackageArtifactManifest,
  type PackageArchiveEvidence,
  type PackageArtifactManifest,
} from './package-artifact';
import { initializeConsumer } from './package-smoke-consumer';
import {
  detailFor,
  exists,
  localBinary,
  ROOT,
  run,
  type CommandResult,
} from './package-smoke-support';
import { type PackageIdentity } from './package-smoke-repository';
import {
  findForbiddenPackageLifecycleScripts,
  sanitizeNpmScriptEnvironment,
} from './release-contracts';

export interface ResolvedPackageArchive {
  readonly evidence: PackageArchiveEvidence;
  readonly tarball: string;
  readonly suppliedManifest: PackageArtifactManifest | undefined;
}

interface ArchiveRequest {
  readonly tarball: string | undefined;
  readonly manifest: string | undefined;
  readonly artifactDirectory: string | undefined;
}

function manifestExpectations(
  identity: PackageIdentity,
  evidence: PackageArchiveEvidence,
): Parameters<typeof findPackageArtifactManifestViolations>[1] {
  return {
    evidence,
    expectedName: identity.expectedName,
    expectedVersion: identity.expectedVersion,
    expectedSourceCommit: identity.sourceCommit,
    expectedSourceDateEpoch: process.env['SOURCE_DATE_EPOCH'],
    expectedNodeVersion: process.version,
    expectedNpmVersion: identity.npmVersion,
  };
}

export async function resolvePackageArchive(
  request: ArchiveRequest,
  temporaryRoot: string,
  identity: PackageIdentity,
): Promise<ResolvedPackageArchive> {
  let evidence: PackageArchiveEvidence;
  let tarball: string;
  let suppliedManifest: PackageArtifactManifest | undefined;

  if (request.tarball !== undefined) {
    tarball = resolve(ROOT, request.tarball);
    if (!(await exists(tarball))) throw new Error(`package archive does not exist: ${tarball}`);
    evidence = await inspectPackageArchive(
      tarball,
      temporaryRoot,
      sanitizeNpmScriptEnvironment(process.env),
    );
    if (basename(tarball) !== evidence.filename) {
      throw new Error(
        `package archive filename ${basename(tarball)} does not match ${evidence.filename}`,
      );
    }
    const manifestPath = resolve(ROOT, request.manifest ?? PACKAGE_ARTIFACT_MANIFEST);
    const manifestValue: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    const manifestViolations = findPackageArtifactManifestViolations(
      manifestValue,
      manifestExpectations(identity, evidence),
    );
    if (manifestViolations.length > 0) {
      throw new Error(`package artifact manifest failed:\n- ${manifestViolations.join('\n- ')}`);
    }
    suppliedManifest = manifestValue as PackageArtifactManifest;
  } else {
    const packDestination =
      request.artifactDirectory === undefined
        ? temporaryRoot
        : resolve(ROOT, request.artifactDirectory);
    await mkdir(packDestination, { recursive: true });
    const pack = run(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', packDestination],
      ROOT,
      sanitizeNpmScriptEnvironment(process.env),
    );
    if (pack.status !== 0) {
      throw new Error(`npm pack failed:\n${detailFor(pack)}`);
    }
    const report = parseNpmPackReport(pack.stdout);
    tarball = resolve(packDestination, report.filename);
    if (!(await exists(tarball))) throw new Error(`npm pack did not create ${tarball}`);
    evidence = await createPackageArchiveEvidence(tarball, report);
  }

  if (evidence.name !== identity.expectedName || evidence.version !== identity.expectedVersion) {
    throw new Error(
      `package archive identity ${evidence.name}@${evidence.version} does not match ${identity.expectedName}@${identity.expectedVersion}`,
    );
  }
  return { evidence, tarball, suppliedManifest };
}

/**
 * A quarantine install with scripts disabled makes every forbidden hook in the
 * packed manifest observable without granting it a chance to execute; the
 * consumer smoke installs the same archive normally afterwards.
 */
export async function inspectPackedManifest(
  temporaryRoot: string,
  tarball: string,
): Promise<unknown> {
  const manifestInspector = resolve(temporaryRoot, 'manifest-inspector');
  await initializeConsumer(manifestInspector);
  const inspectionInstall = run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--omit=optional',
      '--offline',
      '--legacy-peer-deps',
      '--no-save',
      tarball,
    ],
    manifestInspector,
    sanitizeNpmScriptEnvironment(process.env),
  );
  if (inspectionInstall.status !== 0) {
    throw new Error(`inspecting the packed archive failed:\n${detailFor(inspectionInstall)}`);
  }
  const inspectedManifest: unknown = JSON.parse(
    await readFile(
      resolve(manifestInspector, 'node_modules/payload-live-preview/package.json'),
      'utf8',
    ),
  );
  const forbiddenLifecycleScripts = findForbiddenPackageLifecycleScripts(inspectedManifest);
  if (forbiddenLifecycleScripts.length > 0) {
    throw new Error(
      `packed manifest exposes forbidden consumer lifecycle hook(s): ${forbiddenLifecycleScripts.join(', ')}`,
    );
  }
  return inspectedManifest;
}

export function findStaticArchiveFailures(
  tarball: string,
  typedApiEntries: readonly TypedApiEntry[],
): readonly string[] {
  const failures: string[] = [];
  const publint: CommandResult = run(localBinary('publint'), ['run', tarball, '--strict'], ROOT);
  if (publint.status !== 0) {
    failures.push(`publint rejected the exact tarball:\n${detailFor(publint)}`);
  }
  for (const invocation of buildAttwInvocations(tarball, typedApiEntries)) {
    const attw = run(localBinary('attw'), invocation.args, ROOT);
    if (attw.status !== 0) {
      failures.push(
        `Are The Types Wrong (${invocation.label}) rejected the exact tarball:\n${detailFor(attw)}`,
      );
    }
  }
  return failures;
}

/**
 * Re-inspecting the archive after the smoke proves nothing rewrote it while the
 * consumers were installing from it.
 */
export async function finalizePackageArtifact(inputs: {
  readonly artifactDirectory: string | undefined;
  readonly evidence: PackageArchiveEvidence;
  readonly identity: PackageIdentity;
  readonly suppliedManifest: PackageArtifactManifest | undefined;
  readonly tarball: string;
  readonly temporaryRoot: string;
}): Promise<void> {
  if (inputs.artifactDirectory !== undefined) {
    const artifactDirectory = resolve(ROOT, inputs.artifactDirectory);
    const manifest = createPackageArtifactManifest({
      evidence: inputs.evidence,
      sourceCommit: inputs.identity.sourceCommit,
      sourceDateEpoch: process.env['SOURCE_DATE_EPOCH'],
      nodeVersion: process.version,
      npmVersion: inputs.identity.npmVersion,
    });
    await writeFile(
      resolve(artifactDirectory, PACKAGE_ARTIFACT_MANIFEST),
      serializePackageArtifactManifest(manifest),
      'utf8',
    );
    console.log(
      `[package] persisted verified archive ${relative(ROOT, inputs.tarball)} and ${relative(ROOT, resolve(artifactDirectory, PACKAGE_ARTIFACT_MANIFEST))}`,
    );
    return;
  }
  if (inputs.suppliedManifest === undefined) return;

  const finalEvidence = await inspectPackageArchive(
    inputs.tarball,
    inputs.temporaryRoot,
    sanitizeNpmScriptEnvironment(process.env),
  );
  const finalViolations = findPackageArtifactManifestViolations(
    inputs.suppliedManifest,
    manifestExpectations(inputs.identity, finalEvidence),
  );
  if (finalViolations.length > 0) {
    throw new Error(
      `package artifact changed during verification:\n- ${finalViolations.join('\n- ')}`,
    );
  }
  console.log(`[package] rechecked the supplied archive without repacking the repository`);
}
