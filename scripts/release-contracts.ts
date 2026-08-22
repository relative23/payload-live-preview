/**
 * Release-only contracts shared by the package smoke test and its regressions.
 *
 * Keep these checks independent from the shipped runtime. They deliberately
 * inspect the artifact/workflow as data so a release cannot become permissive
 * merely because npm or GitHub Actions changes how it interprets a default.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path';

export const FORBIDDEN_PACKAGE_LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepack',
  'prepare',
  'postpack',
] as const;

/** Exact npm policy used by every isolated packed-package consumer. */
export const PACKAGE_SMOKE_NPMRC =
  'strict-allow-scripts=true\nignore-scripts=false\ndangerously-allow-all-scripts=false\n';

/** npm arguments shared by normal isolated tarball installs. */
export const PACKAGE_SMOKE_INSTALL_ARGS = [
  '--strict-allow-scripts=true',
  '--ignore-scripts=false',
  '--dangerously-allow-all-scripts=false',
  '--legacy-peer-deps=false',
  '--no-audit',
  '--no-fund',
  '--package-lock=false',
  '--omit=optional',
  '--offline',
  '--no-save',
] as const;

/**
 * Strict online bootstrap for the exact, lockfile-reviewed codegen peer.
 *
 * A fresh npm cache may contain the package tarball from the maintainer install
 * without containing the registry metadata needed to resolve it in a new
 * consumer. Provision the exact direct dependency first; the package archive
 * itself is still installed separately with PACKAGE_SMOKE_INSTALL_ARGS and is
 * therefore exercised offline.
 */
export const PACKAGE_SMOKE_PEER_BOOTSTRAP_ARGS = [
  '--strict-allow-scripts=true',
  '--ignore-scripts=false',
  '--dangerously-allow-all-scripts=false',
  '--legacy-peer-deps=false',
  '--no-audit',
  '--no-fund',
  '--package-lock=true',
  '--omit=optional',
  '--prefer-offline',
  '--no-save',
] as const;

const REVIEWED_PACKAGE_MANAGER = 'npm@11.16.0';

export interface MaintainerInstallPolicyProfile {
  readonly label: string;
  readonly directory: string;
  readonly npmrc: string;
  readonly packageManager: string;
  readonly allowScripts: Readonly<Record<string, boolean>>;
}

/**
 * Reviewed dependency-script policy for the root and every real-app fixture.
 *
 * This intentionally duplicates the security-sensitive verdicts from each
 * manifest. A dependency or npm update therefore requires an explicit review
 * of both the lockfile identity and its allow/deny decision instead of silently
 * broadening the policy through a mechanical lockfile refresh.
 */
export const MAINTAINER_INSTALL_POLICIES = [
  {
    label: 'root',
    directory: '.',
    npmrc:
      'save-exact=false\npackage-lock=true\naudit=false\nfund=false\nstrict-allow-scripts=true\n',
    packageManager: REVIEWED_PACKAGE_MANAGER,
    allowScripts: {
      'esbuild@0.28.2': true,
      'fsevents@2.3.2': false,
      'fsevents@2.3.3': false,
    },
  },
  {
    label: 'Astro fixture',
    directory: 'examples/astro-payload',
    npmrc: 'strict-allow-scripts=true\ninstall-links=true\n',
    packageManager: REVIEWED_PACKAGE_MANAGER,
    allowScripts: {
      'esbuild@0.28.1': true,
      'fsevents@2.3.3': false,
    },
  },
  {
    label: 'Next.js fixture',
    directory: 'examples/nextjs-payload',
    npmrc: 'strict-allow-scripts=true\ninstall-links=true\n',
    packageManager: REVIEWED_PACKAGE_MANAGER,
    allowScripts: {},
  },
  {
    label: 'SvelteKit fixture',
    directory: 'examples/sveltekit-payload',
    npmrc: 'strict-allow-scripts=true\ninstall-links=true\n',
    packageManager: REVIEWED_PACKAGE_MANAGER,
    allowScripts: {
      'fsevents@2.3.3': false,
    },
  },
  {
    label: 'Nuxt fixture',
    directory: 'examples/nuxt-payload',
    npmrc: 'strict-allow-scripts=true\ninstall-links=true\n',
    packageManager: REVIEWED_PACKAGE_MANAGER,
    allowScripts: {
      'esbuild@0.28.2': true,
      'fsevents@2.3.3': false,
    },
  },
  {
    label: 'real Payload fixture',
    directory: 'examples/payload-backend',
    npmrc: 'strict-allow-scripts=true\n',
    packageManager: REVIEWED_PACKAGE_MANAGER,
    allowScripts: {
      'esbuild@0.18.20': true,
      'esbuild@0.25.12': true,
      'esbuild@0.28.2': true,
      'fsevents@2.3.3': false,
    },
  },
] as const satisfies readonly MaintainerInstallPolicyProfile[];

