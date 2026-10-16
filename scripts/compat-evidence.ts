/**
 * Pure contracts for the feature-specific compatibility record. The caller
 * supplies repository facts, so the gate stays offline and the tests can prove
 * that configuration, skipped work and executed results remain distinct.
 */

export const REQUIRED_COMPAT_SURFACES = [
  'Astro',
  'Next.js',
  'SvelteKit',
  'Nuxt',
  'Plain HTML',
  'React hook',
  'Vue composable',
  'Payload plugin',
  'Public entries',
  'Tooling',
] as const;

export type CompatSurface = (typeof REQUIRED_COMPAT_SURFACES)[number];

export type VersionSource =
  | { readonly kind: 'root-package' }
  | { readonly kind: 'lockfile'; readonly fixture: string }
  | { readonly kind: 'peer-floor' }
  | { readonly kind: 'declared-feature-floor' }
  | {
      readonly kind: 'script-pin';
      readonly file: string;
      readonly identifier: string;
    }
  | {
      readonly kind: 'workflow-matrix';
      readonly file: string;
      readonly job: string;
      readonly key: string;
    };

export interface CompatVersion {
  /** Runtime-validated because this interface describes parsed JSON. */
  readonly kind: string;
  readonly value: string;
  readonly package: string;
  readonly source: VersionSource;
  /** A floating install is recorded as a limitation, never as the resolved version. */
  readonly configuredRange?: string;
}

export interface CompatResult {
  readonly path: string;
  readonly sha256: string;
  readonly commit: string;
  readonly executedAt: string;
  /** Runtime-validated because a skipped result must not masquerade as success. */
  readonly conclusion: string;
}

export interface CompatEvidenceCell {
  readonly id: string;
  readonly surface: CompatSurface;
  readonly feature: string;
  readonly version: CompatVersion;
  readonly mode: string;
  readonly packageForm: string;
  readonly backend: string;
  readonly browsers: readonly string[];
  readonly entries?: readonly string[];
  readonly bins?: readonly string[];
  readonly evidence: {
    readonly status: string;
    readonly workflow?: { readonly file: string; readonly job: string };
    readonly command?: string;
    readonly sources: readonly string[];
    readonly result?: CompatResult;
  };
}

export interface CompatEvidenceFacts {
  readonly repositoryVersion: string;
  readonly peerFloors: Readonly<Record<string, string | undefined>>;
  /** Key: `fixture\0package`. */
  readonly lockfileVersions: Readonly<Record<string, string | undefined>>;
  /** Key: `file\0job`. */
  readonly workflowJobs: Readonly<
    Record<
      string,
      | {
          readonly conditional: boolean;
          readonly continueOnError: boolean;
        }
      | undefined
    >
  >;
  /** Key: `file\0job\0matrix-key`. */
  readonly workflowMatrixValues?: Readonly<Record<string, readonly string[] | undefined>>;
  /** Key: `file\0identifier`. */
  readonly scriptPins?: Readonly<Record<string, readonly string[] | undefined>>;
  readonly availablePaths: ReadonlySet<string>;
  readonly resultDigests: Readonly<Record<string, string | undefined>>;
  readonly publicEntries: readonly string[];
  readonly toolingEntries: readonly string[];
  readonly publicBins: readonly string[];
}

const MODES = new Set<string>(['development', 'production', 'unit', 'package-smoke']);
const PACKAGE_FORMS = new Set<string>([
  'copied-local-package',
  'linked-worktree',
  'workspace-source',
  'packed-tarball',
]);
const BROWSERS = new Set(['chromium', 'firefox', 'webkit', 'node']);
const STATUSES = new Set<string>(['configured', 'open', 'passed', 'skipped', 'watch-only']);
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

