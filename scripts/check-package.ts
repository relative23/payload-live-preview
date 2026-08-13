/**
 * Smoke-test the exact archive npm would publish.
 *
 * This intentionally runs after `npm run build` and packs without invoking any
 * maintainer lifecycle hooks, so the artifact under test cannot be rebuilt while
 * it is measured. The exact archive is then installed with npm's strict script
 * policy enabled and no script bypass. Its installed manifest is checked
 * explicitly as a second guard, independent of npm's strict-policy diagnostic,
 * against consumer install hooks. The temporary consumers live in the
 * operating system's temporary directory, outside the repository tree, so Node
 * cannot satisfy undeclared imports from maintainer `node_modules`. Peer-free
 * entries are tested without optional peers; codegen and its types use a separate
 * consumer that explicitly installs the reviewed ts-morph peer.
 */
import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAttwInvocations,
  checkApiReports,
  checkDualDeclarationParity,
  collectTypedApiEntries,
  type TypedApiEntry,
} from './api-contracts';
import {
  createPackageArchiveEvidence,
  createPackageArtifactManifest,
  findPackageArtifactManifestViolations,
  inspectPackageArchive,
  PACKAGE_ARTIFACT_MANIFEST,
  parseNpmPackReport,
  parsePackageArtifactArguments,
  serializePackageArtifactManifest,
  type PackageArchiveEvidence,
  type PackageArtifactManifest,
} from './package-artifact';
import {
  findForbiddenPackageLifecycleScripts,
  findExactPublisherManifestViolations,
  findMaintainerInstallPolicyViolations,
  findPackageSmokeIsolationViolations,
  findReleaseWorkflowViolations,
  MAINTAINER_INSTALL_POLICIES,
  PACKAGE_SMOKE_INSTALL_ARGS,
  PACKAGE_SMOKE_NPMRC,
  sanitizeNpmScriptEnvironment,
} from './release-contracts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_LOCK = resolve(ROOT, 'package-lock.json');
const CI_WORKFLOW = resolve(ROOT, '.github/workflows/ci.yml');
const RELEASE_WORKFLOW = resolve(ROOT, '.github/workflows/release.yml');
const TYPE_CONTRACT_ROOT = resolve(ROOT, 'type-tests/packed');
const API_EXTRACTOR_CONFIG = resolve(ROOT, 'api-extractor.json');
const API_REPORT_FOLDER = resolve(ROOT, 'etc/api');

const PUBLIC_TOP_LEVEL_FILES = new Set(['LICENSE', 'README.md', 'package.json']);
const PUBLIC_DIST_SUFFIXES = [
  '.js',
  '.cjs',
  '.js.map',
  '.cjs.map',
  '.d.ts',
  '.d.cts',
  '.astro',
] as const;
const ESM_ONLY_ARTIFACT_STEMS = [
  'dist/adapters/astro/index',
  'dist/adapters/astro/middleware-entry',
  'dist/adapters/nextjs/index',
  'dist/adapters/nuxt/index',
  'dist/adapters/sveltekit/index',
  'dist/codegen-astro',
  'dist/codegen-cli',
] as const;
const FORBIDDEN_ESM_ONLY_SUFFIXES = ['.cjs', '.cjs.map', '.d.cts'] as const;
const CODEGEN_EXPORT_NAMES = new Set(['./codegen', './codegen/astro']);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function run(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
  });
  if (result.error !== undefined) throw result.error;
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status ?? 1,
  };
}

function detailFor(result: { readonly stdout: string; readonly stderr: string }): string {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return output.length > 2_000 ? output.slice(-2_000) : output;
}

function localBinary(name: string): string {
  return resolve(ROOT, 'node_modules/.bin', process.platform === 'win32' ? `${name}.cmd` : name);
}

function packageSpecifier(name: string, exportName: string): string {
  return exportName === '.' ? name : `${name}/${exportName.slice(2)}`;
}

function conditionTarget(value: unknown, condition: 'import' | 'require'): string | undefined {
  if (!isRecord(value)) return undefined;
  const branch = value[condition];
  if (typeof branch === 'string') return branch;
  if (!isRecord(branch)) return undefined;
  return typeof branch['default'] === 'string' ? branch['default'] : undefined;
}