/** Fixtures that install this repository through the reviewed local file specifier. */
export const LOCAL_FILE_PACKAGE_FIXTURES = [
  { label: 'Astro fixture', directory: 'examples/astro-payload' },
  { label: 'Next.js fixture', directory: 'examples/nextjs-payload' },
  { label: 'SvelteKit fixture', directory: 'examples/sveltekit-payload' },
  { label: 'Nuxt fixture', directory: 'examples/nuxt-payload' },
] as const;

export interface PackageLockMetadataDocument {
  readonly label: string;
  readonly manifest: unknown;
  readonly lockfile: unknown;
}

export interface PackageLockMetadataInput {
  readonly root: PackageLockMetadataDocument;
  readonly fixtures: readonly PackageLockMetadataDocument[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const LOCAL_PACKAGE_SPECIFIER = 'file:../..';

/**
 * Keep Changesets' package version synchronized with every lockfile location
 * that npm copies from the local package. This is deliberately a metadata-only
 * contract: dependency resolution remains owned by reviewed npm install work.
 */
export function findPackageLockMetadataViolations(
  input: PackageLockMetadataInput,
): readonly string[] {
  const violations: string[] = [];
  const rootManifest = input.root.manifest;
  if (!isRecord(rootManifest)) {
    return [`${input.root.label}: package.json is not an object`];
  }
  const packageName = rootManifest['name'];
  const packageVersion = rootManifest['version'];
  if (typeof packageName !== 'string' || packageName.length === 0) {
    violations.push(`${input.root.label}: package.json name must be a non-empty string`);
  }
  if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
    violations.push(`${input.root.label}: package.json version must be a non-empty string`);
  }
  if (
    typeof packageName !== 'string' ||
    packageName.length === 0 ||
    typeof packageVersion !== 'string' ||
    packageVersion.length === 0
  ) {
    return violations;
  }

  const rootLockfile = input.root.lockfile;
  if (!isRecord(rootLockfile)) {
    return [...violations, `${input.root.label}: package-lock.json is not an object`];
  }
  if (rootLockfile['name'] !== packageName) {
    violations.push(
      `${input.root.label}: package-lock.json name must match package.json name ${packageName}`,
    );
  }
  if (rootLockfile['version'] !== packageVersion) {
    violations.push(
      `${input.root.label}: package-lock.json version must match package.json version ${packageVersion}`,
    );
  }
  const rootPackages = rootLockfile['packages'];
  const rootEntry = isRecord(rootPackages) ? rootPackages[''] : undefined;
  if (!isRecord(rootEntry)) {
    violations.push(`${input.root.label}: package-lock.json packages[""] is not an object`);
  } else {
    if (rootEntry['name'] !== packageName) {
      violations.push(
        `${input.root.label}: package-lock.json packages[""] name must match package.json name ${packageName}`,
      );
    }
    if (rootEntry['version'] !== packageVersion) {
      violations.push(
        `${input.root.label}: package-lock.json packages[""] version must match package.json version ${packageVersion}`,
      );
    }
  }

  const installedPath = `node_modules/${packageName}`;
  for (const fixture of input.fixtures) {
    const manifest = fixture.manifest;
    const manifestDependencies = isRecord(manifest) ? manifest['dependencies'] : undefined;
    if (
      !isRecord(manifestDependencies) ||
      manifestDependencies[packageName] !== LOCAL_PACKAGE_SPECIFIER
    ) {
      violations.push(
        `${fixture.label}: package.json must depend on ${packageName} through ${LOCAL_PACKAGE_SPECIFIER}`,
      );
    }

    const lockfile = fixture.lockfile;
    const packages = isRecord(lockfile) ? lockfile['packages'] : undefined;
    const fixtureRoot = isRecord(packages) ? packages[''] : undefined;
    const fixtureDependencies = isRecord(fixtureRoot) ? fixtureRoot['dependencies'] : undefined;
    if (
      !isRecord(fixtureDependencies) ||
      fixtureDependencies[packageName] !== LOCAL_PACKAGE_SPECIFIER
    ) {
      violations.push(
        `${fixture.label}: package-lock.json root dependency must remain ${LOCAL_PACKAGE_SPECIFIER}`,
      );
    }

    const installedEntry = isRecord(packages) ? packages[installedPath] : undefined;
    if (!isRecord(installedEntry) || installedEntry['resolved'] !== LOCAL_PACKAGE_SPECIFIER) {
      violations.push(
        `${fixture.label}: package-lock.json installed entry must resolve to ${LOCAL_PACKAGE_SPECIFIER}`,
      );
    }
    if (!isRecord(installedEntry) || installedEntry['version'] !== packageVersion) {
      violations.push(
        `${fixture.label}: ${LOCAL_PACKAGE_SPECIFIER} lock entry version must match ${packageName}@${packageVersion}`,
      );
    }
  }

  return violations;
}

export interface MaintainerInstallPolicyInput {
  readonly label: string;
  readonly npmrc: string;
  readonly manifest: unknown;
  readonly lockfile: unknown;
}

const INHERITED_NPM_SCRIPT_POLICY_KEYS = new Set([
  'npm_config_ignore_scripts',
  'npm_config_dangerously_allow_all_scripts',
  'npm_config_allow_scripts',
]);

/**
 * Remove ambient npm settings that can disable scripts or bypass reviewed
 * dependency verdicts. Callers then pass all three execution controls
 * explicitly on the command line and verify npm's effective configuration.
 */
export function sanitizeNpmScriptEnvironment(
  environment: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !INHERITED_NPM_SCRIPT_POLICY_KEYS.has(key.toLowerCase()),
    ),
  );
}