/** Read one explicit semver tuple without evaluating the script that owns it. */
export function scriptSemverPins(
  source: string,
  identifier: string,
): readonly string[] | undefined {
  if (!IDENTIFIER.test(identifier)) return undefined;
  const declaration = new RegExp(
    String.raw`(?:^|\n)\s*(?:export\s+)?const\s+${identifier}\s*=\s*\[([^\]]*)\]\s*as\s+const\s*;?`,
    'u',
  ).exec(source);
  if (declaration === null) return undefined;
  const body = declaration[1] ?? '';
  const literal = /(['"])([^'"\\]*)\1/gu;
  const values = [...body.matchAll(literal)].map((match) => match[2] ?? '');
  const remainder = body.replace(literal, '').replace(/[\s,]/gu, '');
  if (remainder !== '' || values.length === 0 || values.some((value) => !SEMVER.test(value))) {
    return undefined;
  }
  return values;
}

/** The exact lower bound of a `>=x` peer range, with optional upper clauses. */
export function peerFloor(range: string): string | undefined {
  const match = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\s+<\s*\d+(?:\.\d+){0,2})?\s*$/u.exec(range);
  if (match === null) return undefined;
  return `${match[1] ?? '0'}.${match[2] ?? '0'}.${match[3] ?? '0'}`;
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return sorted(left).join('\u0000') === sorted(right).join('\u0000');
}

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function versionProblem(cell: CompatEvidenceCell, facts: CompatEvidenceFacts): string | undefined {
  const { version } = cell;
  if (version.kind !== 'exact' && version.kind !== 'floor') {
    return `${cell.id}: version kind must be exact or floor`;
  }
  if (!SEMVER.test(version.value)) {
    return `${cell.id}: version ${version.value} is not exact semver`;
  }
  if (version.package.trim() === '') return `${cell.id}: version package is missing`;
  const source = version.source;
  if (source.kind === 'declared-feature-floor') {
    return version.kind === 'floor'
      ? undefined
      : `${cell.id}: a declared feature floor must use version kind floor`;
  }
  if (source.kind === 'root-package') {
    return facts.repositoryVersion === version.value
      ? undefined
      : `${cell.id}: records package version ${version.value}, package.json declares ${facts.repositoryVersion}`;
  }
  if (source.kind === 'peer-floor') {
    const actual = facts.peerFloors[version.package];
    return actual === version.value
      ? undefined
      : `${cell.id}: records peer floor ${version.value}, package.json declares ${String(actual)}`;
  }
  if (source.kind === 'lockfile') {
    const actual = facts.lockfileVersions[`${source.fixture}\u0000${version.package}`];
    return actual === version.value
      ? undefined
      : `${cell.id}: records ${version.package} ${version.value}, ${source.fixture} lockfile has ${String(actual)}`;
  }
  if (source.kind === 'script-pin') {
    const values = facts.scriptPins?.[`${source.file}\u0000${source.identifier}`] ?? [];
    return values.includes(version.value)
      ? undefined
      : `${cell.id}: ${source.file} constant ${source.identifier} does not pin ${version.value}`;
  }
  const values =
    facts.workflowMatrixValues?.[`${source.file}\u0000${source.job}\u0000${source.key}`] ?? [];
  return values.includes(version.value)
    ? undefined
    : `${cell.id}: ${source.file} job ${source.job} does not matrix-test ${version.value}`;
}

function isSuccessfulResult(result: CompatResult | undefined): result is CompatResult {
  return (
    result?.conclusion === 'success' &&
    SHA256.test(result.sha256) &&
    COMMIT.test(result.commit) &&
    !Number.isNaN(Date.parse(result.executedAt))
  );
}

function evidenceProblems(cell: CompatEvidenceCell, facts: CompatEvidenceFacts): readonly string[] {
  const problems: string[] = [];
  const evidence = cell.evidence;
  if (!STATUSES.has(evidence.status)) {
    return [`${cell.id}: evidence status is invalid`];
  }
  if (evidence.sources.length === 0) {
    problems.push(`${cell.id}: evidence sources are empty`);
  } else {
    for (const path of evidence.sources) {
      if (!facts.availablePaths.has(path)) {
        problems.push(`${cell.id}: evidence source is missing: ${path}`);
      }
    }
  }
  if (evidence.status === 'configured' && evidence.workflow === undefined && !evidence.command) {
    problems.push(`${cell.id}: configured evidence has neither workflow nor command`);
  }
  if (evidence.workflow !== undefined) {
    const job = facts.workflowJobs[`${evidence.workflow.file}\u0000${evidence.workflow.job}`];
    if (job === undefined) {
      problems.push(
        `${cell.id}: workflow job is missing: ${evidence.workflow.file}#${evidence.workflow.job}`,
      );
    } else {
      if (job.conditional) problems.push(`${cell.id}: references a conditional workflow job`);
      if (job.continueOnError) {
        problems.push(`${cell.id}: references a workflow job that may fail softly`);
      }
    }
  }
  const result = evidence.result;
  if (cell.version.configuredRange !== undefined && evidence.status === 'passed') {
    problems.push(`${cell.id}: a floating configured range cannot be passed evidence`);
  }
  if (evidence.status === 'passed') {
    if (!isSuccessfulResult(result)) {
      problems.push(`${cell.id}: passed evidence needs an immutable successful result`);
    } else {
      if (!facts.availablePaths.has(result.path)) {
        problems.push(`${cell.id}: result artifact is missing: ${result.path}`);
      }
      const digest = facts.resultDigests[result.path];
      if (digest !== result.sha256) {
        problems.push(`${cell.id}: result digest is ${String(digest)}, expected ${result.sha256}`);
      }
    }
  } else if (result !== undefined) {
    problems.push(`${cell.id}: only passed evidence may carry a successful result`);
  }
  return problems;
}

function inventoryProblems(
  cells: readonly CompatEvidenceCell[],
  facts: CompatEvidenceFacts,
): readonly string[] {
  const problems: string[] = [];
  for (const surface of REQUIRED_COMPAT_SURFACES) {
    if (!cells.some((cell) => cell.surface === surface)) {
      problems.push(`compat evidence has no ${surface} cell`);
    }
  }
  const publicEntries = cells
    .filter((cell) => cell.surface === 'Public entries')
    .flatMap((cell) => [...(cell.entries ?? [])]);
  if (
    !sameValues(publicEntries, facts.publicEntries) ||
    duplicateValues(publicEntries).length > 0
  ) {
    problems.push('public entry inventory differs from package.json exports');
  }
  const toolingEntries = cells
    .filter((cell) => cell.surface === 'Tooling')
    .flatMap((cell) => [...(cell.entries ?? [])]);
  if (
    !sameValues(toolingEntries, facts.toolingEntries) ||
    duplicateValues(toolingEntries).length > 0
  ) {
    problems.push('tooling entry inventory differs from the reviewed tooling exports');
  }
  const bins = cells
    .filter((cell) => cell.surface === 'Tooling')
    .flatMap((cell) => [...(cell.bins ?? [])]);
  if (!sameValues(bins, facts.publicBins) || duplicateValues(bins).length > 0) {
    problems.push('tooling executable inventory differs from package.json bin');
  }
  return problems;
}

/** Report every drift without throwing so `compat:check` can print one actionable list. */
export function featureEvidenceProblems(
  cells: readonly CompatEvidenceCell[],
  facts: CompatEvidenceFacts,
): readonly string[] {
  const problems = [...inventoryProblems(cells, facts)];
  const ids = new Set<string>();
  for (const cell of cells) {
    if (cell.id.trim() === '') problems.push('compat evidence cell has no id');
    else if (ids.has(cell.id)) problems.push(`compat evidence id is duplicated: ${cell.id}`);
    ids.add(cell.id);
    if (cell.feature.trim() === '') problems.push(`${cell.id}: feature is missing`);
    const version = versionProblem(cell, facts);
    if (version !== undefined) problems.push(version);
    if (!MODES.has(cell.mode)) problems.push(`${cell.id}: mode is invalid`);
    if (!PACKAGE_FORMS.has(cell.packageForm)) problems.push(`${cell.id}: package form is invalid`);
    if (cell.backend.trim() === '') problems.push(`${cell.id}: backend is missing`);
    if (cell.browsers.length === 0) {
      problems.push(`${cell.id}: browser list is empty`);
    } else {
      for (const browser of cell.browsers) {
        if (!BROWSERS.has(browser)) problems.push(`${cell.id}: browser is invalid: ${browser}`);
      }
    }
    problems.push(...evidenceProblems(cell, facts));
  }
  return problems;
}
