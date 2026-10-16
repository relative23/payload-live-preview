/**
 * Which paths below a group changed without anything on the page to show
 * them (ADR 0022). The diff names top-level fields; under
 * `subfieldCoverage: 'declared'` a group covered only through its descendants
 * is compared with the previous message path by path, and a changed path
 * needs its own binding or a declared cover.
 */

import { valueIdentity } from './value-identity';

export type SubfieldCoverage = 'descendant' | 'declared';

/** Deeper than this, what is left counts as one changed path. */
export const SUBFIELD_DEPTH_LIMIT = 8;
/** Nodes compared per field before the rest counts as one changed path. */
export const SUBFIELD_VISIT_LIMIT = 1024;

/** What the page offers for a path; built once per update from the cache and the owner scope. */
export interface PathCoverage {
  /** A binding on the path, or a cover on it or on an ancestor. */
  readonly covers: (path: string) => boolean;
  /** A binding or a cover somewhere below the path. */
  readonly reachesBelow: (path: string) => boolean;
}

export interface UncoveredPath {
  readonly path: string;
  /** The current value there, `undefined` where the path was removed. */
  readonly value: unknown;
}

function isContainer(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  return typeof value === 'object' && value !== null;
}

function shapeOf(value: unknown): 'array' | 'object' | 'scalar' {
  if (Array.isArray(value)) return 'array';
  return isContainer(value) ? 'object' : 'scalar';
}

/** The keys to compare below a container: the new ones, and any the previous value had. */
function childKeys(
  previous: unknown,
  next: Record<string, unknown> | readonly unknown[],
): string[] {
  const keys = new Set(Object.keys(next));
  if (isContainer(previous)) for (const key of Object.keys(previous)) keys.add(key);
  return [...keys];
}

function child(value: unknown, key: string): unknown {
  return isContainer(value) ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * The changed paths below `field` that nothing covers, as the largest
 * uncovered subtrees: a path with nothing bound or covered beneath it is
 * reported whole rather than leaf by leaf. `previous` is `undefined` for a
 * document read without a diff, which makes every path "changed".
 */
export function uncoveredChangedPaths(
  field: string,
  previous: unknown,
  next: unknown,
  coverage: PathCoverage,
): UncoveredPath[] {
  const uncovered: UncoveredPath[] = [];
  let visits = 0;
  const visit = (path: string, before: unknown, after: unknown, depth: number): void => {
    visits += 1;
    if (coverage.covers(path)) return;
    const identity = valueIdentity(after);
    if (identity !== undefined && identity === valueIdentity(before)) return;
    // A path that changed shape — a group that became a scalar, went away or
    // replaced one — changed as a whole, whatever is covered inside it. Without
    // a previous message (`undefined`) there is no shape to compare.
    const reshaped = before !== undefined && shapeOf(before) !== shapeOf(after);
    const descend =
      !reshaped &&
      isContainer(after) &&
      coverage.reachesBelow(path) &&
      depth < SUBFIELD_DEPTH_LIMIT;
    if (!descend) {
      uncovered.push({ path, value: after });
      return;
    }
    const keys = childKeys(before, after);
    // A new, empty group: nothing inside to compare, so the node itself changed.
    if (keys.length === 0) uncovered.push({ path, value: after });
    for (const key of keys) {
      // Out of budget: this node stands for whatever of it is left unvisited.
      if (visits >= SUBFIELD_VISIT_LIMIT) {
        uncovered.push({ path, value: after });
        return;
      }
      visit(`${path}.${key}`, child(before, key), child(after, key), depth + 1);
    }
  };
  visit(field, previous, next, 0);
  return uncovered;
}
