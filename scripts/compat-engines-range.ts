/**
 * The `engines.node` ranges of a lockfile, read the way npm reads them. npm decides with
 * node-semver; this reads the part of its grammar engines ranges use, on release versions only, and
 * answers undefined for anything else, so `compat-engines.ts` refuses a range rather than guess at it.
 * A dependency would be a second source of truth about ranges for one comparison.
 */

type Version = readonly [number, number, number];
type Part = number | undefined;
type Comparator = readonly ['<' | '<=' | '>' | '>=' | '=', Version];

const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/u;
const OPERATOR = /^(<=|>=|<|>|=|~>|~|\^)?(.*)$/u;

function partial(text: string): readonly Part[] | undefined {
  const match = PARTIAL.exec(text);
  if (match === null) return undefined;
  const parts = [match[1], match[2], match[3]].map((part) =>
    part === undefined || /^[xX*]$/u.test(part) ? undefined : Number(part),
  );
  // A wildcard ends the version: `22.x.5` means `22.x`.
  const wildcard = parts.indexOf(undefined);
  return wildcard === -1
    ? parts
    : parts.map((part, index) => (index < wildcard ? part : undefined));
}

function compare(left: Version, right: Version): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function holds([operator, bound]: Comparator, version: Version): boolean {
  const order = compare(version, bound);
  if (operator === '<') return order < 0;
  if (operator === '<=') return order <= 0;
  if (operator === '>') return order > 0;
  if (operator === '>=') return order >= 0;
  return order === 0;
}

/** node-semver's desugaring of one comparator into plain bounds; `undefined` matches nothing. */
function bounds(operator: string, parts: readonly Part[]): readonly Comparator[] | undefined {
  const [major, minor, patch] = parts;
  if (major === undefined) return operator === '<' || operator === '>' ? undefined : [];
  const filled: Version = [major, minor ?? 0, patch ?? 0];
  const exact = patch !== undefined;
  // The first version past the partial one: past `22` is 23.0.0, past `22.12` is 22.13.0.
  const past: Version = minor === undefined ? [major + 1, 0, 0] : [major, minor + 1, 0];
  switch (operator) {
    case '>=':
      return [['>=', filled]];
    case '>':
      return exact ? [['>', filled]] : [['>=', past]];
    case '<':
      return [['<', filled]];
    case '<=':
      return exact ? [['<=', filled]] : [['<', past]];
    case '~':
    case '~>':
      return [
        ['>=', filled],
        ['<', past],
      ];
    case '^': {
      const caret: Version =
        major > 0 || minor === undefined
          ? [major + 1, 0, 0]
          : minor > 0 || patch === undefined
            ? [0, minor + 1, 0]
            : [0, 0, patch + 1];
      return [
        ['>=', filled],
        ['<', caret],
      ];
    }
    default:
      return exact
        ? [['=', filled]]
        : [
            ['>=', filled],
            ['<', past],
          ];
  }
}

/** One `||` alternative as bounds that must all hold; `null` when it matches nothing. */
function alternative(text: string): readonly Comparator[] | null | undefined {
  const hyphen = /^(\S+)\s+-\s+(\S+)$/u.exec(text);
  if (hyphen !== null) {
    const low = partial(hyphen[1] ?? '');
    const high = partial(hyphen[2] ?? '');
    if (low === undefined || high === undefined) return undefined;
    const lower = bounds('>=', low) ?? [];
    const upper = high[0] === undefined ? [] : (bounds('<=', high) ?? []);
    return [...lower, ...upper];
  }
  const comparators: Comparator[] = [];
  const words = text.replace(/(<=|>=|<|>|=|~>|~|\^)\s+/gu, '$1').split(/\s+/u);
  for (const word of words.filter((entry) => entry !== '')) {
    const [, operator = '', rest = ''] = OPERATOR.exec(word) ?? [];
    const parts = partial(rest);
    if (parts === undefined) return undefined;
    const desugared = bounds(operator, parts);
    if (desugared === undefined) return null;
    comparators.push(...desugared);
  }
  return comparators;
}

/** Whether a release satisfies a range, or undefined when the range uses grammar this file does not read. */
export function satisfies(version: string, range: string): boolean | undefined {
  const parts = partial(version);
  if (parts?.[2] === undefined) return undefined;
  const target: Version = [parts[0] ?? 0, parts[1] ?? 0, parts[2]];
  let matched = false;
  for (const text of range.split('||')) {
    const comparators = alternative(text.trim());
    if (comparators === undefined) return undefined;
    if (comparators?.every((comparator) => holds(comparator, target)) === true) matched = true;
  }
  return matched;
}

/** The first release a `node-version` can resolve to: `22` is 22.0.0. Undefined for an alias or a range. */
export function lowestRelease(nodeVersion: string): string | undefined {
  const parts = partial(nodeVersion.trim());
  if (parts?.[0] === undefined) return undefined;
  return `${String(parts[0])}.${String(parts[1] ?? 0)}.${String(parts[2] ?? 0)}`;
}
