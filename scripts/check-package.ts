/**
 * Smoke-test the exact archive npm would publish.
 *
 * The gate runs after `npm run build` against isolated consumers outside the
 * repository tree, so an entry that only works from maintainer `node_modules`
 * fails here. Peer-free entries are tested without optional peers; codegen and
 * its types use a separate consumer that installs the reviewed ts-morph peer.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  checkApiReports,
  checkDualDeclarationParity,
  collectTypedApiEntries,
  type TypedApiEntry,
} from './api-contracts';
import { parsePackageArtifactArguments } from './package-artifact';
import {
  finalizePackageArtifact,
  findStaticArchiveFailures,
  inspectPackedManifest,
  resolvePackageArchive,
} from './package-smoke-archive';
import {
  bootstrapDeclaredPeersStrictly,
  initializeConsumer,
  installStrictly,
  probeLocalDependency,
  probeUnavailableDependencies,
} from './package-smoke-consumer';
import { checkPackedImportSmokes } from './package-smoke-imports';
import {
  CODEGEN_EXPORT_NAMES,
  findPackedContentFailures,
  findPackedTargetFailures,
} from './package-smoke-manifest';
import {
  readReviewedTsMorphVersion,
  verifyRepositoryPreconditions,
} from './package-smoke-repository';
import {
  API_EXTRACTOR_CONFIG,
  API_REPORT_FOLDER,
  detailFor,
  isRecord,
  ROOT,
} from './package-smoke-support';
import { checkPackedTypeContracts } from './package-smoke-types';
import { findForbiddenPackageLifecycleScripts } from './release-contracts';

async function main(): Promise<void> {
  const options = parsePackageArtifactArguments(process.argv.slice(2));
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'payload-live-preview-package-smoke-'));
  const failures: string[] = [];

  try {
    const { identity, failures: repositoryFailures } = await verifyRepositoryPreconditions(
      temporaryRoot,
      options.sourceCommit,
    );
    failures.push(...repositoryFailures);

    const { evidence, tarball, suppliedManifest } = await resolvePackageArchive(
      options,
      temporaryRoot,
      identity,
    );
    const packedFiles = new Set(evidence.files.map((file) => file.path));
    failures.push(...(await findPackedContentFailures(packedFiles)));

    const inspectedManifest = await inspectPackedManifest(temporaryRoot, tarball);
    const typedApiEntries = collectTypedApiEntries(inspectedManifest);
    failures.push(...findStaticArchiveFailures(tarball, typedApiEntries));

    const consumer = resolve(temporaryRoot, 'runtime-consumer');
    await initializeConsumer(consumer);
    const install = installStrictly(consumer, [tarball]);
    if (install.status !== 0) {
      throw new Error(`installing the packed archive failed:\n${detailFor(install)}`);
    }
    const resolutionProbe = probeUnavailableDependencies(consumer, [
      'astro',
      'ts-morph',
      'tsx',
      'typescript',
    ]);
    if (resolutionProbe.status !== 0) {
      throw new Error(
        `peer-free consumer inherited a maintainer dependency:\n${detailFor(resolutionProbe)}`,
      );
    }

    const packageRoot = resolve(consumer, 'node_modules/payload-live-preview');
    const manifestValue: unknown = JSON.parse(
      await readFile(resolve(packageRoot, 'package.json'), 'utf8'),
    );
    if (!isRecord(manifestValue) || typeof manifestValue['name'] !== 'string') {
      throw new Error('packed package.json is malformed');
    }
    for (const path of findForbiddenPackageLifecycleScripts(manifestValue)) {
      failures.push(`packed manifest exposes forbidden consumer lifecycle hook: ${path}`);
    }
    const packageName = manifestValue['name'];
    const peerDependencies = manifestValue['peerDependencies'];
    if (!isRecord(peerDependencies) || typeof peerDependencies['ts-morph'] !== 'string') {
      throw new Error('packed manifest does not declare the ts-morph codegen peer');
    }
    const lockedTsMorphVersion = await readReviewedTsMorphVersion();

    const codegenConsumer = resolve(temporaryRoot, 'codegen-consumer');
    await initializeConsumer(codegenConsumer, { 'ts-morph': lockedTsMorphVersion });
    const codegenPeerInstall = bootstrapDeclaredPeersStrictly(codegenConsumer);
    if (codegenPeerInstall.status !== 0) {
      throw new Error(
        `installing the exact reviewed codegen peer failed:\n${detailFor(codegenPeerInstall)}`,
      );
    }
    const codegenInstall = installStrictly(codegenConsumer, [tarball]);
    if (codegenInstall.status !== 0) {
      throw new Error(
        `installing the packed archive with its declared codegen peer failed:\n${detailFor(codegenInstall)}`,
      );
    }
    const codegenPeerProbe = probeLocalDependency(codegenConsumer, 'ts-morph');
    if (codegenPeerProbe.status !== 0) {
      throw new Error(
        `codegen peer did not resolve from the isolated consumer:\n${detailFor(codegenPeerProbe)}`,
      );
    }
    const codegenLeakProbe = probeUnavailableDependencies(codegenConsumer, [
      'astro',
      'tsx',
      'typescript',
    ]);
    if (codegenLeakProbe.status !== 0) {
      throw new Error(
        `codegen consumer inherited a maintainer dependency:\n${detailFor(codegenLeakProbe)}`,
      );
    }
    const codegenPackageRoot = resolve(codegenConsumer, 'node_modules/payload-live-preview');
    const packageRootForEntry = (entry: TypedApiEntry): string =>
      CODEGEN_EXPORT_NAMES.has(entry.exportName) ? codegenPackageRoot : packageRoot;

    const apiReportFailures = await checkApiReports({
      apiConfigPath: API_EXTRACTOR_CONFIG,
      entries: typedApiEntries,
      packageRootForEntry,
      reportFolder: API_REPORT_FOLDER,
      reportTempFolder: resolve(temporaryRoot, 'api-extractor-temp'),
      typescriptCompilerFolder: resolve(ROOT, 'node_modules/typescript'),
      updateReports: options.updateApiReports,
    });
    for (const failure of apiReportFailures) {
      failures.push(`API Extractor: ${failure}`);
    }
    const declarationParityFailures = await checkDualDeclarationParity(
      typedApiEntries,
      packageRootForEntry,
    );
    for (const failure of declarationParityFailures) {
      failures.push(`declaration parity: ${failure}`);
    }

    failures.push(...(await findPackedTargetFailures(manifestValue, packageRoot, packedFiles)));
    failures.push(
      ...(await checkPackedImportSmokes({
        consumer,
        codegenConsumer,
        codegenPackageRoot,
        packageName,
        manifestValue,
      })),
    );
    failures.push(
      ...(await checkPackedTypeContracts({
        runtime: consumer,
        codegen: codegenConsumer,
        packageName,
      })),
    );

    if (failures.length > 0) {
      for (const failure of failures) console.error(`FAIL ${failure}`);
      throw new Error(`packed-package gate failed with ${String(failures.length)} violation(s)`);
    }

    console.log(
      `[package] PASS ${String(evidence.files.length)} packed files; publint, ATTW, ${String(typedApiEntries.length)} API reports, isolated script-free strict installs, peer-free and explicit-peer ESM/CJS, CLI, and positive/negative strict NodeNext types verified`,
    );

    await finalizePackageArtifact({
      artifactDirectory: options.artifactDirectory,
      evidence,
      identity,
      suppliedManifest,
      tarball,
      temporaryRoot,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
