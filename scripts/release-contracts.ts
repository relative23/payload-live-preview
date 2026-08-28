/**
 * Manifest, lockfile and install-policy contracts shared by the package gate
 * and its tests. They inspect data, never the shipped runtime, so a release
 * cannot become permissive because npm reinterprets a default.
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

// Online, because a fresh npm cache can hold the peer's tarball without the
// registry metadata a new consumer needs; the archive itself still installs offline.
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

// Deliberately duplicates each manifest's allowScripts verdicts: a lockfile
// refresh must not broaden the policy without a review here too.
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

/** Metadata only: dependency resolution stays with reviewed npm installs. */
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

/** Drop ambient npm settings that could disable scripts or bypass reviewed verdicts. */
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
 * A consumer nested below this repository would resolve undeclared imports
 * from the maintainer node_modules. Ancestry, not a path prefix, decides.
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