function lockfilePackageName(path: string, entry: JsonRecord): string | undefined {
  const explicitName = entry['name'];
  if (typeof explicitName === 'string' && explicitName.length > 0) return explicitName;
  const marker = 'node_modules/';
  const markerIndex = path.lastIndexOf(marker);
  const inferredName = markerIndex >= 0 ? path.slice(markerIndex + marker.length) : undefined;
  return inferredName !== undefined && inferredName.length > 0 ? inferredName : undefined;
}

/** Validate one repository/fixture npm policy against its exact lockfile identities. */
export function findMaintainerInstallPolicyViolations(
  input: MaintainerInstallPolicyInput,
  policy: MaintainerInstallPolicyProfile,
): readonly string[] {
  const violations: string[] = [];
  const prefix = `${input.label}:`;

  if (input.npmrc !== policy.npmrc) {
    violations.push(`${prefix} .npmrc does not match the reviewed policy`);
  }

  if (!isRecord(input.manifest)) {
    violations.push(`${prefix} package.json is not an object`);
    return violations;
  }
  if (input.manifest['packageManager'] !== policy.packageManager) {
    violations.push(`${prefix} packageManager must be ${policy.packageManager}`);
  }

  const expectedVerdicts = policy.allowScripts;
  const expectedNames = new Set(Object.keys(expectedVerdicts));
  const allowScripts = input.manifest['allowScripts'];
  if (!isRecord(allowScripts)) {
    if (expectedNames.size > 0 || allowScripts !== undefined) {
      violations.push(`${prefix} allowScripts must be the reviewed verdict object`);
    }
  } else {
    for (const [identity, expected] of Object.entries(expectedVerdicts)) {
      if (allowScripts[identity] !== expected) {
        violations.push(
          `${prefix} allowScripts verdict for ${identity} must be ${String(expected)}`,
        );
      }
    }
    for (const identity of Object.keys(allowScripts)) {
      if (!expectedNames.has(identity)) {
        violations.push(`${prefix} unreviewed allowScripts verdict: ${identity}`);
      }
    }
  }

  if (!isRecord(input.lockfile) || !isRecord(input.lockfile['packages'])) {
    violations.push(`${prefix} package-lock.json has no packages object`);
    return violations;
  }

  const lockedInstallScripts = new Set<string>();
  for (const [path, value] of Object.entries(input.lockfile['packages'])) {
    if (!isRecord(value) || value['hasInstallScript'] !== true) continue;
    const name = lockfilePackageName(path, value);
    const version = value['version'];
    if (name === undefined || typeof version !== 'string' || version.length === 0) {
      violations.push(`${prefix} malformed install-script lockfile entry: ${path || '<root>'}`);
      continue;
    }
    lockedInstallScripts.add(`${name}@${version}`);
  }

  for (const identity of [...lockedInstallScripts].sort()) {
    if (!expectedNames.has(identity)) {
      violations.push(`${prefix} lockfile install script has no reviewed verdict: ${identity}`);
    }
  }
  for (const identity of [...expectedNames].sort()) {
    if (!lockedInstallScripts.has(identity)) {
      violations.push(
        `${prefix} reviewed verdict has no install-script lockfile entry: ${identity}`,
      );
    }
  }

  return violations;
}

