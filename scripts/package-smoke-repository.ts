/**
 * Preconditions the repository must satisfy before an archive is produced or
 * trusted: a well-formed publisher manifest, the exact pinned npm, a source
 * commit that matches the checked-out tree, and reviewed install policies.
 * Anything that would make the measurement meaningless throws; policy
 * violations accumulate so one run reports them all.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { detailFor, isRecord, PACKAGE_LOCK, ROOT, run } from './package-smoke-support';
import {
  findExactPublisherManifestViolations,
  findMaintainerInstallPolicyViolations,
  findPackageLockMetadataViolations,
  findPackageSmokeIsolationViolations,
  LOCAL_FILE_PACKAGE_FIXTURES,
  MAINTAINER_INSTALL_POLICIES,
} from './release-contracts';
import { findWorkflowContractViolations, readWorkflowSources } from './workflow-contracts';

export interface PackageIdentity {
  readonly expectedName: string;
  readonly expectedVersion: string;
  readonly npmVersion: string;
  readonly sourceCommit: string;
}

export interface RepositoryPreconditions {
  readonly identity: PackageIdentity;
  readonly failures: readonly string[];
}

export async function verifyRepositoryPreconditions(
  temporaryRoot: string,
  requestedSourceCommit: string | undefined,
): Promise<RepositoryPreconditions> {
  const isolationViolations = findPackageSmokeIsolationViolations(ROOT, temporaryRoot);
  if (isolationViolations.length > 0) {
    throw new Error(isolationViolations.join('; '));
  }

  const failures: string[] = [];
  const rootManifestSource = await readFile(resolve(ROOT, 'package.json'), 'utf8');
  const rootManifest: unknown = JSON.parse(rootManifestSource);
  if (!isRecord(rootManifest)) throw new Error('repository package.json is malformed');
  const expectedName = rootManifest['name'];
  const expectedVersion = rootManifest['version'];
  const packageManager = rootManifest['packageManager'];
  if (
    typeof expectedName !== 'string' ||
    typeof expectedVersion !== 'string' ||
    typeof packageManager !== 'string' ||
    !packageManager.startsWith('npm@')
  ) {
    throw new Error('repository package identity/toolchain is malformed');
  }
  const expectedNpmVersion = packageManager.slice('npm@'.length);
  for (const violation of findExactPublisherManifestViolations(rootManifest)) {
    failures.push(`release manifest: ${violation}`);
  }
  const npmVersionResult = run('npm', ['--version'], ROOT);
  if (npmVersionResult.status !== 0) {
    throw new Error(`reading npm version failed:\n${detailFor(npmVersionResult)}`);
  }
  const npmVersion = npmVersionResult.stdout.trim();
  if (npmVersion !== expectedNpmVersion) {
    throw new Error(`package gate requires npm ${expectedNpmVersion}; received ${npmVersion}`);
  }
  const headResult = run('git', ['rev-parse', 'HEAD'], ROOT);
  if (headResult.status !== 0) {
    throw new Error(`reading source commit failed:\n${detailFor(headResult)}`);
  }
  const headCommit = headResult.stdout.trim();
  const sourceCommit = requestedSourceCommit ?? headCommit;
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit) || sourceCommit !== headCommit) {
    throw new Error('--source-commit must be the exact checked-out 40-character Git commit');
  }
  for (const violation of findWorkflowContractViolations(await readWorkflowSources(ROOT))) {
    failures.push(`release contract: ${violation}`);
  }

  const installPolicyInputs = await Promise.all(
    MAINTAINER_INSTALL_POLICIES.map(async (policy) => {
      const directory = resolve(ROOT, policy.directory);
      const [npmrc, manifestSource, lockfileSource] = await Promise.all([
        readFile(resolve(directory, '.npmrc'), 'utf8'),
        readFile(resolve(directory, 'package.json'), 'utf8'),
        readFile(resolve(directory, 'package-lock.json'), 'utf8'),
      ]);
      return {
        policy,
        input: {
          label: policy.label,
          npmrc,
          manifest: JSON.parse(manifestSource) as unknown,
          lockfile: JSON.parse(lockfileSource) as unknown,
        },
      };
    }),
  );
  for (const { input, policy } of installPolicyInputs) {
    for (const violation of findMaintainerInstallPolicyViolations(input, policy)) {
      failures.push(`install policy: ${violation}`);
    }
  }

  const rootLockMetadata = installPolicyInputs.find(
    ({ policy }) => policy.directory === '.',
  )?.input;
  if (rootLockMetadata === undefined) {
    throw new Error('root lock metadata is absent from the maintainer policy inventory');
  }
  const fixtureLockMetadata = LOCAL_FILE_PACKAGE_FIXTURES.map(({ label, directory }) => {
    const match = installPolicyInputs.find(({ policy }) => policy.directory === directory)?.input;
    if (match === undefined) {
      throw new Error(`${label} lock metadata is absent from the maintainer policy inventory`);
    }
    return match;
  });
  for (const violation of findPackageLockMetadataViolations({
    root: rootLockMetadata,
    fixtures: fixtureLockMetadata,
  })) {
    failures.push(`lock metadata: ${violation}`);
  }

  return {
    identity: { expectedName, expectedVersion, npmVersion, sourceCommit },
    failures,
  };
}

/**
 * The codegen consumer installs the peer version the maintainer lockfile pins,
 * so the smoke exercises the exact tree that was reviewed rather than whatever
 * the registry currently resolves.
 */
export async function readReviewedTsMorphVersion(): Promise<string> {
  const lockfileValue: unknown = JSON.parse(await readFile(PACKAGE_LOCK, 'utf8'));
  const lockfilePackages = isRecord(lockfileValue) ? lockfileValue['packages'] : undefined;
  const lockedTsMorph = isRecord(lockfilePackages)
    ? lockfilePackages['node_modules/ts-morph']
    : undefined;
  if (!isRecord(lockedTsMorph) || typeof lockedTsMorph['version'] !== 'string') {
    throw new Error('maintainer lockfile does not pin the reviewed ts-morph peer');
  }
  const lockedTsMorphVersion = lockedTsMorph['version'];
  const installedTsMorphManifest: unknown = JSON.parse(
    await readFile(resolve(ROOT, 'node_modules/ts-morph/package.json'), 'utf8'),
  );
  if (
    !isRecord(installedTsMorphManifest) ||
    installedTsMorphManifest['name'] !== 'ts-morph' ||
    installedTsMorphManifest['version'] !== lockedTsMorphVersion
  ) {
    throw new Error('maintainer install does not match the locked ts-morph peer');
  }
  return lockedTsMorphVersion;
}
