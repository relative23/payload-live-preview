/** Critical-file baselines, diff coverage and monotonic-ratchet checks. */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import rawCoveragePolicy from '../quality/coverage-policy.json' with { type: 'json' };

export interface CoverageThresholds {
  readonly lines: number;
  readonly functions: number;
  readonly branches: number;
  readonly statements?: number;
}

export interface CoveragePolicy {
  readonly schemaVersion: 1;
  readonly global: Required<CoverageThresholds>;
  readonly criticalFiles: Readonly<Record<string, CoverageThresholds>>;
  readonly diff: {
    readonly lines: number;
    readonly criticalLines: number;
    readonly ignored: readonly string[];
  };
}

export interface LcovFile {
  readonly path: string;
  readonly lineHits: ReadonlyMap<number, number>;
}

export interface DiffCoverageFile {
  readonly path: string;
  readonly executable: number;
  readonly covered: number;
}

export interface DiffCoverageResult {
  readonly files: readonly DiffCoverageFile[];
  readonly executable: number;
  readonly covered: number;
  readonly percentage: number;
  readonly criticalExecutable: number;
  readonly criticalCovered: number;
  readonly criticalPercentage: number;
  readonly violations: readonly string[];
}

export const COVERAGE_POLICY = rawCoveragePolicy as CoveragePolicy;

function percentage(covered: number, executable: number): number {
  return executable === 0 ? 100 : (covered / executable) * 100;
}

export function parseLcov(source: string, repositoryRoot = ''): ReadonlyMap<string, LcovFile> {
  const files = new Map<string, LcovFile>();
  for (const record of source.split('end_of_record')) {
    const sourcePath = /^SF:(.+)$/mu.exec(record)?.[1];
    if (sourcePath === undefined) continue;
    const normalized = (
      repositoryRoot.length > 0 && sourcePath.startsWith(repositoryRoot)
        ? relative(repositoryRoot, sourcePath)
        : sourcePath
    ).replaceAll('\\', '/');
    const hits = new Map<number, number>();
    for (const match of record.matchAll(/^DA:(\d+),(\d+)/gmu)) {
      hits.set(Number(match[1]), Number(match[2]));
    }
    files.set(normalized, { path: normalized, lineHits: hits });
  }
  return files;
}

export function parseChangedLines(diff: string): ReadonlyMap<string, ReadonlySet<number>> {
  const changed = new Map<string, Set<number>>();
  let path: string | undefined;
  let nextNewLine: number | undefined;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      path = undefined;
      nextNewLine = undefined;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4);
      path = target === '/dev/null' ? undefined : target.replace(/^b\//u, '');
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (hunk !== null) {
      nextNewLine = Number(hunk[1]);
      continue;
    }
    if (path === undefined || nextNewLine === undefined) continue;
    if (line.startsWith('+')) {
      const lines = changed.get(path) ?? new Set<number>();
      lines.add(nextNewLine);
      changed.set(path, lines);
      nextNewLine += 1;
    } else if (!line.startsWith('-') && !line.startsWith('\\ No newline')) {
      nextNewLine += 1;
    }
  }

  return changed;
}

export function addUntrackedChangedLines(
  changedLines: ReadonlyMap<string, ReadonlySet<number>>,
  untrackedFiles: ReadonlyMap<string, number>,
): ReadonlyMap<string, ReadonlySet<number>> {
  const combined = new Map(
    [...changedLines].map(([path, lines]) => [path, new Set(lines)] as const),
  );
  for (const [path, lineCount] of untrackedFiles) {
    const lines = combined.get(path) ?? new Set<number>();
    for (let line = 1; line <= lineCount; line += 1) lines.add(line);
    combined.set(path, lines);
  }
  return combined;
}

export function matchesPolicyGlob(path: string, glob: string): boolean {
  let expression = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]!;
    if (character === '*' && glob[index + 1] === '*') {
      if (glob[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
    } else if (character === '*') expression += '[^/]*';
    else if (character === '?') expression += '[^/]';
    else expression += character.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
  }
  return new RegExp(`${expression}$`, 'u').test(path);
}

/**
 * Whether every path `narrow` can match is also matched by `broad`, decided
 * on a representative path; a `**` in `narrow` against a single `*` in
 * `broad` is conservatively not covered.
 */
export function globCovers(broad: string, narrow: string): boolean {
  const sample = narrow.replaceAll('**', 'zz/zz').replaceAll('*', 'zz').replaceAll('?', 'z');
  return matchesPolicyGlob(sample, broad);
}

/**
 * Whether a module contributes any JavaScript. A file that declares only types
 * transpiles to nothing, so no coverage tool can report it and demanding a
 * report from it says nothing about how well it is tested.
 */