/** Return publish-time install hooks that the package must never expose. */
export function findForbiddenPackageLifecycleScripts(manifest: unknown): readonly string[] {
  if (!isRecord(manifest)) return ['package.json'];
  const scripts = manifest['scripts'];
  if (scripts === undefined) return [];
  if (!isRecord(scripts)) return ['scripts'];

  return FORBIDDEN_PACKAGE_LIFECYCLE_SCRIPTS.filter((name) =>
    Object.prototype.hasOwnProperty.call(scripts, name),
  ).map((name) => `scripts.${name}`);
}

/** Pin the maintainer release command to the exact-artifact publisher. */
export function findExactPublisherManifestViolations(manifest: unknown): readonly string[] {
  if (!isRecord(manifest)) return ['package.json is not an object'];
  const scripts = manifest['scripts'];
  if (!isRecord(scripts)) return ['package.json scripts is not an object'];
  return scripts['release'] === 'tsx scripts/publish-artifact.ts'
    ? []
    : ['package.json release script does not invoke the exact-artifact publisher'];
}

/** Pin both report policies to their exact machine-readable inputs. */
export function findMutationPolicyManifestViolations(manifest: unknown): readonly string[] {
  if (!isRecord(manifest)) return ['package.json is not an object'];
  const scripts = manifest['scripts'];
  if (!isRecord(scripts)) return ['package.json scripts is not an object'];

  const expected: Readonly<Record<string, string>> = {
    'test:mutation:policy:pr':
      'tsx scripts/mutation-policy.ts --policy quality/mutation-policy-pr.json --report test-results/stryker-pr.json',
    'test:mutation:policy': 'tsx scripts/mutation-policy.ts',
  };
  const violations: string[] = [];
  for (const [name, command] of Object.entries(expected)) {
    if (scripts[name] !== command) {
      violations.push(`package.json ${name} script does not enforce its exact report policy`);
    }
  }
  return violations;
}

/**
 * Reject package consumers that can inherit the maintainer dependency tree.
 *
 * Node resolves bare imports by walking ancestor `node_modules` directories.
 * A smoke consumer nested below this repository could therefore make an
 * undeclared dependency appear to be present even when the packed archive did
 * not install it. Common path prefixes are not ancestry, so use `relative()`
 * instead of a string-prefix check.
 */
export function findPackageSmokeIsolationViolations(
  repositoryRoot: string,
  temporaryRoot: string,
): readonly string[] {
  const repository = resolve(repositoryRoot);
  const candidate = resolve(temporaryRoot);
  const pathFromRepository = relative(repository, candidate);
  const outsideRepository =
    pathFromRepository === '..' ||
    pathFromRepository.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRepository);

  return outsideRepository ? [] : ['package smoke root is nested inside the maintainer repository'];
}

function jobBlock(workflow: string, name: string): string | undefined {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) return undefined;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function jobCondition(block: string): string {
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((line) => /^ {4}if:\s*/.test(line));
  if (start < 0) return '';

  const firstLine = (lines[start] ?? '').replace(/^ {4}if:\s*/, '');
  if (!/^(?:>|>-|\||\|-)\s*$/.test(firstLine)) return firstLine;

  const condition: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.length > 0 && !/^ {6}/.test(line)) break;
    condition.push(line);
  }
  return condition.join('\n');
}

function has(source: string, pattern: RegExp): boolean {
  const executableSource = source
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, ''))
    .filter((line) => !/^\s*#/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ');
  return pattern.test(executableSource);
}

type RequiredPattern = readonly [description: string, pattern: RegExp];

function requirePatterns(
  source: string,
  prefix: string,
  requirements: readonly RequiredPattern[],
  violations: string[],
): void {
  for (const [description, pattern] of requirements) {
    if (!has(source, pattern)) violations.push(`${prefix} ${description}`);
  }
}

