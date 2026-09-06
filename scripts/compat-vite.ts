/**
 * The Vite half of the compatibility record, as pure functions.
 *
 * Why it is recorded at all: on 2026-09-06 the devDependency stood at `^7.3.6`
 * while every fixture lockfile installed 8.2.2, because three of the four
 * supported Astro majors pull Vite 8. Nothing failed, because nothing was
 * comparing the two. These are the comparisons.
 *
 * Only majors are compared. A full semver satisfier would be a dependency and
 * a second source of truth about ranges; what this gate answers is "is the
 * bundler we develop against the one our users have", and that is a question
 * about majors.
 */

export interface RecordedVite {
  /** The framework whose major brings it, for the message. */
  readonly framework: string;
  /** That framework major. */
  readonly major: number;
  /** The Vite range it declares, verbatim from the registry. */
  readonly range: string;
}

export interface ViteFacts {
  readonly recorded: readonly RecordedVite[];
  /** `devDependencies.vite` in the root manifest. */
  readonly dev: string;
  /** What each fixture's lockfile actually installed. */
  readonly lockfiles: readonly { readonly fixture: string; readonly version: string }[];
}

/** Every major a range mentions: `^5.0.3 || ^8.0.0` yields 5 and 8. */
export function majorsIn(range: string): readonly number[] {
  const majors = new Set<number>();
  for (const match of range.matchAll(/(\d+)\.\d+/gu)) majors.add(Number(match[1]));
  return [...majors].sort((left, right) => left - right);
}

/** The inclusive major span a set of ranges covers, or undefined when none names one. */
export function majorSpan(
  ranges: readonly string[],
): { readonly min: number; readonly max: number } | undefined {
  const majors = ranges.flatMap((range) => [...majorsIn(range)]);
  if (majors.length === 0) return undefined;
  return { min: Math.min(...majors), max: Math.max(...majors) };
}

/**
 * The span a `>=x <y` peer range allows, in majors. `<8.0.0` excludes 8, while
 * `<8.1.0` does not — hence the second capture.
 */
export function peerMajorSpan(
  range: string,
): { readonly min: number; readonly max: number } | undefined {
  const lower = /(?:>=|\^)\s*(\d+)\./u.exec(range);
  const upper = /<\s*(\d+)\.(\d+)/u.exec(range);
  if (lower === null) return undefined;
  const min = Number(lower[1]);
  if (upper === null) return { min, max: Number.POSITIVE_INFINITY };
  const boundary = Number(upper[1]);
  return { min, max: Number(upper[2]) === 0 ? boundary - 1 : boundary };
}

/** A framework major the package claims to support must be inside its declared peer range. */
export function peerCoverageProblems(
  frameworks: readonly {
    readonly name: string;
    readonly package: string;
    readonly majors: readonly number[];
  }[],
  peerRanges: Readonly<Record<string, string>>,
): readonly string[] {
  const problems: string[] = [];
  for (const framework of frameworks) {
    const range = peerRanges[framework.package];
    if (range === undefined) continue;
    const span = peerMajorSpan(range);
    if (span === undefined) continue;
    const outside = framework.majors.filter((major) => major < span.min || major > span.max);
    if (outside.length > 0) {
      problems.push(
        `${framework.name}: the matrix tests ${outside.join(', ')}, which the optional peer range \`${range}\` does not cover`,
      );
    }
  }
  return problems;
}

/**
 * Three ways the record and the repository can disagree, each one a way the
 * 2026-09-06 drift could recur.
 */
export function viteProblems(facts: ViteFacts): readonly string[] {
  const problems: string[] = [];
  const span = majorSpan(facts.recorded.map((entry) => entry.range));
  if (span === undefined) return ['Vite: the matrix records no version for any framework major'];

  const dev = majorsIn(facts.dev);
  const devMajor = dev.at(-1);
  if (devMajor === undefined) {
    problems.push(`Vite: devDependencies.vite is \`${facts.dev}\`, which names no major`);
  } else if (devMajor < span.max) {
    const newest = facts.recorded.filter((entry) => majorsIn(entry.range).includes(span.max));
    const brings = newest.map((entry) => `${entry.framework} ${String(entry.major)}`).join(', ');
    problems.push(
      `Vite: devDependencies.vite is \`${facts.dev}\` but ${brings} installs Vite ${String(span.max)}; ` +
        'develop against what they run, or record why not',
    );
  }

  for (const lockfile of facts.lockfiles) {
    const major = majorsIn(lockfile.version)[0];
    if (major === undefined) continue;
    if (major < span.min || major > span.max) {
      problems.push(
        `Vite: ${lockfile.fixture} installs ${lockfile.version}, outside the recorded ${String(span.min)}–${String(span.max)}`,
      );
    }
  }
  return problems;
}

/** The sentence the README carries, built from the record rather than written beside it. */
export function renderViteLine(facts: ViteFacts, measured: string): string {
  const span = majorSpan(facts.recorded.map((entry) => entry.range));
  if (span === undefined) return '';
  const brings = facts.recorded
    .map(
      (entry) => `${entry.framework} ${String(entry.major)} → ${majorsIn(entry.range).join('/')}`,
    )
    .join(', ');
  return (
    `Vite ${String(span.min)} through ${String(span.max)}: that is what the supported framework majors install ` +
    `(${brings}), measured ${measured}. \`npm run compat:check\` keeps the devDependency and the fixture ` +
    'lockfiles inside that span; `npm run compat:refresh` re-reads it from the registry.'
  );
}