/**
 * File types vitest never executes, so the unit LCOV cannot contain them
 * whatever they hold. Today that is the Astro components: Astro compiles them,
 * and the browser suite on the astro-payload fixture is what exercises them —
 * a verdict that is not a line count and cannot be one.
 */
export function neverInstrumented(path: string): boolean {
  return path.endsWith('.astro');
}

export function emitsJavaScript(source: string): boolean {
  const { outputText } = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.ESNext,
      target: ScriptTarget.ESNext,
      // Comments survive transpilation and would read as emitted code.
      removeComments: true,
    },
  });
  return outputText.replaceAll(/export\s*\{\s*\};?/gu, '').trim().length > 0;
}

/**
 * Drops modules this toolchain can never put into the LCOV report, so "absent
 * from the LCOV report" keeps meaning untested code: declaration-only modules,
 * which emit no JavaScript, and the file types `neverInstrumented` names.
 * `diff.ignored` is not the place for either — against the base branch that
 * list may only narrow, by design.
 */
async function withoutDeclarationOnlyModules(
  changedLines: ReadonlyMap<string, ReadonlySet<number>>,
  repositoryRoot: string,
): Promise<Map<string, ReadonlySet<number>>> {
  const kept = new Map<string, ReadonlySet<number>>();
  for (const [path, lines] of changedLines) {
    if (neverInstrumented(path)) continue;
    let source: string;
    try {
      source = await readFile(resolve(repositoryRoot, path), 'utf8');
    } catch {
      // Unreadable is not something this gate may excuse.
      kept.set(path, lines);
      continue;
    }
    if (emitsJavaScript(source)) kept.set(path, lines);
  }
  return kept;
}

export function evaluateDiffCoverage(
  lcovFiles: ReadonlyMap<string, LcovFile>,
  changedLines: ReadonlyMap<string, ReadonlySet<number>>,
  policy: CoveragePolicy = COVERAGE_POLICY,
): DiffCoverageResult {
  const files: DiffCoverageFile[] = [];
  const violations: string[] = [];

  for (const [path, lines] of [...changedLines].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!path.startsWith('src/')) continue;
    if (policy.diff.ignored.some((glob) => matchesPolicyGlob(path, glob))) continue;
    const coverage = lcovFiles.get(path);
    if (coverage === undefined) {
      violations.push(`${path} is changed but absent from the LCOV report`);
      continue;
    }
    const executableLines = [...lines].filter((line) => coverage.lineHits.has(line));
    const covered = executableLines.filter((line) => (coverage.lineHits.get(line) ?? 0) > 0).length;
    if (executableLines.length > 0) {
      files.push({ path, executable: executableLines.length, covered });
    }
  }

  const executable = files.reduce((total, file) => total + file.executable, 0);
  const covered = files.reduce((total, file) => total + file.covered, 0);
  const criticalFiles = new Set(Object.keys(policy.criticalFiles));
  const criticalExecutable = files
    .filter(({ path }) => criticalFiles.has(path))
    .reduce((total, file) => total + file.executable, 0);
  const criticalCovered = files
    .filter(({ path }) => criticalFiles.has(path))
    .reduce((total, file) => total + file.covered, 0);
  const overallPercentage = percentage(covered, executable);
  const criticalPercentage = percentage(criticalCovered, criticalExecutable);

  if (executable > 0 && overallPercentage + Number.EPSILON < policy.diff.lines) {
    violations.push(
      `changed-line coverage ${overallPercentage.toFixed(2)}% is below ${String(policy.diff.lines)}%`,
    );
  }
  if (criticalExecutable > 0 && criticalPercentage + Number.EPSILON < policy.diff.criticalLines) {
    violations.push(
      `critical changed-line coverage ${criticalPercentage.toFixed(2)}% is below ${String(policy.diff.criticalLines)}%`,
    );
  }

  return {
    files,
    executable,
    covered,
    percentage: overallPercentage,
    criticalExecutable,
    criticalCovered,
    criticalPercentage,
    violations,
  };
}

/** Thresholds only ratchet up; an ignore pattern may only be removed or narrowed. */
export function findCoveragePolicyRegressions(
  current: CoveragePolicy,
  previous: CoveragePolicy,
): readonly string[] {
  const regressions: string[] = [];
  for (const metric of ['lines', 'functions', 'branches', 'statements'] as const) {
    if (current.global[metric] < previous.global[metric]) {
      regressions.push(`global.${metric} was lowered`);
    }
  }
  if (current.diff.lines < previous.diff.lines) regressions.push('diff.lines was lowered');
  if (current.diff.criticalLines < previous.diff.criticalLines) {
    regressions.push('diff.criticalLines was lowered');
  }
  for (const pattern of current.diff.ignored) {
    if (!previous.diff.ignored.some((broad) => globCovers(broad, pattern))) {
      regressions.push(`diff ignored pattern was added: ${pattern}`);
    }
  }

  for (const [path, previousThresholds] of Object.entries(previous.criticalFiles)) {
    const currentThresholds = current.criticalFiles[path];
    if (currentThresholds === undefined) {
      regressions.push(`critical file baseline was removed: ${path}`);
      continue;
    }
    for (const metric of ['lines', 'functions', 'branches'] as const) {
      if (currentThresholds[metric] < previousThresholds[metric]) {
        regressions.push(`${path}.${metric} was lowered`);
      }
    }
  }
  return regressions;
}