function findNonImmutableActionReferences(workflow: string, label: string): readonly string[] {
  const violations: string[] = [];
  for (const match of workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu)) {
    const reference = match[1];
    if (reference === undefined || reference.startsWith('./')) continue;
    if (!/^[^@\s]+@[a-fA-F0-9]{40}$/u.test(reference)) {
      violations.push(`${label} workflow uses a non-immutable action reference: ${reference}`);
    }
  }
  return violations;
}

function findCiWorkflowViolations(workflow: string): readonly string[] {
  const violations: string[] = [...findNonImmutableActionReferences(workflow, 'CI')];
  if (!has(workflow, /name:\s*CI(?:\s|$)/)) violations.push('CI workflow is not named CI');
  if (!has(workflow, /push:\s*branches:\s*\[\s*main\s*\]/)) {
    violations.push('CI does not run for pushes to main');
  }
  if (
    !has(
      workflow,
      /concurrency:\s*group:\s*\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}\s*cancel-in-progress:\s*\$\{\{\s*github\.event_name\s*==\s*['"]pull_request['"]\s*\}\}/,
    )
  ) {
    violations.push('CI main-branch verdict can be cancelled');
  }

  const requiredJobs: Readonly<Record<string, readonly RequiredPattern[]>> = {
    lint: [
      ['does not run npm audit --audit-level=high', /run:\s*npm audit --audit-level=high/],
      ['does not run npm run typecheck', /run:\s*npm run typecheck(?:\s|$)/],
      ['does not run npm run lint', /run:\s*npm run lint(?:\s|$)/],
      ['does not run npm run format:check', /run:\s*npm run format:check(?:\s|$)/],
      ['does not run npm run test:policy', /run:\s*npm run test:policy(?:\s|$)/],
      ['does not run npm run test:architecture', /run:\s*npm run test:architecture(?:\s|$)/],
    ],
    unit: [
      ['does not run npm run test:unit', /run:\s*npm run test:unit(?:\s|$)/],
      ['does not run npm run test:integration', /run:\s*npm run test:integration(?:\s|$)/],
    ],
    coverage: [
      ['does not fetch the reviewed base history', /fetch-depth:\s*0/],
      ['does not run npm run test:coverage', /run:\s*npm run test:coverage(?:\s|$)/],
      [
        'does not provide the reviewed coverage base SHA',
        /COVERAGE_BASE_REF:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\|\|\s*github\.event\.before\s*\}\}/,
      ],
      ['does not run npm run test:coverage:diff', /run:\s*npm run test:coverage:diff(?:\s|$)/],
    ],
    mutation: [
      ['does not set a bounded timeout', /timeout-minutes:\s*30/],
      ['does not pin the quality Node version', /node-version:\s*22\.23\.2/],
      ['does not build the generated runtime', /run:\s*npm run build:runtime(?:\s|$)/],
      ['does not select the PR mutation scope', /STRYKER_SCOPE:\s*pr/],
      ['does not run npm run test:mutation', /run:\s*npm run test:mutation(?:\s|$)/],
      [
        'does not enforce the exact PR mutation policy',
        /run:\s*npm run test:mutation:policy:pr(?:\s|$)/,
      ],
    ],
    'critical-mutation': [
      ['does not set a bounded timeout', /timeout-minutes:\s*120/],
      ['does not pin the quality Node version', /node-version:\s*22\.23\.2/],
      ['does not build the generated runtime', /run:\s*npm run build:runtime(?:\s|$)/],
      ['does not select the complete critical mutation scope', /STRYKER_SCOPE:\s*nightly/],
      ['does not run npm run test:mutation', /run:\s*npm run test:mutation(?:\s|$)/],
      [
        'does not enforce the reviewed critical mutation policy',
        /run:\s*npm run test:mutation:policy(?:\s|$)/,
      ],
    ],
    'node-leak-soak': [
      ['does not set a bounded timeout', /timeout-minutes:\s*30/],
      ['does not pin the quality Node version', /node-version:\s*22\.23\.2/],
      ['does not build the generated runtime', /run:\s*npm run build:runtime(?:\s|$)/],
      ['does not run the full 10,000-cycle leak gate', /run:\s*npm run test:leak(?:\s|$)/],
    ],
    'browser-soak': [
      ['does not set a bounded timeout', /timeout-minutes:\s*60/],
      ['does not pin the quality Node version', /node-version:\s*22\.23\.2/],
      ['does not install Chromium', /run:\s*npx playwright install --with-deps chromium/],
      ['does not run npm run build', /run:\s*npm run build(?:\s|$)/],
      [
        'does not clean-install examples/astro-payload',
        /run:\s*npm ci --no-audit --no-fund --prefix examples\/astro-payload/,
      ],
      [
        'does not audit the Astro fixture',
        /run:\s*npm audit --audit-level=high --prefix examples\/astro-payload/,
      ],
      ['does not pin the five-minute duration', /PLP_SOAK_DURATION_MS:\s*300000/],
      ['does not run npm run test:soak', /run:\s*npm run test:soak(?:\s|$)/],
    ],
    e2e: [
      ['does not run npm run build', /run:\s*npm run build(?:\s|$)/],
      [
        'does not clean-install examples/astro-payload',
        /run:\s*npm ci --no-audit --no-fund --prefix examples\/astro-payload/,
      ],
      [
        'does not clean-install examples/nextjs-payload',
        /run:\s*npm ci --no-audit --no-fund --prefix examples\/nextjs-payload/,
      ],
      [
        'does not clean-install examples/sveltekit-payload',
        /run:\s*npm ci --no-audit --no-fund --prefix examples\/sveltekit-payload/,
      ],
      [
        'does not clean-install examples/nuxt-payload',
        /run:\s*npm ci --no-audit --no-fund --prefix examples\/nuxt-payload/,
      ],
      [
        'does not run every browser project',
        /run:\s*npx playwright test --project=\$\{\{\s*matrix\.browser\s*\}\}/,
      ],
      [
        'does not audit the Astro fixture',
        /run:\s*npm audit --audit-level=high --prefix examples\/astro-payload/,
      ],
      [
        'does not audit the Next.js fixture',
        /run:\s*npm audit --audit-level=high --prefix examples\/nextjs-payload/,
      ],
      [
        'does not audit the SvelteKit fixture',
        /run:\s*npm audit --audit-level=high --prefix examples\/sveltekit-payload/,
      ],
      [
        'does not audit the Nuxt fixture',
        /run:\s*npm audit --audit-level=high --prefix examples\/nuxt-payload/,
      ],
    ],
    'real-payload-e2e': [
      ['does not run npm run build', /run:\s*npm run build(?:\s|$)/],
      [
        'does not clean-install examples/astro-payload',
        /run:\s*npm ci --no-audit --no-fund --prefix examples\/astro-payload/,
      ],
      [
        'does not clean-install examples/payload-backend',
        /run:\s*npm ci --no-audit --no-fund --prefix examples\/payload-backend/,
      ],
      [
        'does not run npm run test:e2e:real-payload',
        /run:\s*npm run test:e2e:real-payload(?:\s|$)/,
      ],
      [
        'does not audit the real Payload fixture',
        /run:\s*npm audit --audit-level=high --prefix examples\/payload-backend/,
      ],
    ],
    build: [
      ['does not pin the release artifact Node version', /node-version:\s*22\.23\.2/],
      ['does not run npm run build', /run:\s*npm run build(?:\s|$)/],
      ['does not run npm run test:package', /run:\s*npm run test:package(?:\s|$)/],
      [
        'does not derive SOURCE_DATE_EPOCH from the tested commit',
        /epoch=\$\(git show -s --format=%ct ["']?\$TESTED_SHA["']?\)/,
      ],
      [
        'does not persist the exact package artifact',
        /run:\s*npm run test:package -- --artifact-dir release-artifact --source-commit ["']?\$TESTED_SHA["']?/,
      ],
      [
        'does not upload the exact package artifact',
        /uses:\s*actions\/upload-artifact@[a-fA-F0-9]{40}.*name:\s*release-candidate-\$\{\{\s*github\.sha\s*\}\}.*release-artifact\/\*\.tgz.*release-artifact\/package-artifact\.json.*if-no-files-found:\s*error/,
      ],
    ],
  };

  for (const [name, requirements] of Object.entries(requiredJobs)) {
    const block = jobBlock(workflow, name);
    if (block === undefined) {
      violations.push(`CI is missing required job ${name}`);
      continue;
    }
    requirePatterns(
      block,
      `CI ${name} job`,
      [
        ['does not check out the repository', /uses:\s*actions\/checkout@[a-fA-F0-9]{40}/],
        ['does not set up Node', /uses:\s*actions\/setup-node@[a-fA-F0-9]{40}/],
        [
          'does not install the repository npm version',
          /run:\s*npm install --global .*packageManager/,
        ],
        ['does not run npm ci', /run:\s*npm ci(?:\s|$)/],
        ...requirements,
      ],
      violations,
    );
    if (has(block, /continue-on-error:\s*true/)) {
      violations.push(`CI ${name} job permits failures`);
    }
  }

  const unit = jobBlock(workflow, 'unit');
  if (unit !== undefined && !has(unit, /node:\s*\[\s*20,\s*22,\s*24,\s*26\s*\]/)) {
    violations.push('CI unit job does not cover Node 20, 22, 24, and 26');
  }
  const e2e = jobBlock(workflow, 'e2e');
  if (e2e !== undefined && !has(e2e, /browser:\s*\[\s*chromium,\s*firefox,\s*webkit\s*\]/)) {
    violations.push('CI e2e job does not cover chromium, firefox, and webkit');
  }

  const prMutation = jobBlock(workflow, 'mutation');
  if (
    prMutation !== undefined &&
    jobCondition(prMutation).replace(/\s+/gu, ' ').trim() !== "github.event_name == 'pull_request'"
  ) {
    violations.push('CI PR mutation job is not restricted to pull requests');
  }
  for (const name of ['critical-mutation', 'node-leak-soak', 'browser-soak'] as const) {
    const block = jobBlock(workflow, name);
    if (block === undefined) continue;
    const condition = jobCondition(block).replace(/\s+/gu, ' ').trim();
    const isMainPush =
      condition === "github.event_name == 'push' && github.ref == 'refs/heads/main'";
    if (!isMainPush) {
      violations.push(`CI ${name} job is not restricted to main-branch pushes`);
    }
  }

  return violations;
}

/**
 * Validate the exact-commit release invariant.
 *
 * `changesets/action` prepares a version branch from `github.context.sha`, not
 * from the preceding checkout alone. For `workflow_run`, that SHA is the
 * default-branch tip captured by the event. The gate must therefore prove it is
 * identical to the CI-tested `head_sha` before any version or publish job runs.
 */
export function findReleaseWorkflowViolations(
  releaseWorkflow: string,
  ciWorkflow: string,
): readonly string[] {
  const violations = [
    ...findCiWorkflowViolations(ciWorkflow),
    ...findNonImmutableActionReferences(releaseWorkflow, 'release'),
  ];
  if (
    !has(
      releaseWorkflow,
      /workflow_run:\s*workflows:\s*\[\s*CI\s*\]\s*types:\s*\[\s*completed\s*\]/,
    )
  ) {
    violations.push('release is not triggered by completed CI workflows');
  }
  if (
    !has(
      releaseWorkflow,
      /concurrency:\s*group:\s*release-\$\{\{\s*github\.event\.workflow_run\.head_branch\s*\}\}\s*cancel-in-progress:\s*false/,
    )
  ) {
    violations.push('release workflow can cancel an in-flight publish');
  }
  if (!has(releaseWorkflow, /permissions:\s*\{\}/)) {
    violations.push('release workflow does not default to empty permissions');
  }

  const gate = jobBlock(releaseWorkflow, 'gate');
  if (gate === undefined) {
    violations.push('missing gate job');
    return violations;
  }
  const gateCondition = jobCondition(gate);

  const gateConditions: readonly [label: string, pattern: RegExp][] = [
    ['successful CI conclusion', /github\.event\.workflow_run\.conclusion\s*==\s*['"]success['"]/],
    ['push event', /github\.event\.workflow_run\.event\s*==\s*['"]push['"]/],
    ['main branch', /github\.event\.workflow_run\.head_branch\s*==\s*['"]main['"]/],
    [
      'same repository',
      /github\.event\.workflow_run\.head_repository\.full_name\s*==\s*github\.repository/,
    ],
    ['exact tested commit', /github\.event\.workflow_run\.head_sha\s*==\s*github\.sha/],
  ];
  for (const [label, pattern] of gateConditions) {
    if (!has(gateCondition, pattern)) violations.push(`gate does not require ${label}`);
  }
  if (
    !has(gate, /for\s+changeset\s+in\s+\.changeset\/\*\.md/) ||
    !has(gate, /["']\$changeset["']\s*!=\s*["']\.changeset\/README\.md["']/)
  ) {
    violations.push('gate does not exclude only the Changesets README');
  }
  requirePatterns(
    gate,
    'release gate job',
    [
      ['does not use read-only contents permission', /permissions:\s*contents:\s*read/],
      [
        'does not install the repository npm version',
        /run:\s*npm install --global .*packageManager/,
      ],
    ],
    violations,
  );
  if (
    !has(gate, /registry_result=\$\(npm view "\$name@\$version" version 2>&1\)/) ||
    !has(gate, /registry_status=\$\?/) ||
    !has(gate, /elif echo "\$registry_result" \| grep -q ['"]E404['"]; then/) ||
    !has(gate, /else .*exit "\$registry_status" .*fi/) ||
    has(gate, /npm view .*\|\|\s*true/)
  ) {
    violations.push('release registry lookup does not fail closed');
  }
  if (
    !has(
      gate,
      /if \[ ["']\$released["'] = ["']true["'] \]; then.*if \[ ["']\$tagged["'] != ["']true["'] \]; then.*publish=false.*elif \[ ["']\$tagged["'] = ["']true["'] \] && \[ ["']\$tagged_sha["'] != ["']\$TESTED_SHA["'] \]; then.*exit 1.*else.*publish=true/,
    )
  ) {
    violations.push(
      'release reconciliation does not preserve completed historical releases as a no-op',
    );
  }

  for (const name of ['gate', 'version', 'publish'] as const) {
    const block = jobBlock(releaseWorkflow, name);
    if (block === undefined) {
      violations.push(`missing ${name} job`);
      continue;
    }
    if (name !== 'gate') {
      if (!has(block, /needs:\s*gate/)) violations.push(`${name} job does not depend on gate`);
      if (!has(jobCondition(block), /github\.event\.workflow_run\.head_sha\s*==\s*github\.sha/)) {
        violations.push(`${name} job does not require the exact tested commit`);
      }
    }
    if (!has(block, /ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/)) {
      violations.push(`${name} job does not check out the tested commit`);
    }
    if (!has(block, /TESTED_SHA:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/)) {
      violations.push(`${name} job does not verify the tested commit`);
    }
    if (!has(block, /git\s+rev-parse\s+HEAD/) || !has(block, /\$TESTED_SHA/)) {
      violations.push(`${name} job does not compare its checkout with the tested commit`);
    }
    if (name !== 'gate') {
      requirePatterns(
        block,
        `${name} job`,
        [
          [
            'does not install the repository npm version',
            /run:\s*npm install --global .*packageManager/,
          ],
          ['does not run npm ci', /run:\s*npm ci(?:\s|$)/],
        ],
        violations,
      );
    }
  }

  const version = jobBlock(releaseWorkflow, 'version');
  if (version !== undefined) {
    requirePatterns(
      version,
      'version job',
      [
        ['does not grant contents write', /permissions:\s*contents:\s*write/],
        ['does not grant pull-requests write', /pull-requests:\s*write/],
        ['does not run Changesets', /uses:\s*changesets\/action@[a-fA-F0-9]{40}/],
        ['does not delegate versioning to npm run version', /version:\s*npm run version/],
      ],
      violations,
    );
  }

  const publish = jobBlock(releaseWorkflow, 'publish');
  if (publish !== undefined) {
    requirePatterns(
      publish,
      'publish job',
      [
        ['does not grant id-token write', /id-token:\s*write/],
        ['does not grant artifact read access', /actions:\s*read/],
        ['does not pin the release verifier Node version', /node-version:\s*22\.23\.2/],
        ['does not run Changesets', /uses:\s*changesets\/action@[a-fA-F0-9]{40}/],
        ['does not publish the exact verified tarball', /publish:\s*npm run release/],
        [
          'does not enable Changesets tag/GitHub Release reconciliation',
          /createGithubReleases:\s*true/,
        ],
        ['does not request provenance', /NPM_CONFIG_PROVENANCE:\s*['"]true['"]/],
        [
          'does not download the triggering CI run artifact',
          /uses:\s*actions\/download-artifact@[a-fA-F0-9]{40}.*name:\s*release-candidate-\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}.*github-token:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}.*run-id:\s*\$\{\{\s*github\.event\.workflow_run\.id\s*\}\}/,
        ],
        [
          'does not recheck the downloaded tarball',
          /npm run test:package -- --tarball ["']?\$\{tarballs\[0\]\}["']? --source-commit ["']?\$TESTED_SHA["']?/,
        ],
        [
          'does not bind the publisher to the tested artifact source',
          /PACKAGE_ARTIFACT_DIR:\s*release-artifact.*PACKAGE_SOURCE_COMMIT:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}.*SOURCE_DATE_EPOCH:\s*\$\{\{\s*steps\.source_date\.outputs\.epoch\s*\}\}/,
        ],
      ],
      violations,
    );
  }

  return violations;
}
