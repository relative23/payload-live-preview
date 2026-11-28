/**
 * Which paths below a group changed without anything on the page to show
 * them (ADR 0022). The diff names top-level fields; under
 * `subfieldCoverage: 'declared'` a group covered only through its descendants
 * is compared with the previous message path by path, and a changed path
 * needs its own binding or a declared cover. A document a merge populated and
 * the id it replaced are the same value: population is not an edit.
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

/** Whether `document` is what a merge puts where the message has the bare `id`. */
function populates(document: unknown, id: unknown): boolean {
  return (
    (typeof id === 'string' || typeof id === 'number') &&
    isContainer(document) &&
    !Array.isArray(document) &&
    (document as Record<string, unknown>)['id'] === id
  );
}

/**
 * Whether two values differ only in what the server populated: the same shape
 * all the way down, except that one holds a document where the other holds its
 * id. The admin posts a relationship or an upload as its id in every message
 * and the merge answers with the document, so a revision rendered before the
 * answer and the one after it meet both forms of one value.
 */
function samePopulation(before: unknown, after: unknown): boolean {
  if (!isContainer(before) || !isContainer(after)) {
    return (
      populates(before, after) ||
      populates(after, before) ||
      valueIdentity(before) === valueIdentity(after)
    );
  }
  if (Array.isArray(before) !== Array.isArray(after)) return false;
  const keys = Object.keys(after);
  if (keys.length !== Object.keys(before).length) return false;
  return keys.every(
    (key) => Object.hasOwn(before, key) && samePopulation(child(before, key), child(after, key)),
  );
}

/**
 * Whether the two values are one: equal, or equal but for population. An id
 * and its document are told apart without a walk, whatever the document's
 * size. The walk itself needs an identity on both sides, which bounds it by
 * the identity's size limit and keeps it out of a cycle; a value without one
 * counts as changed, as it does for the top-level diff.
 */
function sameValue(before: unknown, after: unknown): boolean {
  const identity = valueIdentity(after);
  const previous = valueIdentity(before);
  if (identity !== undefined && identity === previous) return true;
  if (populates(before, after) || populates(after, before)) return true;
  return identity !== undefined && previous !== undefined && samePopulation(before, after);
}

/**
 * Whether the value at a dotted path changed between two messages, by the
 * rule the walk below applies. A route-bound element names such a path
 * (`layout.1.note`) while the diff names only its field.
 */
export function pathChanged(
  path: string,
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): boolean {
  let before: unknown = previous;
  let after: unknown = next;
  for (const key of path.split('.')) {
    before = child(before, key);
    after = child(after, key);
  }
  return !sameValue(before, after);
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
    if (coverage.covers(path) || sameValue(before, after)) return;
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