function collectManifestTargets(value: unknown, label: string, targets: Map<string, string>): void {
  if (typeof value === 'string') {
    targets.set(label, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectManifestTargets(entry, `${label}[${String(index)}]`, targets);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    collectManifestTargets(child, `${label}.${key}`, targets);
  }
}

function resolvePackageTarget(packageRoot: string, target: string): string | undefined {
  if (!target.startsWith('./')) return undefined;
  const absolute = resolve(packageRoot, target.slice(2));
  const relativeTarget = relative(packageRoot, absolute);
  if (
    relativeTarget.length === 0 ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    return undefined;
  }
  return absolute;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeTypeProject(
  consumer: string,
  directory: string,
  sources: {
    readonly positiveEsm: string;
    readonly negativeEsm: string;
    readonly positiveCjs: string;
    readonly negativeCjs: string;
  },
): Promise<void> {
  const typeRoot = resolve(consumer, directory);
  await mkdir(typeRoot, { recursive: true });

  await Promise.all([
    writeFile(resolve(typeRoot, 'positive.mts'), sources.positiveEsm, 'utf8'),
    writeFile(resolve(typeRoot, 'negative.mts'), sources.negativeEsm, 'utf8'),
    writeFile(resolve(typeRoot, 'positive.cts'), sources.positiveCjs, 'utf8'),
    writeFile(resolve(typeRoot, 'negative.cts'), sources.negativeCjs, 'utf8'),
    writeFile(
      resolve(typeRoot, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
          },
          include: ['./*.mts', './*.cts'],
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
  ]);
}

async function readTypeContract(fileName: string, packageName: string): Promise<string> {
  const source = await readFile(resolve(TYPE_CONTRACT_ROOT, fileName), 'utf8');
  return source.replaceAll('payload-live-preview', packageName);
}

async function writeRuntimeTypeSmoke(consumer: string, packageName: string): Promise<void> {
  const [positiveEsm, negativeEsm, positiveCjs, negativeCjs] = await Promise.all([
    readTypeContract('runtime-positive.mts.fixture', packageName),
    readTypeContract('runtime-negative.mts.fixture', packageName),
    readTypeContract('runtime-positive.cts.fixture', packageName),
    readTypeContract('runtime-negative.cts.fixture', packageName),
  ]);
  await writeTypeProject(consumer, 'runtime-type-contracts', {
    positiveEsm,
    negativeEsm,
    positiveCjs,
    negativeCjs,
  });
}

async function writeCodegenTypeSmoke(consumer: string, packageName: string): Promise<void> {
  const [positiveEsm, negativeEsm, positiveCjs, negativeCjs] = await Promise.all([
    readTypeContract('codegen-positive.mts.fixture', packageName),
    readTypeContract('codegen-negative.mts.fixture', packageName),
    readTypeContract('codegen-positive.cts.fixture', packageName),
    readTypeContract('codegen-negative.cts.fixture', packageName),
  ]);
  await writeTypeProject(consumer, 'codegen-type-contracts', {
    positiveEsm,
    negativeEsm,
    positiveCjs,
    negativeCjs,
  });
}

async function initializeConsumer(
  consumer: string,
  dependencies?: Readonly<Record<string, string>>,
): Promise<void> {
  await mkdir(consumer, { recursive: true });
  const manifest = {
    private: true,
    type: 'module',
    ...(dependencies !== undefined ? { dependencies } : {}),
  };
  await Promise.all([
    writeFile(resolve(consumer, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    writeFile(resolve(consumer, '.npmrc'), PACKAGE_SMOKE_NPMRC, 'utf8'),
  ]);

  const persistedPolicy = await readFile(resolve(consumer, '.npmrc'), 'utf8');
  if (persistedPolicy !== PACKAGE_SMOKE_NPMRC) {
    throw new Error('isolated consumer npm policy was not written exactly');
  }
  for (const [name, expected] of [
    ['strict-allow-scripts', 'true'],
    ['ignore-scripts', 'false'],
    ['dangerously-allow-all-scripts', 'false'],
  ] as const) {
    const configured = run(
      'npm',
      ['config', 'get', name],
      consumer,
      sanitizeNpmScriptEnvironment(process.env),
    );
    if (configured.status !== 0 || configured.stdout.trim() !== expected) {
      throw new Error(
        `isolated consumer npm policy ${name} is not ${expected}:\n${detailFor(configured)}`,
      );
    }
  }
}

function installStrictly(
  consumer: string,
  packageArguments: readonly string[],
): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  return run(
    'npm',
    ['install', ...PACKAGE_SMOKE_INSTALL_ARGS, ...packageArguments],
    consumer,
    sanitizeNpmScriptEnvironment(process.env),
  );
}

function probeUnavailableDependencies(
  consumer: string,
  packageNames: readonly string[],
): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const source = [
    "import { createRequire } from 'node:module';",
    `const localRequire = createRequire(${JSON.stringify(resolve(consumer, 'resolution-probe.cjs'))});`,
    `for (const name of ${JSON.stringify(packageNames)}) {`,
    '  try {',
    '    console.error(`${name} unexpectedly resolved to ${localRequire.resolve(name)}`);',
    '    process.exitCode = 1;',
    '  } catch (error) {',
    "    if (error === null || typeof error !== 'object' || error.code !== 'MODULE_NOT_FOUND') throw error;",
    '  }',
    '}',
  ].join('\n');
  return run(process.execPath, ['--input-type=module', '--eval', source], consumer);
}

function probeLocalDependency(
  consumer: string,
  packageName: string,
): { readonly stdout: string; readonly stderr: string; readonly status: number } {
  const source = [
    "import { createRequire } from 'node:module';",
    "import { relative, resolve, sep } from 'node:path';",
    `const localRequire = createRequire(${JSON.stringify(resolve(consumer, 'resolution-probe.cjs'))});`,
    `const installedRoot = resolve(${JSON.stringify(consumer)}, 'node_modules');`,
    `const resolved = localRequire.resolve(${JSON.stringify(packageName)});`,
    'const fromInstalledRoot = relative(installedRoot, resolved);',
    "if (fromInstalledRoot === '..' || fromInstalledRoot.startsWith(`..${sep}`)) {",
    '  throw new Error(`${resolved} is outside the isolated consumer node_modules`);',
    '}',
  ].join('\n');
  return run(process.execPath, ['--input-type=module', '--eval', source], consumer);
}

async function main(): Promise<void> {
  const options = parsePackageArtifactArguments(process.argv.slice(2));
  const updateApiReports = options.updateApiReports;
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'payload-live-preview-package-smoke-'));
  const failures: string[] = [];

  try {
    const isolationViolations = findPackageSmokeIsolationViolations(ROOT, temporaryRoot);
    if (isolationViolations.length > 0) {
      throw new Error(isolationViolations.join('; '));
    }

    const [releaseWorkflow, ciWorkflow, rootManifestSource] = await Promise.all([
      readFile(RELEASE_WORKFLOW, 'utf8'),
      readFile(CI_WORKFLOW, 'utf8'),
      readFile(resolve(ROOT, 'package.json'), 'utf8'),
    ]);
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
    const sourceCommit = options.sourceCommit ?? headCommit;
    if (!/^[a-f0-9]{40}$/u.test(sourceCommit) || sourceCommit !== headCommit) {
      throw new Error('--source-commit must be the exact checked-out 40-character Git commit');
    }
    for (const violation of findReleaseWorkflowViolations(releaseWorkflow, ciWorkflow)) {
      failures.push(`release contract: ${violation}`);
    }
    for (const policy of MAINTAINER_INSTALL_POLICIES) {
      const directory = resolve(ROOT, policy.directory);
      const [npmrc, manifestSource, lockfileSource] = await Promise.all([
        readFile(resolve(directory, '.npmrc'), 'utf8'),
        readFile(resolve(directory, 'package.json'), 'utf8'),
        readFile(resolve(directory, 'package-lock.json'), 'utf8'),
      ]);
      for (const violation of findMaintainerInstallPolicyViolations(
        {
          label: policy.label,
          npmrc,
          manifest: JSON.parse(manifestSource) as unknown,
          lockfile: JSON.parse(lockfileSource) as unknown,
        },
        policy,
      )) {
        failures.push(`install policy: ${violation}`);
      }
    }

    let evidence: PackageArchiveEvidence;
    let tarball: string;
    let suppliedManifest: PackageArtifactManifest | undefined;
    if (options.tarball !== undefined) {
      tarball = resolve(ROOT, options.tarball);
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
      const manifestPath = resolve(ROOT, options.manifest ?? PACKAGE_ARTIFACT_MANIFEST);
      const manifestValue: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
      const manifestViolations = findPackageArtifactManifestViolations(manifestValue, {
        evidence,
        expectedName,
        expectedVersion,
        expectedSourceCommit: sourceCommit,
        expectedSourceDateEpoch: process.env['SOURCE_DATE_EPOCH'],
        expectedNodeVersion: process.version,
        expectedNpmVersion,
      });
      if (manifestViolations.length > 0) {
        throw new Error(`package artifact manifest failed:\n- ${manifestViolations.join('\n- ')}`);
      }
      suppliedManifest = manifestValue as PackageArtifactManifest;
    } else {
      const packDestination =
        options.artifactDirectory === undefined
          ? temporaryRoot
          : resolve(ROOT, options.artifactDirectory);
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
    if (evidence.name !== expectedName || evidence.version !== expectedVersion) {
      throw new Error(
        `package archive identity ${evidence.name}@${evidence.version} does not match ${expectedName}@${expectedVersion}`,
      );
    }

    const packedFiles = new Set(evidence.files.map((file) => file.path));
    for (const required of PUBLIC_TOP_LEVEL_FILES) {
      if (!packedFiles.has(required)) failures.push(`missing required package file: ${required}`);
    }
    for (const path of [...packedFiles].sort()) {
      const allowedDistFile =
        path.startsWith('dist/') && PUBLIC_DIST_SUFFIXES.some((suffix) => path.endsWith(suffix));
      if (!PUBLIC_TOP_LEVEL_FILES.has(path) && !allowedDistFile) {
        failures.push(`package content is outside the public allow-list: ${path}`);
      }
    }

    for (const stem of ESM_ONLY_ARTIFACT_STEMS) {
      for (const suffix of FORBIDDEN_ESM_ONLY_SUFFIXES) {
        const path = `${stem}${suffix}`;
        const inDist = await exists(resolve(ROOT, path));
        const inTarball = packedFiles.has(path);
        if (inDist || inTarball) {
          const locations = [inDist ? 'dist' : '', inTarball ? 'tarball' : '']
            .filter((location) => location.length > 0)
            .join(' and ');
          failures.push(`unexported ESM-only CJS artifact in ${locations}: ${path}`);
        }
      }
    }

    // Inspect the exact packed manifest with script execution disabled before
    // attempting a normal install. This first pass is not the consumer smoke:
    // it is a quarantine step that makes every forbidden hook observable
    // without granting it an opportunity to execute. The separate consumer
    // below then installs the same archive normally under strict policy.
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
    const typedApiEntries = collectTypedApiEntries(inspectedManifest);

    const publint = run(localBinary('publint'), ['run', tarball, '--strict'], ROOT);
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

    const codegenConsumer = resolve(temporaryRoot, 'codegen-consumer');
    await initializeConsumer(codegenConsumer, {
      'ts-morph': lockedTsMorphVersion,
    });
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

    const apiReportFailures = await checkApiReports({
      apiConfigPath: API_EXTRACTOR_CONFIG,
      entries: typedApiEntries,
      packageRootForEntry: (entry: TypedApiEntry): string =>
        CODEGEN_EXPORT_NAMES.has(entry.exportName) ? codegenPackageRoot : packageRoot,
      reportFolder: API_REPORT_FOLDER,
      reportTempFolder: resolve(temporaryRoot, 'api-extractor-temp'),
      typescriptCompilerFolder: resolve(ROOT, 'node_modules/typescript'),
      updateReports: updateApiReports,
    });
    for (const failure of apiReportFailures) {
      failures.push(`API Extractor: ${failure}`);
    }
    const declarationParityFailures = await checkDualDeclarationParity(
      typedApiEntries,
      (entry: TypedApiEntry): string =>
        CODEGEN_EXPORT_NAMES.has(entry.exportName) ? codegenPackageRoot : packageRoot,
    );
    for (const failure of declarationParityFailures) {
      failures.push(`declaration parity: ${failure}`);
    }

    const targets = new Map<string, string>();
    for (const field of ['main', 'module', 'types'] as const) {
      collectManifestTargets(manifestValue[field], field, targets);
    }
    collectManifestTargets(manifestValue['exports'], 'exports', targets);
    collectManifestTargets(manifestValue['bin'], 'bin', targets);

    const checkedMaps = new Set<string>();
    for (const [label, target] of targets) {
      const absolute = resolvePackageTarget(packageRoot, target);
      if (absolute === undefined) {
        failures.push(`${label} is not a safe package-relative target: ${target}`);
        continue;
      }
      const packedPath = target.slice(2);
      if (!packedFiles.has(packedPath)) {
        failures.push(`${label} target is absent from the tarball: ${target}`);
      }
      if (!(await exists(absolute))) {
        failures.push(`${label} target is absent after install: ${target}`);
        continue;
      }

      if ((target.endsWith('.js') || target.endsWith('.cjs')) && !checkedMaps.has(target)) {
        checkedMaps.add(target);
        const mapTarget = `${target}.map`;
        const mapPath = `${absolute}.map`;
        if (!packedFiles.has(mapTarget.slice(2)) || !(await exists(mapPath))) {
          failures.push(`${label} JavaScript target has no packed source map: ${mapTarget}`);
          continue;
        }
        try {
          const sourceMap: unknown = JSON.parse(await readFile(mapPath, 'utf8'));
          if (
            !isRecord(sourceMap) ||
            sourceMap['version'] !== 3 ||
            sourceMap['file'] !== basename(target) ||
            !Array.isArray(sourceMap['sources']) ||
            sourceMap['sources'].length === 0 ||
            typeof sourceMap['mappings'] !== 'string'
          ) {
            failures.push(`${label} source map is malformed: ${mapTarget}`);
          }
        } catch (error: unknown) {
          failures.push(`${label} source map is not valid JSON: ${String(error)}`);
        }
      }
    }

    const exportsValue = manifestValue['exports'];
    if (!isRecord(exportsValue)) throw new Error('packed package.json has no exports map');
    const runtimeEsmSpecifiers: string[] = [];
    const codegenEsmSpecifiers: string[] = [];
    const runtimeCjsSpecifiers: string[] = [];
    const codegenCjsSpecifiers: string[] = [];
    for (const [exportName, conditions] of Object.entries(exportsValue)) {
      if (conditionTarget(conditions, 'import') !== undefined) {
        const target = CODEGEN_EXPORT_NAMES.has(exportName)
          ? codegenEsmSpecifiers
          : runtimeEsmSpecifiers;
        target.push(packageSpecifier(packageName, exportName));
      }
      if (conditionTarget(conditions, 'require') !== undefined) {
        const target = CODEGEN_EXPORT_NAMES.has(exportName)
          ? codegenCjsSpecifiers
          : runtimeCjsSpecifiers;
        target.push(packageSpecifier(packageName, exportName));
      }
    }

    const loader = resolve(consumer, 'virtual-module-loader.mjs');
    await writeFile(
      loader,
      [
        'const VIRTUAL_OPTIONS = "virtual:payload-live-preview/options";',
        'const VIRTUAL_URL = "data:text/javascript,export default {};";',
        'export function resolve(specifier, context, nextResolve) {',
        '  if (specifier === VIRTUAL_OPTIONS) return { url: VIRTUAL_URL, shortCircuit: true };',
        '  return nextResolve(specifier, context);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    const esmRuntimeExports: Readonly<Record<string, readonly string[]>> = {
      [packageSpecifier(packageName, '.')]: ['LivePreviewClient', 'generateInlineScript'],
      [packageSpecifier(packageName, './core')]: ['EventEmitter', 'initLivePreview'],
      [packageSpecifier(packageName, './astro')]: ['livePreview', 'createLivePreviewMiddleware'],
      [packageSpecifier(packageName, './nextjs')]: ['createLivePreviewMiddleware'],
      [packageSpecifier(packageName, './sveltekit')]: ['livePreviewHandle'],
      [packageSpecifier(packageName, './nuxt')]: ['livePreviewNitroPlugin'],
      [packageSpecifier(packageName, './payload')]: ['buildLivePreviewUrl'],
      [packageSpecifier(packageName, './astro/middleware-entry')]: ['onRequest'],
    };
    const esmCodegenExports: Readonly<Record<string, readonly string[]>> = {
      [packageSpecifier(packageName, './codegen')]: ['generateTypes'],
      [packageSpecifier(packageName, './codegen/astro')]: ['livePreviewCodegen'],
    };

    const esm = run(
      process.execPath,
      [
        '--no-warnings',
        '--experimental-loader',
        loader,
        '--input-type=module',
        '--eval',
        `const expected = ${JSON.stringify(esmRuntimeExports)}; for (const specifier of ${JSON.stringify(runtimeEsmSpecifiers)}) { const namespace = await import(specifier); if (typeof namespace !== 'object' || namespace === null) throw new Error(specifier); for (const name of expected[specifier] ?? []) if (typeof namespace[name] !== 'function') throw new Error(specifier + ' missing function ' + name); }`,
      ],
      consumer,
    );
    if (esm.status !== 0) {
      failures.push(`peer-free ESM import smoke failed:\n${detailFor(esm)}`);
    }

    const codegenEsm = run(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `const expected = ${JSON.stringify(esmCodegenExports)}; for (const specifier of ${JSON.stringify(codegenEsmSpecifiers)}) { const namespace = await import(specifier); if (typeof namespace !== 'object' || namespace === null) throw new Error(specifier); for (const name of expected[specifier] ?? []) if (typeof namespace[name] !== 'function') throw new Error(specifier + ' missing function ' + name); }`,
      ],
      codegenConsumer,
    );
    if (codegenEsm.status !== 0) {
      failures.push(`peer-provisioned ESM codegen smoke failed:\n${detailFor(codegenEsm)}`);
    }

    const cjs = run(
      process.execPath,
      [
        '--input-type=commonjs',
        '--eval',
        `const expected = ${JSON.stringify({
          [packageSpecifier(packageName, '.')]: ['LivePreviewClient', 'generateInlineScript'],
          [packageSpecifier(packageName, './core')]: ['EventEmitter', 'initLivePreview'],
          [packageSpecifier(packageName, './payload')]: ['buildLivePreviewUrl'],
        })}; for (const specifier of ${JSON.stringify(runtimeCjsSpecifiers)}) { const namespace = require(specifier); if ((typeof namespace !== 'object' && typeof namespace !== 'function') || namespace === null) throw new Error(specifier); for (const name of expected[specifier] ?? []) if (typeof namespace[name] !== 'function') throw new Error(specifier + ' missing function ' + name); }`,
      ],
      consumer,
    );
    if (cjs.status !== 0) {
      failures.push(`peer-free CommonJS import smoke failed:\n${detailFor(cjs)}`);
    }

    const codegenCjs = run(
      process.execPath,
      [
        '--input-type=commonjs',
        '--eval',
        `const expected = ${JSON.stringify({
          [packageSpecifier(packageName, './codegen')]: ['generateTypes'],
        })}; for (const specifier of ${JSON.stringify(codegenCjsSpecifiers)}) { const namespace = require(specifier); if ((typeof namespace !== 'object' && typeof namespace !== 'function') || namespace === null) throw new Error(specifier); for (const name of expected[specifier] ?? []) if (typeof namespace[name] !== 'function') throw new Error(specifier + ' missing function ' + name); }`,
      ],
      codegenConsumer,
    );
    if (codegenCjs.status !== 0) {
      failures.push(`peer-provisioned CommonJS codegen smoke failed:\n${detailFor(codegenCjs)}`);
    }

    const binValue = manifestValue['bin'];
    if (!isRecord(binValue) || typeof binValue['pll-codegen'] !== 'string') {
      failures.push('manifest does not declare the pll-codegen binary');
    } else {
      const cli = run(
        process.platform === 'win32'
          ? resolve(codegenConsumer, 'node_modules/.bin/pll-codegen.cmd')
          : resolve(codegenConsumer, 'node_modules/.bin/pll-codegen'),
        ['--help'],
        codegenConsumer,
      );
      if (cli.status !== 0 || !cli.stdout.includes('Usage:')) {
        failures.push(`packed CLI --help smoke failed:\n${detailFor(cli)}`);
      }
      const cliConfig = resolve(codegenConsumer, 'payload.config.ts');
      const cliOutput = resolve(codegenConsumer, 'generated-payload-types.ts');
      await writeFile(
        cliConfig,
        `export default { globals: [{ slug: 'homepage', fields: [{ name: 'title', type: 'text' }] }], collections: [] };\n`,
        'utf8',
      );
      const generation = run(
        process.platform === 'win32'
          ? resolve(codegenConsumer, 'node_modules/.bin/pll-codegen.cmd')
          : resolve(codegenConsumer, 'node_modules/.bin/pll-codegen'),
        ['--config', cliConfig, '--out', cliOutput, '--quiet'],
        codegenConsumer,
      );
      if (generation.status !== 0 || !(await exists(cliOutput))) {
        failures.push(`packed CLI generation smoke failed:\n${detailFor(generation)}`);
      } else {
        const generated = await readFile(cliOutput, 'utf8');
        if (
          !generated.includes('export interface Homepage') ||
          !generated.includes('title?: string')
        ) {
          failures.push('packed CLI generated an unexpected type surface');
        }
      }
      const binTarget = resolvePackageTarget(codegenPackageRoot, binValue['pll-codegen']);
      if (binTarget !== undefined && process.platform !== 'win32') {
        const mode = (await stat(binTarget)).mode;
        if ((mode & 0o111) === 0) failures.push('packed pll-codegen target is not executable');
      }
    }

    await writeRuntimeTypeSmoke(consumer, packageName);
    const runtimeTypecheck = run(
      process.execPath,
      [
        resolve(ROOT, 'node_modules/typescript/bin/tsc'),
        '--project',
        'runtime-type-contracts/tsconfig.json',
      ],
      consumer,
    );
    if (runtimeTypecheck.status !== 0) {
      failures.push(
        `peer-free strict NodeNext ESM/CommonJS type smoke failed:\n${detailFor(runtimeTypecheck)}`,
      );
    }

    await writeCodegenTypeSmoke(codegenConsumer, packageName);
    const codegenTypecheck = run(
      process.execPath,
      [
        resolve(ROOT, 'node_modules/typescript/bin/tsc'),
        '--project',
        'codegen-type-contracts/tsconfig.json',
      ],
      codegenConsumer,
    );
    if (codegenTypecheck.status !== 0) {
      failures.push(
        `peer-provisioned strict NodeNext codegen type smoke failed:\n${detailFor(codegenTypecheck)}`,
      );
    }

    if (failures.length > 0) {
      for (const failure of failures) console.error(`FAIL ${failure}`);
      throw new Error(`packed-package gate failed with ${String(failures.length)} violation(s)`);
    }

    console.log(
      `[package] PASS ${String(evidence.files.length)} packed files; publint, ATTW, ${String(typedApiEntries.length)} API reports, isolated script-free strict installs, peer-free and explicit-peer ESM/CJS, CLI, and positive/negative strict NodeNext types verified`,
    );

    if (options.artifactDirectory !== undefined) {
      const artifactDirectory = resolve(ROOT, options.artifactDirectory);
      const manifest = createPackageArtifactManifest({
        evidence,
        sourceCommit,
        sourceDateEpoch: process.env['SOURCE_DATE_EPOCH'],
        nodeVersion: process.version,
        npmVersion,
      });
      await writeFile(
        resolve(artifactDirectory, PACKAGE_ARTIFACT_MANIFEST),
        serializePackageArtifactManifest(manifest),
        'utf8',
      );
      console.log(
        `[package] persisted verified archive ${relative(ROOT, tarball)} and ${relative(ROOT, resolve(artifactDirectory, PACKAGE_ARTIFACT_MANIFEST))}`,
      );
    } else if (suppliedManifest !== undefined) {
      const finalEvidence = await inspectPackageArchive(
        tarball,
        temporaryRoot,
        sanitizeNpmScriptEnvironment(process.env),
      );
      const finalViolations = findPackageArtifactManifestViolations(suppliedManifest, {
        evidence: finalEvidence,
        expectedName,
        expectedVersion,
        expectedSourceCommit: sourceCommit,
        expectedSourceDateEpoch: process.env['SOURCE_DATE_EPOCH'],
        expectedNodeVersion: process.version,
        expectedNpmVersion,
      });
      if (finalViolations.length > 0) {
        throw new Error(
          `package artifact changed during verification:\n- ${finalViolations.join('\n- ')}`,
        );
      }
      console.log(`[package] rechecked the supplied archive without repacking the repository`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