function readArgument(name: string): string | undefined {
  const equals = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (equals !== undefined) return equals.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readPreviousPolicy(base: string): CoveragePolicy | undefined {
  try {
    const source = execFileSync('git', ['show', `${base}:quality/coverage-policy.json`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(source) as CoveragePolicy;
  } catch {
    return undefined;
  }
}

function gitOutput(repositoryRoot: string, arguments_: readonly string[]): string {
  return execFileSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The commit whose lines this run is measured against.
 *
 * A force-push leaves the pushed-from commit outside the repository, and so
 * does a rebased branch; the base CI hands over then names nothing. The push
 * still changed lines, so the parent commit answers the question the gate
 * actually asks. Failing instead would block a branch over its history rather
 * than over its coverage, which is what a rewrite of two commit messages did.
 */
export function resolveComparisonBase(
  requestedBase: string | undefined,
  git: (arguments_: readonly string[]) => string,
  environment: { readonly ci: boolean; readonly warn: (message: string) => void },
): string {
  if (requestedBase === undefined) {
    if (environment.ci) {
      throw new Error(
        'coverage diff base is required in CI; pass --base <ref> or COVERAGE_BASE_REF',
      );
    }
    return 'HEAD';
  }
  try {
    const mergeBase = git(['merge-base', requestedBase, 'HEAD']).trim();
    if (mergeBase.length === 0) throw new Error('empty merge base');
    return mergeBase;
  } catch {
    let parent: string;
    try {
      parent = git(['rev-parse', 'HEAD~1']).trim();
      if (parent.length === 0) throw new Error('empty parent');
    } catch (parentError) {
      throw new Error(
        `cannot resolve coverage diff base ${requestedBase}, and HEAD has no parent to measure against`,
        { cause: parentError },
      );
    }
    environment.warn(
      `[coverage] base ${requestedBase} is not in this repository, which is what a force-push ` +
        `or a rebase leaves behind; measuring against the parent commit ${parent} instead.`,
    );
    return parent;
  }
}

async function readUntrackedSourceLines(
  repositoryRoot: string,
): Promise<ReadonlyMap<string, number>> {
  const output = gitOutput(repositoryRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    'src',
  ]);
  const files = output.split('\n').filter((path) => path.length > 0);
  const lineCounts = new Map<string, number>();
  for (const path of files) {
    const source = await readFile(resolve(repositoryRoot, path), 'utf8');
    const lines =
      source.length === 0 ? 0 : source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
    lineCounts.set(path.replaceAll('\\', '/'), lines);
  }
  return lineCounts;
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const requestedBase = readArgument('--base') ?? process.env['COVERAGE_BASE_REF'];
  const base = resolveComparisonBase(
    requestedBase,
    (arguments_) => gitOutput(repositoryRoot, arguments_),
    {
      ci: process.env['CI'] === 'true',
      warn: (message) => {
        console.warn(message);
      },
    },
  );
  const lcovPath = resolve(repositoryRoot, readArgument('--lcov') ?? 'coverage/lcov.info');
  // Git diff omits untracked files, so they are added explicitly below.
  const diff = gitOutput(repositoryRoot, [
    'diff',
    '--unified=0',
    '--find-renames',
    '--diff-filter=ACMR',
    base,
    '--',
    'src',
  ]);
  const changedLines = addUntrackedChangedLines(
    parseChangedLines(diff),
    await readUntrackedSourceLines(repositoryRoot),
  );
  const lcov = parseLcov(await readFile(lcovPath, 'utf8'), repositoryRoot);
  const result = evaluateDiffCoverage(
    lcov,
    await withoutDeclarationOnlyModules(changedLines, repositoryRoot),
  );
  const previous = readPreviousPolicy(base);
  const regressions =
    previous === undefined ? [] : findCoveragePolicyRegressions(COVERAGE_POLICY, previous);
  const failures = [...result.violations, ...regressions];

  if (failures.length > 0) {
    throw new Error(
      `coverage policy failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`,
    );
  }
  console.log(
    `Diff coverage passed: ${result.percentage.toFixed(2)}% (${String(result.covered)}/${String(result.executable)}) changed executable lines; critical ${result.criticalPercentage.toFixed(2)}% (${String(result.criticalCovered)}/${String(result.criticalExecutable)}).`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
